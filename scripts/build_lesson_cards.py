#!/usr/bin/env python3
"""
Build design/lesson_cards.js — a real lesson for every stop on the map.

design/data.js's LESSONS carry only each wiki page's opening paragraph, so a
stop "teaches" a definition and little else. The wiki pages themselves are
structured (Definition / Key Equations / Physical Intuition / Applications /
Common Mistakes / examples / See Also); this script lifts those sections into
a card the Learn screens present as beats:

    why       — why it matters (the first intuition subsection)
    idea      — the definition
    equations — up to 3 key equations, each with a label and a note
    how       — how it works (further intuition subsections)
    example   — a worked example, when the page has one
    uses      — where it's used
    pitfalls  — common mistakes
    related   — see-also names

Stdlib only, deterministic (same wiki → same file). Stops whose page doesn't
follow the template still get a card from whatever sections exist; the UI
falls back to LESSONS for a stop with no card at all.

Usage:  python3 scripts/build_lesson_cards.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIKI = ROOT / "wiki" / "concepts"
DATA_JS = ROOT / "design" / "data.js"
PORA_JS = ROOT / "design" / "courses" / "pora_bu.js"
OUT = ROOT / "design" / "lesson_cards.js"

MAX_EQUATIONS, MAX_HOW, MAX_USES, MAX_PITFALLS, MAX_POINTS = 3, 2, 4, 4, 3
MAX_WORDS = 140  # per prose block; cut at a paragraph or bullet boundary


def node_ids() -> list[str]:
    """Every concept id the frontend knows (data.js NODES + the PoRA course)."""
    ids: list[str] = []
    text = DATA_JS.read_text(encoding="utf-8")
    nodes = text[text.index("const NODES = ["):text.index("const EDGES = ")]
    ids += re.findall(r'"id":\s*"([^"]+)"', nodes)
    if PORA_JS.exists():
        pora = PORA_JS.read_text(encoding="utf-8")
        m = re.search(r'"nodes":\s*\[(.*?)\],\s*"edges"', pora, re.S)
        if m:
            ids += re.findall(r'"id":\s*"([^"]+)"', m.group(1))
    seen: set[str] = set()
    return [i for i in ids if not (i in seen or seen.add(i))]


def clip(md: str, max_words: int = MAX_WORDS) -> str:
    """Trim prose to about max_words, never mid-paragraph or mid-bullet."""
    md = md.strip()
    if len(md.split()) <= max_words:
        return md
    out: list[str] = []
    words = 0
    in_math = False
    for line in md.split("\n"):
        n = len(line.split())
        boundary = not in_math and (not line.strip() or re.match(r"^\s*([-*]|\d+[.)])\s", line))
        if out and words + n > max_words and boundary:
            break
        out.append(line)
        words += n
        if line.count("$$") % 2:
            in_math = not in_math
    return "\n".join(out).strip()


def split_sections(text: str, level: str) -> tuple[str, list[tuple[str, str]]]:
    """Split markdown on headings of `level` ('##' or '###') → (preamble, [(title, body)])."""
    parts = re.split(rf"^{level}\s+(.+?)\s*$", text, flags=re.M)
    pre = parts[0]
    return pre, [(parts[i].strip(), parts[i + 1].strip("\n")) for i in range(1, len(parts) - 1, 2)]


def clean_title(t: str) -> str:
    t = re.sub(r"^\s*\d+[.)]\s*", "", t)          # "1. " numbering
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)        # bold
    return t.strip().rstrip(":").strip()


def items_of(body: str) -> list[dict]:
    """A section's entries, however the page wrote them:
    '### Title' blocks, '1. **Title**' with indented bullets, or '- **Title**: text'."""
    _, subs = split_sections(body, "###")
    if subs:
        raw = [(clean_title(t), b) for t, b in subs]
    else:
        raw = []
        cur: list | None = None
        for line in body.split("\n"):
            m = re.match(r"^(?:\d+[.)]|[-*])\s+\*\*(.+?)\*\*[:.]?\s*(.*)$", line)
            if m:
                cur = [clean_title(m.group(1)), m.group(2).strip()]
                raw.append(cur)
            elif cur is not None and line.strip():
                cur[1] += "\n" + line
            elif cur is None and re.match(r"^[-*]\s+\S", line):
                raw.append([clean_title(re.sub(r"^[-*]\s+", "", line)), ""])
        raw = [tuple(r) for r in raw]
    out = []
    for title, b in raw:
        points = [re.sub(r"^\s*([-*]|\d+[.)])\s+", "", ln).strip()
                  for ln in b.split("\n") if re.match(r"^\s*([-*]|\d+[.)])\s+\S", ln)]
        if not points and b.strip():
            points = [" ".join(b.split())]
        if title:
            out.append({"h": title, "points": points[:MAX_POINTS]})
    return out


def equations_of(body: str) -> list[dict]:
    """Display equations with the line that introduces each and any 'where …' note."""
    out: list[dict] = []
    chunks = re.split(r"\$\$(.+?)\$\$", body, flags=re.S)
    for i in range(1, len(chunks), 2):
        tex = " ".join(chunks[i].split())
        before = [ln.strip() for ln in chunks[i - 1].strip().split("\n") if ln.strip()]
        after = [ln.strip() for ln in (chunks[i + 1] if i + 1 < len(chunks) else "").strip().split("\n") if ln.strip()]
        label = before[-1] if before else ""
        if label.startswith("#"):
            label = clean_title(label.lstrip("# "))
        note = after[0] if after and re.match(r"^(where|here|this|is |with )", after[0], re.I) else ""
        out.append({"label": label.rstrip(":").strip(), "tex": tex, "note": note})
        if len(out) >= MAX_EQUATIONS:
            break
    return out


def related_of(body: str) -> list[str]:
    names = []
    for target, label in re.findall(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", body):
        names.append((label or target).replace("_", " ").strip())
    return names[:6]


def card_for(md: str) -> dict:
    md = re.sub(r"<!-- pora:begin -->.*?<!-- pora:end -->", "", md, flags=re.S)
    md = re.sub(r"^# .*$", "", md, count=1, flags=re.M)
    pre, sections = split_sections(md, "##")
    card: dict = {}
    extra: list[dict] = []
    for title, body in sections:
        key = title.lower()
        if key.startswith("definition"):
            card["idea"] = clip(body, 170)
        elif "equation" in key or key == "formula":
            eqs = equations_of(body)
            if eqs:
                card["equations"] = eqs
            elif body.strip():
                extra.append({"h": title, "md": clip(body)})
        elif "intuition" in key or "derivation" in key:
            lead, subs = split_sections(body, "###")
            blocks = [{"h": clean_title(t), "md": clip(b)} for t, b in subs if b.strip()]
            if lead.strip():
                blocks.insert(0, {"h": "", "md": clip(lead)})
            if blocks:
                card["why"] = blocks[0]
                if blocks[1:]:
                    card["how"] = blocks[1:1 + MAX_HOW]
        elif "application" in key or key == "use":
            uses = items_of(body)
            if uses:
                card["uses"] = uses[:MAX_USES]
        elif "mistake" in key or "pitfall" in key:
            traps = items_of(body)
            if traps:
                card["pitfalls"] = traps[:MAX_PITFALLS]
        elif "example" in key or "walkthrough" in key:
            _, subs = split_sections(body, "###")
            t, b = subs[0] if subs else (title, body)
            if b.strip():
                card["example"] = {"h": clean_title(t), "md": clip(b, 170)}
        elif key in ("see also", "related"):
            rel = related_of(body)
            if rel:
                card["related"] = rel
        elif key in ("sources", "references"):
            continue
        elif body.strip():
            extra.append({"h": clean_title(title), "md": clip(body)})
    if "idea" not in card and pre.strip():
        card["idea"] = clip(pre, 170)   # thin pages: the intro paragraph is the definition
    if extra and "how" not in card:
        card["how"] = extra[:MAX_HOW + 1]
    return card


def main() -> None:
    cards: dict[str, dict] = {}
    for nid in node_ids():
        page = WIKI / f"{nid}.md"
        if not page.exists():
            continue
        card = card_for(page.read_text(encoding="utf-8"))
        if len(card) >= 2:               # a lone definition adds nothing over LESSONS
            cards[nid] = card
    body = json.dumps(cards, ensure_ascii=False, indent=1, sort_keys=True)
    OUT.write_text(
        "// Brain University — a real lesson for every stop, lifted from the wiki pages.\n"
        "// Generated by scripts/build_lesson_cards.py. Do not edit by hand.\n"
        f"window.BU_LESSON_CARDS = {body};\n",
        encoding="utf-8",
    )
    full = sum(1 for c in cards.values() if {"why", "idea", "pitfalls"} <= set(c))
    print(f"wrote {OUT.relative_to(ROOT)}: {len(cards)} cards ({full} with why + idea + pitfalls), "
          f"{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
