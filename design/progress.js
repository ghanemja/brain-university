// Brain University — what this learner has ridden, synced with the backend.
//
// window.BU_PROGRESS keeps, in localStorage:
//   done   — every stop (concept id) the learner has moved on from, with when
//   rides  — each ride: its tour (the shared [{ node, cluster, kind, rationale }]
//            format), where the learner is on it, whether it is finished, and
//            its backend walk id once logged
//   cards  — spaced-repetition state per stop, from the learner's ratings
//            (the same SM-2 rules as agents/spaced_repetition.py, so review
//            works offline too)
//   outbox — backend calls not sent yet
//
// The backend is the record: rides are logged through the walk endpoints
// (POST /walks/start, /walks/{id}/event, /walks/{id}/complete), ratings
// through POST /sr/review, and on load GET /progress restores stops, cards
// and walks this browser doesn't have. Calls queue in the outbox while the
// server is unreachable and go out, in order, once it answers. The learner
// is window.BU_USER_ID (an anonymous id per browser until sign-in exists).
window.BU_PROGRESS = (() => {
  const KEY = "bu_progress_v1";
  const MAX_RIDES = 40, MAX_OUTBOX = 500, DAY_S = 86400, RETRY_MS = 60000;
  const empty = () => ({ v: 1, done: {}, rides: [], current: null, cards: {}, outbox: [] });
  let state = empty();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.v === 1 && raw.done && Array.isArray(raw.rides)) state = Object.assign(empty(), raw);
  } catch (_) { /* unreadable or blocked storage: start fresh */ }

  const listeners = new Set();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private mode */ } };
  const save = () => {
    persist();
    listeners.forEach(fn => { try { fn(); } catch (_) { /* a listener's own problem */ } });
  };
  const now = () => Date.now();
  const sameTour = (a, b) => a.length === b.length && a.every((s, i) => s.node === b[i].node);
  const rideById = id => state.rides.find(r => r.id === id);

  // ─── backend sync ──────────────────────────────────────────────────
  let online = false, lastSync = 0, retryTimer = 0, flushing = false, connecting = false;
  const base = () => (window.BU_API_BASE || "").replace(/\/+$/, "");
  const user = () => window.BU_USER_ID || "anon";
  const token = () => { try { return sessionStorage.getItem("bu_auth_token"); } catch (_) { return null; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Our own fetch: unlike BU_API's, a 401 here never reloads the page; the
  // call simply waits in the outbox for the next try.
  async function call(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const t = token();
    if (t) headers.Authorization = "Bearer " + t;
    const r = await fetch(base() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const e = new Error(method + " " + path + " → " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  function enqueue(job) {
    state.outbox.push(job);
    if (state.outbox.length > MAX_OUTBOX) state.outbox = state.outbox.slice(-MAX_OUTBOX);
    persist();
    flush();
  }
  async function ensureWalk(ride) {
    if (ride.walkId) return ride.walkId;
    const r = await call("POST", "/walks/start", {
      user_id: user(), start_node: ride.tour[0].node, planned: ride.tour.map(s => s.node),
    });
    ride.walkId = r.walk_id;
    persist();
    return ride.walkId;
  }
  async function run(job) {
    if (job.op === "review") {
      await call("POST", "/sr/review", { user_id: user(), node: job.node, quality: job.quality });
      return;
    }
    const ride = rideById(job.ride);
    if (!ride) return; // ride was forgotten; nothing to log
    const walkId = await ensureWalk(ride);
    if (job.op === "event") {
      await call("POST", "/walks/" + walkId + "/event", {
        user_id: user(), node: job.node, step_idx: job.step, lesson_mode: job.mode || "ride",
        quiz_quality: job.quality === undefined ? null : job.quality,
        duration_s: job.secs === undefined ? null : job.secs,
      });
    } else if (job.op === "complete") {
      await call("POST", "/walks/" + walkId + "/complete");
    }
  }
  async function flush() {
    if (flushing || !online || !base()) return;
    flushing = true;
    try {
      while (state.outbox.length) {
        try {
          await run(state.outbox[0]);
          state.outbox.shift();
          lastSync = now();
          persist();
        } catch (e) {
          const s = e.status || 0;
          if (s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429) {
            state.outbox.shift(); persist(); // the server can't use it; don't retry forever
            continue;
          }
          online = s === 401 ? online : false; // unreachable or erroring: try again later
          retryLater();
          break;
        }
      }
    } finally {
      flushing = false;
      save();
    }
  }
  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, RETRY_MS);
  }

  // Merge what the server knows into this browser (server cards win when newer).
  function hydrate(p) {
    const nodeOf = id => (window.BU_DATA && window.BU_DATA.NODES || []).find(n => n.id === id);
    (p.visited || []).forEach(v => {
      if (v.node && !isDone(v.node)) state.done[v.node] = Math.round((v.first_ts || 0) * 1000) || now();
    });
    (p.cards || []).forEach(c => {
      const mine = state.cards[c.node];
      if (!mine || (c.last_review_ts || 0) > (mine.last_review_ts || 0)) {
        state.cards[c.node] = {
          repetitions: c.repetitions, ef: c.ef, interval_days: c.interval_days,
          due_ts: c.due_ts, last_quality: c.last_quality, last_review_ts: c.last_review_ts,
        };
      }
    });
    // Walks this browser has never seen become rides, so Progress can show them.
    const known = new Set(state.rides.map(r => r.walkId).filter(Boolean));
    (p.walks || []).slice().reverse().forEach(w => {
      if (known.has(w.walk_id) || !Array.isArray(w.planned) || !w.planned.length) return;
      const tour = w.planned.filter(nodeOf).map((id, i, arr) => ({
        node: id, cluster: nodeOf(id).cluster,
        kind: i === 0 ? "start" : i === arr.length - 1 ? "capstone" : "deepen",
        rationale: "A ride restored from your history.",
      }));
      if (!tour.length) return;
      const reached = tour.filter(s => isDone(s.node)).length;
      state.rides.push({
        id: "w" + w.walk_id, walkId: w.walk_id, tour,
        idx: w.completed ? tour.length - 1 : Math.min(tour.length - 1, reached),
        started: Math.round((w.started_at || 0) * 1000), updated: Math.round((w.completed_at || w.started_at || 0) * 1000),
        finished: !!w.completed,
      });
    });
    state.rides.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    state.rides = state.rides.slice(0, MAX_RIDES);
    lastSync = now();
    save();
  }

  async function connect() {
    if (connecting || !base() || !window.fetch) return;
    connecting = true;
    try {
      // The app shell mints a demo token at load; give it a moment to land.
      for (let i = 0; i < 40 && !token(); i++) await sleep(250);
      try { await call("GET", "/health"); online = true; } catch (_) { online = false; retryLater(); return; }
      try { hydrate(await call("GET", "/progress?user_id=" + encodeURIComponent(user()))); }
      catch (e) { if (e.status !== 404) { online = false; retryLater(); return; } } // 404: an older API without /progress
      await flush();
    } finally { connecting = false; }
  }

  // ─── spaced repetition (SM-2, as agents/spaced_repetition.py) ──────
  function sm2(card, quality, t) {
    const q = Math.max(0, Math.min(5, Math.round(quality)));
    if (q < 3) { card.repetitions = 0; card.interval_days = 10 / (24 * 60); }
    else {
      card.interval_days = card.repetitions === 0 ? 1 : card.repetitions === 1 ? 6 : Math.max(1, card.interval_days * card.ef);
      card.repetitions += 1;
    }
    card.ef = Math.max(1.3, card.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    card.due_ts = t + card.interval_days * DAY_S;
    card.last_quality = q;
    card.last_review_ts = t;
    return card;
  }

  // ─── progress ──────────────────────────────────────────────────────
  function isDone(id) { return Object.prototype.hasOwnProperty.call(state.done, id); }
  function doneSet() { return new Set(Object.keys(state.done)); }
  function markDone(id) {
    if (!id || isDone(id)) return;
    state.done[id] = now();
    save();
  }
  function current() {
    return state.rides.find(r => r.id === state.current && !r.finished) || null;
  }

  // Start (or pick back up) a ride for this tour; it becomes the current one.
  function startRide(tour) {
    if (!tour || !tour.length) return null;
    let ride = state.rides.find(r => !r.finished && sameTour(r.tour, tour));
    if (!ride) {
      ride = { id: "r" + now().toString(36), tour, idx: 0, started: now(), updated: now(), arrived: now(), finished: false };
      state.rides.unshift(ride);
      state.rides = state.rides.slice(0, MAX_RIDES);
      enqueue({ op: "start", ride: ride.id });
    }
    state.current = ride.id;
    save();
    return ride;
  }
  // Keep the current ride's tour and position in step with the app.
  function update(tour, idx) {
    const ride = current();
    if (!ride || !tour) return;
    if (!sameTour(ride.tour, tour)) ride.tour = tour; // a change of line re-planned the route
    const at = Math.max(0, Math.min(tour.length - 1, idx));
    if (at !== ride.idx) ride.arrived = now();
    ride.idx = at;
    ride.updated = now();
    save();
  }
  // The learner moved on from stop `i` of the current ride.
  function leave(i) {
    const ride = current();
    const stop = ride && ride.tour[i];
    if (!stop) return;
    const secs = ride.arrived ? Math.round((now() - ride.arrived) / 1000) : undefined;
    if (!isDone(stop.node)) state.done[stop.node] = now();
    enqueue({ op: "event", ride: ride.id, node: stop.node, step: i, secs });
    save();
  }
  function finish() {
    const ride = current();
    if (!ride) return;
    const last = ride.tour[ride.tour.length - 1];
    const secs = ride.arrived ? Math.round((now() - ride.arrived) / 1000) : undefined;
    ride.tour.forEach(s => { if (!isDone(s.node)) state.done[s.node] = now(); });
    ride.finished = true;
    ride.idx = ride.tour.length - 1;
    ride.updated = now();
    state.current = null;
    enqueue({ op: "event", ride: ride.id, node: last.node, step: ride.tour.length - 1, secs });
    enqueue({ op: "complete", ride: ride.id });
    save();
  }
  function resume(id) {
    const ride = rideById(id);
    if (!ride) return null;
    if (ride.finished) { // riding it again is a new walk on the server
      ride.finished = false; ride.idx = 0; ride.walkId = null;
      enqueue({ op: "start", ride: ride.id });
    }
    state.current = ride.id;
    ride.updated = now(); ride.arrived = now();
    save();
    return ride;
  }

  // How well a stop landed: 2 "not yet", 4 "mostly", 5 "got it" (SM-2 quality).
  function rate(node, quality) {
    if (!node) return null;
    const t = now() / 1000;
    const card = state.cards[node] || { repetitions: 0, ef: 2.5, interval_days: 0, due_ts: 0, last_quality: -1, last_review_ts: 0 };
    state.cards[node] = sm2(card, quality, t);
    if (!isDone(node)) state.done[node] = now();
    const ride = current();
    const step = ride ? ride.tour.findIndex(s => s.node === node) : -1;
    if (ride && step >= 0) enqueue({ op: "event", ride: ride.id, node, step, quality: Math.round(quality), mode: "rating" });
    enqueue({ op: "review", node, quality: Math.round(quality) });
    save();
    return state.cards[node];
  }
  function card(node) { return state.cards[node] || null; }
  // Stops whose review is due, most overdue first.
  function due(at) {
    const t = (at || now()) / 1000;
    return Object.entries(state.cards)
      .filter(([, c]) => c.due_ts && c.due_ts <= t)
      .sort((a, b) => a[1].due_ts - b[1].due_ts)
      .map(([node, c]) => ({ node, ...c }));
  }

  // Days in a row with at least one stop done, counting back from today
  // (or yesterday, so the streak survives until you ride today).
  function streak() {
    const day = t => { const d = new Date(t); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
    const days = new Set(Object.values(state.done).concat(
      Object.values(state.cards).map(c => (c.last_review_ts || 0) * 1000).filter(Boolean)).map(day));
    let n = 0, t = new Date();
    if (!days.has(day(t))) t = new Date(t.getTime() - 864e5);
    while (days.has(day(t))) { n += 1; t = new Date(t.getTime() - 864e5); }
    return n;
  }

  if (typeof window.addEventListener === "function") window.addEventListener("online", () => connect());
  setTimeout(connect, 0);

  return {
    isDone, doneSet, markDone, startRide, current, update, leave, finish, resume, streak,
    rate, card, due,
    rides: () => state.rides.slice(),
    cards: () => Object.assign({}, state.cards),
    doneCount: () => Object.keys(state.done).length,
    sync: () => ({ online, pending: state.outbox.length, lastSync, server: base() }),
    connect,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { state = empty(); save(); },
  };
})();
