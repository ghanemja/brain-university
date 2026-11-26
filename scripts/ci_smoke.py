#!/usr/bin/env python3
"""
CI smoke — docs/HARDENING.md Phase 5 (open demo → 6 agent screens render).

Boots the real stack the way the demo runs it, then drives a browser
through the frontend AND exercises the hardened API paths end-to-end:

  1. uvicorn api.server:app          — fresh tmp sqlite DATABASE_URL,
                                       BU_AUTH_DISABLED=1 (dev demo mode)
  2. python -m http.server design/   — the zero-build frontend, exactly as
                                       published (in-browser Babel; the CI
                                       run IS the dev-mode regression test)
  3. API smoke (urllib, no browser) — also a learner ride logged through
     the walk + spaced-repetition endpoints and read back via /progress:
       login → dry-run exam e2e (POST /atp/exams/run → poll /jobs/{id} →
       award) → evidence + chain verify → license lifecycle
       (issue → gated /experts chat → revoke → 403)
  4. Playwright chromium:
       open demo (no login screen; the page's silent auto-login is
       rejected by the CI backend and the app runs tokenless) → all 6
       agent-view tabs render non-empty main content → Human view toggle
       renders the topic map → the page's progress sync gets 200 from
       /health and /progress → zero console errors.
  5. Playwright chromium against a SECOND uvicorn with auth ENABLED that
     refuses the page's demo credential, starting from a stale token:
       the page loads exactly once (no 401 reload loop) → auth 401s reach
       it with CORS headers → one fresh sign-in attempt, not one per 401
       → the agent tabs still render (demo-data fallback).

Runnable locally and in CI (identical behavior):

    pip install playwright && playwright install chromium
    python3 scripts/ci_smoke.py

Exit 0 = green. Any assertion prints a ✗ line and exits 1.
"""
from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
DESIGN_DIR = ROOT / "design"
INDEX = "Brain%20University.html"

EXAM_CERT = "atp-l4-math"       # seed cert with a commissioned item bank
LICENSED_AGENT = "gemma-math"   # licensable marketplace agent (seed)
AGENT_TABS = ["university", "agents", "certs", "marketplace", "governance", "vault"]

#: Resource URLs that may 4xx without failing the smoke. Keep this SHORT and
#: explained:
#:   favicon.ico             — not shipped; browsers auto-request it
#:   .compiled/manifest.json — the prod-build probe (HARDENING.md Phase 5);
#:                             404 IS the zero-build dev mode working as
#:                             designed (page falls back to in-browser Babel)
RESOURCE_404_ALLOWLIST = ("favicon.ico", ".compiled/manifest.json")

#: API paths whose 401 is EXPECTED, matched exactly (POST, 401, on the API
#: origin — anything else from them still fails the smoke). The open-demo page
#: (design/Brain University.html) has no login screen: on load it POSTs a
#: hard-coded demo credential to /login and, when that is refused, to
#: /auth/login. That credential is the HOSTED demo's; this backend runs
#: BU_AUTH_DISABLED=1 with the dev password "password", so both refuse it
#: with 401 and the page carries on without a token, which works because
#: auth is disabled. The 401s are the page's designed fallback, not a fault:
#: the page has no way to tell an auth-disabled server from one with a
#: different password, and CI can't verify a hosted credential anyway.
SILENT_LOGIN_401_PATHS = ("/login", "/auth/login")

#: Requests the Human view's progress sync (design/progress.js) makes on
#: load; each must be seen from the page with 200 before the smoke ends.
PROGRESS_SYNC_PATHS = ("/health", "/progress")

_STEPS: list[str] = []


def ok(msg: str) -> None:
    _STEPS.append(msg)
    print(f"  ✓ {msg}")


def die(msg: str) -> None:
    print(f"  ✗ {msg}", file=sys.stderr)
    sys.exit(1)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ── HTTP helpers (stdlib only — the API smoke needs no client deps) ────────

def request(method: str, url: str, body: dict | None = None,
            headers: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read() or b"{}")
        except json.JSONDecodeError:
            payload = {}
        return e.code, payload


def wait_for(url: str, timeout_s: float = 60.0, label: str = "") -> None:
    deadline = time.monotonic() + timeout_s
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3):
                return
        except urllib.error.HTTPError:
            return  # server is up; status is the endpoint's business
        except Exception as e:  # noqa: BLE001 — conn refused while booting
            last_err = e
            time.sleep(0.4)
    die(f"{label or url} did not come up within {timeout_s:.0f}s ({last_err})")


# ── API smoke ────────────────────────────────────────────────────────────────

def poll_job(api: str, job_id: str, auth: dict,
             timeout_s: float = 180.0) -> dict:
    """Poll /jobs/{id} until done/error; die on timeout. Returns job result."""
    if not job_id:
        die("poll_job called without a job id")
    deadline = time.monotonic() + timeout_s
    job: dict = {}
    while time.monotonic() < deadline:
        status, job = request("GET", f"{api}/jobs/{job_id}", headers=auth)
        if status != 200:
            die(f"GET /jobs/{job_id} → {status} {job}")
        if job.get("status") in ("done", "error"):
            break
        time.sleep(0.5)
    if job.get("status") != "done":
        die(f"job {job_id} did not finish: {job}")
    return job.get("result") or {}


def api_smoke(api: str) -> None:
    print("API smoke:")
    status, body = request("POST", f"{api}/login",
                           {"username": "admin", "password": "password"})
    if status != 200 or not body.get("token"):
        die(f"POST /login admin/password → {status} {body}")
    auth = {"Authorization": f"Bearer {body['token']}"}
    ok("login admin/password → bearer token")

    # dry-run certification exam, end to end through the job queue
    status, body = request("POST", f"{api}/atp/exams/run",
                           {"certId": EXAM_CERT, "dryRun": True}, auth)
    if status != 200 or not body.get("jobId"):
        die(f"POST /atp/exams/run → {status} {body}")
    job_id = body["jobId"]
    deadline = time.monotonic() + 180
    job: dict = {}
    while time.monotonic() < deadline:
        status, job = request("GET", f"{api}/jobs/{job_id}", headers=auth)
        if status != 200:
            die(f"GET /jobs/{job_id} → {status} {job}")
        if job.get("status") in ("done", "error"):
            break
        time.sleep(0.5)
    if job.get("status") != "done":
        die(f"exam job did not finish: {job}")
    award = job.get("result") or {}
    if award.get("certId") != EXAM_CERT or award.get("verdict") not in ("pass", "fail"):
        die(f"exam award malformed: {award}")
    evidence_ids = award.get("evidenceIds") or []
    if not evidence_ids:
        die(f"exam award carries no evidence: {award}")
    ok(f"dry-run exam {EXAM_CERT} → verdict={award['verdict']} "
       f"score={award.get('score')} ({len(evidence_ids)} evidence rows)")

    status, body = request(
        "GET", f"{api}/atp/evidence/{evidence_ids[0]}/verify", headers=auth)
    if status != 200 or not body.get("ok") or not body.get("sigValid"):
        die(f"evidence verify → {status} {body}")
    status, body = request("GET", f"{api}/atp/chain/verify", headers=auth)
    if status != 200 or not body.get("ok") or body.get("length", 0) < len(evidence_ids):
        die(f"chain verify → {status} {body}")
    ok(f"evidence signature + org chain verify (length={body.get('length')})")

    # license lifecycle: issue → gated chat → revoke → 403
    status, body = request("POST", f"{api}/billing/licenses",
                           {"agentId": LICENSED_AGENT}, auth)
    if status != 200 or not body.get("licenseKey") or not (body.get("license") or {}).get("id"):
        die(f"POST /billing/licenses → {status} {body}")
    license_id, key = body["license"]["id"], body["licenseKey"]
    ok(f"license issued for {LICENSED_AGENT} (id={license_id})")

    chat_body = {"messages": [{"role": "user", "content": "What is 2 + 2?"}]}
    chat_url = f"{api}/experts/{LICENSED_AGENT}/chat"
    status, body = request("POST", chat_url, chat_body,
                           {"X-ATP-License-Key": key})
    if status != 200 or not body.get("reply"):
        die(f"licensed chat → {status} {body}")
    ok("licensed /experts chat replied (usage metered)")

    status, body = request("POST", chat_url, chat_body,
                           {"X-ATP-License-Key": "atpk_forged.deadbeef"})
    if status != 401:
        die(f"forged key must 401, got {status} {body}")

    status, body = request("POST", f"{api}/billing/licenses/{license_id}/revoke",
                           {"reason": "ci smoke"}, auth)
    if status != 200:
        die(f"revoke → {status} {body}")
    status, body = request("POST", chat_url, chat_body,
                           {"X-ATP-License-Key": key})
    if status != 403:
        die(f"revoked key must 403 on the very next call, got {status} {body}")
    ok("revoked license → 403 on the next chat call (forged key → 401)")

    learner_progress_smoke(api, auth)

    # ── Phase 6: report-card PDF + knowledge ingestion → SME sign-off → exam ──
    pdf_req = urllib.request.Request(f"{api}/atp/agents/atlas-ops/report.pdf",
                                     headers=auth)
    with urllib.request.urlopen(pdf_req, timeout=60) as resp:
        pdf_bytes = resp.read()
        if resp.status != 200 or not pdf_bytes.startswith(b"%PDF"):
            die(f"report.pdf → {resp.status}, magic {pdf_bytes[:8]!r}")
    ok(f"report-card PDF renders ({len(pdf_bytes)} bytes)")

    # generate_l5_draft needs >= 2 docs (blueprint sections = doc titles)
    boundary = "ciSmokeBoundary"
    docs_md = {
        # >= 2 headings per doc: the generator yields ~2 items per heading
        # and requires >= 8 items overall.
        "runbook.md": (
            "# Incident Runbook\n\n"
            "## Acknowledge\n\nAcknowledge the page within five minutes "
            "and open an incident channel named for the alert.\n\n"
            "## Escalate\n\nEscalate to the on-call lead when customer "
            "impact lasts longer than fifteen minutes.\n"),
        "rollback.md": (
            "# Rollback Policy\n\n"
            "## Snapshot first\n\nAlways snapshot the database before any "
            "rollback and record the snapshot id in the channel.\n\n"
            "## Notify\n\nNotify the on-call lead and the release owner "
            "before starting the rollback.\n"),
    }
    doc_ids = []
    for fname, doc_md in docs_md.items():
        mp = (f"--{boundary}\r\nContent-Disposition: form-data; "
              f"name=\"file\"; filename=\"{fname}\"\r\n"
              f"Content-Type: text/markdown\r\n\r\n"
              f"{doc_md}\r\n--{boundary}--\r\n").encode()
        up_req = urllib.request.Request(f"{api}/knowledge/docs", data=mp,
                                        method="POST", headers=auth)
        up_req.add_header("Content-Type",
                          f"multipart/form-data; boundary={boundary}")
        with urllib.request.urlopen(up_req, timeout=30) as resp:
            doc = json.loads(resp.read())
        doc_ids.append(doc.get("id") or die(f"knowledge upload returned {doc}"))
    status, draft = request("POST", f"{api}/knowledge/drafts",
                            {"docIds": doc_ids, "title": "CI L5 draft"},
                            headers=auth)
    if status != 200 or len(draft.get("items", [])) < 8:
        die(f"draft → {status}, items {len(draft.get('items', []))}")
    status, appr = request("POST",
                           f"{api}/knowledge/drafts/{draft['id']}/approve",
                           {"note": "ci smoke sign-off"}, headers=auth)
    if status != 200 or not appr.get("evidenceId"):
        die(f"approve → {status} {appr}")
    status, job = request("POST",
                          f"{api}/knowledge/drafts/{draft['id']}/exam",
                          {"dryRun": True}, headers=auth)
    if status != 200:
        die(f"draft exam → {status} {job}")
    award = poll_job(api, job.get("jobId") or job.get("job_id"), auth)
    if not award.get("verdict"):
        die(f"draft-exam award missing verdict: {award}")
    status, chain = request("GET", f"{api}/atp/chain/verify", headers=auth)
    if status != 200 or not chain.get("ok"):
        die(f"chain broken after knowledge flow: {chain}")
    ok("knowledge e2e: upload → draft → SME sign-off → dry-run exam → chain ok")


# ── Browser smoke ────────────────────────────────────────────────────────────

def learner_progress_smoke(api: str, auth: dict) -> None:
    """A ride as the Learn screen logs it, read back the way the Map restores it."""
    user = f"ci-learner-{int(time.time())}"
    status, body = request("POST", f"{api}/walks/start",
                           {"user_id": user, "start_node": "spanning_tree",
                            "planned": ["spanning_tree", "Minimum_Spanning_Tree_MST"]},
                           auth)
    walk_id = body.get("walk_id")
    if status != 200 or not walk_id:
        die(f"POST /walks/start → {status} {body}")
    for i, (node, quality) in enumerate([("spanning_tree", 5),
                                         ("Minimum_Spanning_Tree_MST", None)]):
        status, body = request("POST", f"{api}/walks/{walk_id}/event",
                               {"user_id": user, "node": node, "step_idx": i,
                                "lesson_mode": "ride", "quiz_quality": quality,
                                "duration_s": 30.0}, auth)
        if status != 200:
            die(f"POST /walks/{walk_id}/event → {status} {body}")
    status, body = request("POST", f"{api}/walks/{walk_id}/complete", None, auth)
    if status != 200:
        die(f"POST /walks/{walk_id}/complete → {status} {body}")
    status, body = request("POST", f"{api}/sr/review",
                           {"user_id": user, "node": "spanning_tree", "quality": 2},
                           auth)
    if status != 200 or not body.get("due_ts"):
        die(f"POST /sr/review → {status} {body}")
    ok("ride logged: walk start → 2 stop events → complete, one review scheduled")

    status, body = request("GET", f"{api}/progress?user_id={user}", headers=auth)
    if status != 200:
        die(f"GET /progress → {status} {body}")
    visited = {v["node"]: v for v in body.get("visited", [])}
    if set(visited) != {"spanning_tree", "Minimum_Spanning_Tree_MST"}:
        die(f"/progress visited = {sorted(visited)}")
    if visited["spanning_tree"]["best_quality"] != 5:
        die(f"/progress best_quality = {visited['spanning_tree']}")
    walks = body.get("walks", [])
    if not walks or walks[0]["walk_id"] != walk_id or not walks[0]["completed"]:
        die(f"/progress walks = {walks}")
    cards = body.get("cards", [])
    if [c["node"] for c in cards] != ["spanning_tree"] or cards[0]["last_quality"] != 2:
        die(f"/progress cards = {cards}")
    ok("GET /progress reads the ride back (2 stops, completed walk, 1 card)")


def browser_smoke(api: str, web: str) -> None:
    from playwright.sync_api import sync_playwright

    from playwright.sync_api import TimeoutError as PWTimeoutError

    print("Browser smoke (playwright chromium):")
    console_errors: list[str] = []
    page_errors: list[str] = []
    bad_responses: list[str] = []
    silent_login_401s: list[str] = []
    progress_sync: dict[str, int] = {}   # path → last status seen from the page
    api_origin = urlsplit(api)[:2]

    def note_response(resp) -> None:
        url = urlsplit(resp.url)
        on_api = url[:2] == api_origin
        if on_api and url.path in PROGRESS_SYNC_PATHS:
            progress_sync[url.path] = resp.status
        if resp.status < 400:
            return
        if any(allowed in resp.url for allowed in RESOURCE_404_ALLOWLIST):
            return
        if (on_api and resp.status == 401 and resp.request.method == "POST"
                and url.path in SILENT_LOGIN_401_PATHS):
            silent_login_401s.append(url.path)
            return
        bad_responses.append(f"HTTP {resp.status} {resp.url}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(120_000)

        # The deployed design/config.js points at the hosted backend; serve
        # the CI backend instead without touching the working tree.
        page.route("**/config.js", lambda route: route.fulfill(
            status=200, content_type="application/javascript",
            body=f'window.BU_API_BASE = "{api}";\n'))

        # 'Failed to load resource' console lines carry no resource URL, so
        # judge those via the response listener (which has status + URL and
        # can honor RESOURCE_404_ALLOWLIST); keep every other console error.
        page.on("console", lambda m: console_errors.append(m.text)
                if m.type == "error"
                and not m.text.startswith("Failed to load resource") else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("response", note_response)

        # Open demo: no login screen. The page silently POSTs its demo
        # credential on load (SILENT_LOGIN_401_PATHS) and renders right away.
        page.goto(f"{web}/{INDEX}")

        # App shell up = in-browser Babel compiled every .jsx (zero-build
        # dev mode contract). Fresh profile defaults to the agent view.
        # One reload retry: the pinned React/Babel/three CDN fetches are the
        # only non-local resources and occasionally stall on a cold edge.
        try:
            page.wait_for_selector('nav.nav button[data-nav="university"]')
        except PWTimeoutError:
            print("  … app shell slow (CDN?) — reloading once", file=sys.stderr)
            page.reload()
            page.wait_for_selector('nav.nav button[data-nav="university"]')
        ok("open demo: app shell rendered with no login screen")

        for tab in AGENT_TABS:
            page.click(f'button[data-nav="{tab}"]')
            page.wait_for_function(
                """(tab) => {
                    const btn  = document.querySelector(`button[data-nav="${tab}"]`);
                    const main = document.querySelector('main');
                    return btn && btn.classList.contains('active') &&
                           main && main.innerText.trim().length > 80;
                }""",
                arg=tab)
            chars = page.evaluate(
                "document.querySelector('main').innerText.trim().length")
            ok(f"agent tab '{tab}' rendered non-empty main ({chars} chars)")

        # Human ◦ Agent toggle → the Map (the human home)
        page.click('.view-toggle button:has-text("Human")')
        page.wait_for_function(
            """() => {
                const btn  = document.querySelector('button[data-nav="map"]');
                const main = document.querySelector('main');
                return btn && btn.classList.contains('active') &&
                       document.querySelector('.metro-mapbox svg') &&
                       main && main.innerText.trim().length > 40;
            }""")
        ok("human view toggle → topic map rendered")

        # Progress sync: progress.js waits up to 10 s for the silent login's
        # token (none lands here), then GETs /health and /progress.
        deadline = time.monotonic() + 30
        while (not all(p in progress_sync for p in PROGRESS_SYNC_PATHS)
               and time.monotonic() < deadline):
            page.wait_for_timeout(250)
        sync = {p: progress_sync.get(p) for p in PROGRESS_SYNC_PATHS}
        if any(status != 200 for status in sync.values()):
            die(f"progress sync from the page: {sync} (want 200 for each; "
                "None = never requested)")
        ok("progress sync: page got 200 from /health and /progress")

        page.wait_for_timeout(1500)  # let late async fetches surface errors
        browser.close()

    real_errors = console_errors + page_errors + bad_responses
    if real_errors:
        for e in real_errors:
            print(f"  console/network error: {e}", file=sys.stderr)
        die(f"{len(real_errors)} console/network error(s) during the browser smoke")
    if silent_login_401s:
        print(f"  · expected: silent demo login refused by the CI backend "
              f"(401 on {', '.join(silent_login_401s)}); app ran tokenless")
    ok("zero console errors across 7 screens")


def auth_enabled_browser_smoke(api: str, web: str) -> None:
    """The open demo against a backend WITH auth that refuses the page's
    demo credential, starting from a stale token (an expired session).

    Guards the 401 path end to end. auth_middleware's 401s must reach the
    page with CORS headers (CORSMiddleware is the outermost layer in
    api/server.py), and the page must handle them without reloading: one
    fresh sign-in through window.BU_AUTH.refresh (rate-limited there), then
    the demo-data fallback. The page used to reload on every 401 to re-show
    a login screen that no longer exists, so a refused sign-in reloaded it
    forever; with CORS inside auth, it instead never saw the 401 at all and
    stayed stuck on the stale token.
    """
    from playwright.sync_api import sync_playwright

    from playwright.sync_api import Error as PWError
    from playwright.sync_api import TimeoutError as PWTimeoutError

    print("Browser smoke, auth enabled + demo credential refused:")
    loads = 0
    sign_ins = 0                   # POST /login attempts (BU_AUTH sign-ins)
    api_401s: list[str] = []       # protected API paths that answered 401
    blocked: list[str] = []        # API requests the browser failed/blocked
    page_errors: list[str] = []
    api_origin = urlsplit(api)[:2]

    def on_load(_page) -> None:
        nonlocal loads
        loads += 1

    def on_response(resp) -> None:
        nonlocal sign_ins
        url = urlsplit(resp.url)
        if url[:2] != api_origin:
            return
        if resp.request.method == "POST" and url.path == "/login":
            sign_ins += 1
        elif resp.status == 401 and url.path not in SILENT_LOGIN_401_PATHS:
            api_401s.append(url.path)

    def on_failed(req) -> None:
        url = urlsplit(req.url)
        if url[:2] == api_origin:
            blocked.append(f"{req.method} {url.path}: {req.failure}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context()
        # A token this server never issued, as an expired session would
        # leave in sessionStorage (seeded once, so a reload would keep it).
        context.add_init_script(
            "try { if (!sessionStorage.getItem('ci_seeded')) {"
            " sessionStorage.setItem('ci_seeded', '1');"
            " sessionStorage.setItem('bu_auth_token', 'stale.ci.token'); }"
            " } catch (_) {}")
        page = context.new_page()
        page.set_default_timeout(120_000)
        page.route("**/config.js", lambda route: route.fulfill(
            status=200, content_type="application/javascript",
            body=f'window.BU_API_BASE = "{api}";\n'))
        page.on("load", on_load)
        page.on("response", on_response)
        page.on("requestfailed", on_failed)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        page.goto(f"{web}/{INDEX}")
        try:
            page.wait_for_selector('nav.nav button[data-nav="university"]')
        except PWTimeoutError:
            print("  … app shell slow (CDN?) — reloading once", file=sys.stderr)
            page.reload()
            loads -= 1             # our reload, not the page's
            page.wait_for_selector('nav.nav button[data-nav="university"]')

        # Shell is up (CDN scripts cached): a tab that can't settle in 30 s
        # means the page is reloading under us, so say that, not a timeout.
        page.set_default_timeout(30_000)
        try:
            for tab in AGENT_TABS:
                page.click(f'button[data-nav="{tab}"]')
                page.wait_for_function(
                    """(tab) => {
                        const btn  = document.querySelector(`button[data-nav="${tab}"]`);
                        const main = document.querySelector('main');
                        return btn && btn.classList.contains('active') &&
                               main && main.innerText.trim().length > 80;
                    }""",
                    arg=tab)
            page.wait_for_timeout(4000)  # room for a reload loop to show itself
        except PWError as e:
            browser.close()
            die(f"agent tabs never settled ({e.__class__.__name__}); the page "
                f"loaded {loads}× — a 401 reload loop?")
        token = page.evaluate("sessionStorage.getItem('bu_auth_token')")
        browser.close()

    if page_errors:
        die(f"uncaught page errors: {page_errors[:3]}")
    if loads != 1:
        die(f"page loaded {loads}× — a 401 reload loop (want exactly 1)")
    ok("page loaded once: no reload on 401")
    if blocked or not api_401s:
        die(f"auth 401s must reach the page with CORS headers; "
            f"401s seen: {sorted(set(api_401s))}, blocked: {blocked[:4]}")
    ok(f"auth 401s reach the page with CORS headers "
       f"({len(api_401s)} on {', '.join(sorted(set(api_401s)))})")
    if not 1 <= sign_ins <= 2:
        die(f"{sign_ins} sign-in attempts for {len(api_401s)} 401s — the "
            "page must retry the demo sign-in once, then back off "
            "(window.BU_AUTH.refresh)")
    if token:
        die(f"stale token still in sessionStorage after a 401: {token!r}")
    ok(f"stale token dropped, {sign_ins} sign-in attempt(s), agent tabs "
       "rendered on demo data")


def main() -> int:
    api_port, web_port = free_port(), free_port()
    api = f"http://127.0.0.1:{api_port}"
    web = f"http://127.0.0.1:{web_port}"
    auth_api_port = free_port()
    auth_api = f"http://127.0.0.1:{auth_api_port}"

    procs: list[subprocess.Popen] = []
    with tempfile.TemporaryDirectory(prefix="bu-ci-smoke-") as tmp:
        env = os.environ.copy()
        env.update({
            "BU_AUTH_DISABLED": "1",                     # demo mode contract
            "DATABASE_URL": f"sqlite:///{tmp}/ci.db",    # fresh throwaway DB
            "PYTHONUNBUFFERED": "1",
            # This is a functional smoke, not a rate-limit test: the exam
            # poll loop + browser traffic share one (IP, subject) bucket and
            # can exceed api/ops.py's default 120/60s. Explicitly off, per
            # its own env-tuning contract (BU_RATE_LIMIT=0 disables).
            "BU_RATE_LIMIT": "0",
            # Phase 6 surfaces: T2 encryption + evidence signing need keys
            # even in demo mode (knowledge routes 503 without them).
            "DATA_ENCRYPTION_KEY": "ci-smoke-data-key-0123456789abcdef",
            "EVIDENCE_SIGNING_KEY": "ci-smoke-evidence-key-0123456789ab",
        })
        # Second backend for pass 5: auth ENABLED with a password the page's
        # demo credential doesn't match (both random per run).
        auth_env = {k: v for k, v in env.items() if k != "BU_AUTH_DISABLED"}
        auth_env.update({
            "DATABASE_URL": f"sqlite:///{tmp}/ci-auth.db",
            "BU_AUTH_PASSWORD": secrets.token_urlsafe(24),
            "BU_AUTH_SECRET": secrets.token_urlsafe(48),
        })
        try:
            procs.append(subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "api.server:app",
                 "--host", "127.0.0.1", "--port", str(api_port)],
                cwd=ROOT, env=env))
            procs.append(subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "api.server:app",
                 "--host", "127.0.0.1", "--port", str(auth_api_port),
                 "--log-level", "warning"],
                cwd=ROOT, env=auth_env))
            procs.append(subprocess.Popen(
                [sys.executable, "-m", "http.server", str(web_port),
                 "--bind", "127.0.0.1", "--directory", str(DESIGN_DIR)],
                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

            wait_for(f"{api}/health", 90, "uvicorn api.server:app")
            wait_for(f"{auth_api}/health", 90, "uvicorn api.server:app (auth on)")
            wait_for(f"{web}/{INDEX}", 30, "http.server design/")
            print(f"servers up: api={api} auth-api={auth_api} web={web}")

            api_smoke(api)
            browser_smoke(api, web)
            auth_enabled_browser_smoke(auth_api, web)
        finally:
            for p in procs:
                p.terminate()
            for p in procs:
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.kill()

    print(f"ci_smoke: OK — {len(_STEPS)} checks green.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
