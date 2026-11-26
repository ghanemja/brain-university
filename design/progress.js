// Brain University — what this learner has ridden, kept in this browser.
//
// window.BU_PROGRESS remembers two things in localStorage:
//   done  — every stop (concept id) the learner has moved on from, with when
//   rides — each ride: its tour (the shared [{ node, cluster, kind, rationale }]
//           format), where the learner is on it, and whether it is finished
// The Map uses it to start tickets at the next unridden stop, Learn to resume
// after a reload, and Progress to show real history. Nothing leaves the
// browser; a private window or cleared storage simply starts fresh.
window.BU_PROGRESS = (() => {
  const KEY = "bu_progress_v1";
  const MAX_RIDES = 40;
  const empty = () => ({ v: 1, done: {}, rides: [], current: null });
  let state = empty();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.v === 1 && raw.done && Array.isArray(raw.rides)) state = raw;
  } catch (_) { /* unreadable or blocked storage: start fresh */ }

  const listeners = new Set();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* private mode */ }
    listeners.forEach(fn => { try { fn(); } catch (_) { /* a listener's own problem */ } });
  };
  const now = () => Date.now();
  const sameTour = (a, b) => a.length === b.length && a.every((s, i) => s.node === b[i].node);

  function isDone(id) { return Object.prototype.hasOwnProperty.call(state.done, id); }
  function doneSet() { return new Set(Object.keys(state.done)); }
  function markDone(id) {
    if (!id || isDone(id)) return;
    state.done[id] = now();
    save();
  }

  // Start (or pick back up) a ride for this tour; it becomes the current one.
  function startRide(tour) {
    if (!tour || !tour.length) return null;
    let ride = state.rides.find(r => !r.finished && sameTour(r.tour, tour));
    if (!ride) {
      ride = { id: "r" + now().toString(36), tour, idx: 0, started: now(), updated: now(), finished: false };
      state.rides.unshift(ride);
      state.rides = state.rides.slice(0, MAX_RIDES);
    }
    state.current = ride.id;
    save();
    return ride;
  }
  function current() {
    return state.rides.find(r => r.id === state.current && !r.finished) || null;
  }
  // Keep the current ride's tour and position in step with the app.
  function update(tour, idx) {
    const ride = current();
    if (!ride || !tour) return;
    if (!sameTour(ride.tour, tour)) ride.tour = tour; // a fork changed the route
    ride.idx = Math.max(0, Math.min(tour.length - 1, idx));
    ride.updated = now();
    save();
  }
  function finish() {
    const ride = current();
    if (!ride) return;
    ride.tour.forEach(s => { if (!isDone(s.node)) state.done[s.node] = now(); });
    ride.finished = true;
    ride.idx = ride.tour.length - 1;
    ride.updated = now();
    state.current = null;
    save();
  }
  function resume(id) {
    const ride = state.rides.find(r => r.id === id);
    if (!ride) return null;
    if (ride.finished) { ride.finished = false; ride.idx = 0; }
    state.current = ride.id;
    ride.updated = now();
    save();
    return ride;
  }

  // Days in a row with at least one stop done, counting back from today
  // (or yesterday, so the streak survives until you ride today).
  function streak() {
    const day = t => { const d = new Date(t); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
    const days = new Set(Object.values(state.done).map(day));
    let n = 0, t = new Date();
    if (!days.has(day(t))) t = new Date(t.getTime() - 864e5);
    while (days.has(day(t))) { n += 1; t = new Date(t.getTime() - 864e5); }
    return n;
  }

  return {
    isDone, doneSet, markDone, startRide, current, update, finish, resume, streak,
    rides: () => state.rides.slice(),
    doneCount: () => Object.keys(state.done).length,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { state = empty(); save(); },
  };
})();
