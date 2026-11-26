/* global React, BU_METRO, BU_PROGRESS */
// ─────────────────────────────────────────────────────────────────
// SCREENS · PROGRESS and END OF THE LINE (Train of Thought style)
//
// MetroProgress — the Progress tab: what you've ridden on the real map,
//   how well you know each line, your rides (Resume / Ride again), stops
//   due for review, and whether it's all saved to the server.
// MetroArrival — where "Finish the ride" lands: the route you rode, what it
//   added up to, how your ratings set up review, and "How was this ride?"
//   (sent to the backend as feedback on the walk).
// Both read window.BU_PROGRESS (progress.js) and window.BU_METRO (metro-map.jsx).
// ─────────────────────────────────────────────────────────────────

const { useState, useEffect, useMemo } = React;

const PLURAL = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const RATED_AS = q => (q >= 5 ? "Got it" : q >= 3 ? "Mostly" : "Not yet");

function progressAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return PLURAL(h, "hour", "hours") + " ago";
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d + " days ago";
}
function progressDueIn(card) {
  const s = (card && card.due_ts ? card.due_ts : 0) - Date.now() / 1000;
  if (s <= 0) return "now";
  if (s < 3600) return "in " + PLURAL(Math.max(1, Math.round(s / 60)), "minute", "minutes");
  if (s < 36 * 3600) return "tomorrow";
  return "in " + Math.round(s / 86400) + " days";
}

// Re-render whenever progress changes (a stop logged, the server sync landing).
function useProgress() {
  const [, setVer] = useState(0);
  useEffect(() => (window.BU_PROGRESS ? BU_PROGRESS.subscribe(() => setVer(v => v + 1)) : undefined), []);
  return window.BU_PROGRESS || null;
}

// A review ride: the most overdue stops, as many as the ticket covers.
function reviewTour(net, due, k) {
  const n = Math.min(due.length, k);
  return due.slice(0, n).map((c, i) => ({
    node: c.node, cluster: net.byId[c.node].cluster,
    kind: i === 0 ? "start" : i === n - 1 ? "capstone" : "deepen",
    rationale: `Review: you rated this "${RATED_AS(c.last_quality)}" last time. Rate it again to set the next review.`,
  }));
}

function SyncLine({ sync }) {
  if (!sync || !sync.server) return <span className="metro-note">Saved in this browser.</span>;
  if (sync.online) {
    return <span className="metro-note">{sync.pending ? `Saving ${PLURAL(sync.pending, "change", "changes")} to the server…` : "Saved to the server."}</span>;
  }
  return (
    <span className="metro-note">
      Saved in this browser. {sync.pending ? PLURAL(sync.pending, "change", "changes") + " will" : "It will"} sync when the server is reachable.
    </span>
  );
}

// The stops of a ride as a little line: filled where ridden, in each stop's line colour.
function MiniRoute({ tour, reached, net }) {
  return (
    <div className="metro-mini" aria-hidden="true">
      {tour.map((s, i) => {
        const L = net.lineOfCluster[s.cluster], color = L ? L.color : "#d4351c", on = i < reached;
        return (
          <React.Fragment key={s.node + i}>
            {i > 0 && <i style={{ background: on ? color : BU_METRO.mix(color, 0.65) }} />}
            <b style={{ borderColor: color, background: on ? color : "#ffffff" }} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

function masteryRows(net, done, cards) {
  // agents/heatmap.py's formula: 0.3 visits + 0.4 ratings + 0.3 review depth
  return net.lines.map(L => {
    const seen = L.stops.filter(id => done.has(id)).length;
    const rated = L.stops.map(id => cards[id]).filter(c => c && c.last_quality >= 0);
    if (!seen && !rated.length) return null;
    const avg = rated.length ? rated.reduce((a, c) => a + c.last_quality, 0) / rated.length : 0;
    const depth = rated.length ? rated.reduce((a, c) => a + Math.min(3, c.repetitions) / 3, 0) / rated.length : 0;
    return { L, seen, rated: rated.length, avg, score: 0.3 * (seen / L.stops.length) + 0.4 * (avg / 5) + 0.3 * depth };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

// ─── Progress ─────────────────────────────────────────────────────
function MetroProgress({ onMap, onStartRide, onResumeRide, onShow3D }) {
  const P = useProgress();
  const net = BU_METRO.network();
  const done = P ? P.doneSet() : new Set();
  const cards = P ? P.cards() : {};
  const due = P ? P.due().filter(c => net.byId[c.node]) : [];
  const dueIds = new Set(due.map(c => c.node));
  const rides = P ? P.rides() : [];
  const n = done.size, minutes = n * BU_METRO.MIN_PER_STOP;
  const started = net.lines.filter(L => L.stops.some(id => done.has(id))).length;
  const streak = P ? P.streak() : 0;
  const rows = masteryRows(net, done, cards);
  const k = BU_METRO.stopsForTime(BU_METRO.readPref("bu_metro_time", 15));
  const empty = !n && !rides.length;

  const openMapAt = (li, id) => {
    const L = net.lines[li];
    BU_METRO.writePref(id ? "bu_metro_start" : "bu_metro_line", id ? { cid: L.cid, id } : L.cid);
    onMap && onMap();
  };
  const review = () => onStartRide && onStartRide(reviewTour(net, due, k));

  return (
    <div className="metro metro-page metro-stack">
      <section className="metro-card metro-pad" aria-labelledby="prog-title">
        <div className="metro-headrow">
          <div>
            <h1 id="prog-title" className="metro-h1">Your progress</h1>
            {empty
              ? <span className="metro-note">Nothing ridden yet. Pick a line on the map: the stops you ride, how well they landed and your rides all show up here.</span>
              : <SyncLine sync={P && P.sync()} />}
          </div>
          <div className="metro-actions">
            {due.length > 0 && (
              <button type="button" className="metro-btn ghost" onClick={review}>
                Review {PLURAL(Math.min(due.length, k), "stop", "stops")}
              </button>
            )}
            <button type="button" className="metro-cta metro-cta-inline" onClick={onMap}>
              <BU_METRO.TrainGlyph width={30} windows="#d4351c" outline={null} wheels="#ffffff" stripe={null} />
              {empty ? "Plan your first ride" : "Plan a ride"}
            </button>
          </div>
        </div>
        <div className="metro-stats">
          <div className="metro-stat"><b>{n}</b><span>{n === 1 ? "stop ridden" : "stops ridden"}</span></div>
          <div className="metro-stat"><b>{minutes}</b><span>minutes of ideas</span></div>
          <div className="metro-stat"><b>{started}<small> of {net.lines.length}</small></b><span>lines started</span></div>
          <div className="metro-stat"><b>{streak}</b><span>{streak === 1 ? "day in a row" : "days in a row"}</span></div>
        </div>
        {due.length > 0 && (
          <div className="metro-review" style={{ marginTop: 14 }}>
            <div>
              <b>Review · {PLURAL(due.length, "stop", "stops")} due</b>
              <span>{BU_METRO.listAnd(due.slice(0, 3).map(c => net.byId[c.node].name))}{due.length > 3 ? " and more" : ""}</span>
            </div>
            <button type="button" className="metro-btn ghost" onClick={review}>Review now</button>
          </div>
        )}
      </section>

      <section className="metro-card metro-pad" aria-labelledby="prog-map">
        <div className="metro-headrow">
          <h2 id="prog-map" className="metro-h2">Your map</h2>
          <span className="metro-note">Ridden stretches are in full colour. Click a stop to plan a ride from it.</span>
        </div>
        <div className="metro-mapbox">
          <BU_METRO.MetroSvg net={net} litOf={L => L.stops.filter(id => done.has(id))}
                             isDone={id => done.has(id)} dueIds={dueIds}
                             onPickLine={li => openMapAt(li)} onPickStop={(li, id) => openMapAt(li, id)}
                             ariaLabel={`Your topic map: ${PLURAL(n, "stop", "stops")} ridden across ${PLURAL(started, "line", "lines")}, shown filled in with ridden stretches in full colour${due.length ? `; ${PLURAL(due.length, "stop is", "stops are")} due for review, ringed in amber` : ""}.`} />
        </div>
        <div className="metro-key">
          <span><svg aria-hidden="true" viewBox="0 0 40 12" width="40" height="12"><path d="M4 6 L36 6" stroke="#d4351c" strokeWidth="8" strokeLinecap="round" /></svg>Ridden</span>
          <span><svg aria-hidden="true" viewBox="0 0 40 12" width="40" height="12"><path d="M4 6 L36 6" stroke="#f2b9ae" strokeWidth="8" strokeLinecap="round" /></svg>Not yet</span>
          <span><svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="6" fill="#d4351c" stroke="#d4351c" strokeWidth="3" /><path d="M6 9 l2.2 2.4 l4 -4.6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Done</span>
          {due.length > 0 && <span><svg aria-hidden="true" viewBox="0 0 26 26" width="24" height="24"><circle cx="13" cy="13" r="10" fill="none" stroke="#e8a100" strokeWidth="3" /><circle cx="13" cy="13" r="5.5" fill="#ffffff" stroke="#d4351c" strokeWidth="3" /></svg>Due for review</span>}
        </div>
      </section>

      <div className="metro-split">
        <section className="metro-card metro-pad" aria-labelledby="prog-lines">
          <h2 id="prog-lines" className="metro-h2">How well you know each line</h2>
          {rows.length ? (
            <ul className="metro-mastery">
              {rows.map(r => (
                <li key={r.L.cid}>
                  <button type="button" onClick={() => openMapAt(r.L.index)}>
                    <span className="metro-mastery-name"><i style={{ background: r.L.color }} aria-hidden="true" />{r.L.name}</span>
                    <span className="metro-mastery-bar" role="img" aria-label={`${Math.round(r.score * 100)} percent`}>
                      <span style={{ width: Math.max(3, Math.round(r.score * 100)) + "%", background: r.L.color }} />
                    </span>
                    <span className="metro-note">
                      {r.seen}/{r.L.stops.length} stops{r.rated ? ` · rated ${r.avg.toFixed(1)} of 5` : " · not rated yet"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="metro-note">Ride a line and rate its stops to see this fill in.</p>}
          <p className="metro-note" style={{ marginTop: 10 }}>
            Built from the stops you've ridden, how well you said they landed, and how many reviews they've lasted.
          </p>
        </section>

        <section className="metro-card metro-pad" aria-labelledby="prog-rides">
          <h2 id="prog-rides" className="metro-h2">Your rides</h2>
          {rides.length ? (
            <ul className="metro-rides">
              {rides.slice(0, 8).map(r => {
                const reached = r.finished ? r.tour.length : r.idx;
                const name = id => (net.byId[id] ? net.byId[id].name : String(id).replace(/_/g, " "));
                const here = r.tour[Math.min(r.idx, r.tour.length - 1)];
                return (
                  <li key={r.id}>
                    <div style={{ minWidth: 0 }}>
                      <b>{r.tour.length === 1 ? name(r.tour[0].node) : `${name(r.tour[0].node)} → ${name(r.tour[r.tour.length - 1].node)}`}</b>
                      <MiniRoute tour={r.tour} reached={reached} net={net} />
                      <span className="metro-note">
                        {PLURAL(r.tour.length, "stop", "stops")} · {r.tour.length * BU_METRO.MIN_PER_STOP} min · {r.finished ? "finished" : `stopped at ${name(here.node)}`} {progressAgo(r.updated || r.started)}
                      </span>
                    </div>
                    <button type="button" className="metro-btn ghost" onClick={() => onResumeRide && onResumeRide(r.id)}>
                      {r.finished ? "Ride again" : "Resume"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="metro-note">Your rides appear here, so you can pick one back up.</p>}
        </section>
      </div>

      {onShow3D && (
        <button type="button" className="metro-linkbtn" style={{ alignSelf: "center" }} onClick={onShow3D}>
          See where you've been on the 3D brain
        </button>
      )}
    </div>
  );
}

// ─── End of the line ──────────────────────────────────────────────
function MetroArrival({ tour, onMap, onProgress, onStartRide }) {
  const P = useProgress();
  const net = BU_METRO.network();
  const sameTour = (a, b) => a.length === b.length && a.every((s, i) => s.node === b[i].node);
  const ride = useMemo(() => {
    const rs = P ? P.rides() : [];
    return (tour && rs.find(r => r.finished && sameTour(r.tour, tour))) || rs.find(r => r.finished) || null;
  }, [tour]);
  const route = (ride && ride.tour) || tour || [];
  const [thumb, setThumb] = useState(ride && ride.feedback ? ride.feedback.thumb : 0);
  const [note, setNote] = useState(ride && ride.feedback ? ride.feedback.note : "");
  const [sent, setSent] = useState(!!(ride && ride.feedback));

  if (!route.length) {
    return (
      <div className="metro metro-page metro-stack">
        <section className="metro-card metro-pad">
          <h1 className="metro-h1">No ride finished yet</h1>
          <p className="metro-note">Ride a line to the end and its summary lands here.</p>
          <button type="button" className="metro-cta metro-cta-inline" onClick={onMap}>Plan a ride</button>
        </section>
      </div>
    );
  }

  const name = id => (net.byId[id] ? net.byId[id].name : String(id).replace(/_/g, " "));
  const lines = [...new Set(route.map(s => s.cluster))];
  const changes = route.filter((s, i) => i > 0 && s.cluster !== route[i - 1].cluster).length;
  const since = ride ? ride.started / 1000 : 0;
  const cards = P ? P.cards() : {};
  const rated = route.map(s => ({ s, c: cards[s.node] })).filter(x => x.c && x.c.last_review_ts >= since - 1);
  const tally = rated.reduce((t, x) => { const k = RATED_AS(x.c.last_quality); t[k] = (t[k] || 0) + 1; return t; }, {});
  const soonest = rated.slice().sort((a, b) => a.c.due_ts - b.c.due_ts)[0];
  const due = P ? P.due().filter(c => net.byId[c.node]) : [];
  const k = BU_METRO.stopsForTime(BU_METRO.readPref("bu_metro_time", 15));

  const send = () => {
    if (!ride || !thumb) return;
    P.feedback(ride.id, thumb, note.trim());
    setSent(true);
  };

  return (
    <div className="metro metro-page metro-stack">
      <section className="metro-card metro-pad" aria-labelledby="arrive-title">
        <span className="metro-ride-tag">End of the line</span>
        <h1 id="arrive-title" className="metro-h1">
          {route.length === 1 ? `You rode ${name(route[0].node)}` : `You rode from ${name(route[0].node)} to ${name(route[route.length - 1].node)}`}
        </h1>
        <ol className="metro-route" aria-label="The stops you rode">
          {route.map((s, i) => {
            const L = net.lineOfCluster[s.cluster], color = L ? L.color : "#d4351c";
            return (
              <li key={s.node + i}>
                {i > 0 && <i aria-hidden="true" style={{ background: color }} />}
                <b aria-hidden="true" style={{ background: color, borderColor: color }} />
                <span>{name(s.node)}</span>
              </li>
            );
          })}
        </ol>
        <div className="metro-stats">
          <div className="metro-stat"><b>{route.length}</b><span>{route.length === 1 ? "stop" : "stops"}</span></div>
          <div className="metro-stat"><b>{route.length * BU_METRO.MIN_PER_STOP}</b><span>minutes of ideas</span></div>
          <div className="metro-stat"><b>{lines.length}</b><span>{lines.length === 1 ? "line" : "lines"}</span></div>
          <div className="metro-stat"><b>{changes}</b><span>{changes === 1 ? "change of line" : "changes of line"}</span></div>
        </div>
        <p className="metro-arrive-text">
          {rated.length
            ? <>You rated {rated.length} of {PLURAL(route.length, "stop", "stops")}: {Object.entries(tally).map(([k2, v]) => `${v} ${k2}`).join(", ")}. {name(soonest.s.node)} comes back for review {progressDueIn(soonest.c)}.</>
            : "You didn't rate any stops this time. On your next ride, say how well each one landed and it comes back for review at the right time."}
        </p>
      </section>

      <section className="metro-card metro-pad" aria-labelledby="arrive-fb">
        <h2 id="arrive-fb" className="metro-h2">How was this ride?</h2>
        {sent ? (
          <p className="metro-note" role="status">Thanks, that's saved{P && P.sync().server ? " and sent to the server" : ""}. It helps plan better rides.</p>
        ) : (
          <>
            <div role="group" aria-label="How was this ride?" className="metro-thumbs">
              <button type="button" aria-pressed={thumb === 1} className={"metro-rate" + (thumb === 1 ? " on" : "")} onClick={() => setThumb(1)}>Useful</button>
              <button type="button" aria-pressed={thumb === -1} className={"metro-rate" + (thumb === -1 ? " on" : "")} onClick={() => setThumb(-1)}>Not for me</button>
            </div>
            <label htmlFor="arrive-note" className="metro-label-strong" style={{ marginTop: 12, display: "block" }}>What clicked? What's still hazy? <span className="metro-note">(optional)</span></label>
            <textarea id="arrive-note" className="metro-input metro-textarea" value={note} onChange={e => setNote(e.target.value)} rows={3} />
            <button type="button" className="metro-btn dark" style={{ marginTop: 10 }} disabled={!thumb || !ride} onClick={send}>Send</button>
          </>
        )}
      </section>

      <div className="metro-actions" style={{ justifyContent: "center" }}>
        {due.length > 0 && onStartRide && (
          <button type="button" className="metro-btn ghost" onClick={() => onStartRide(reviewTour(net, due, k))}>
            Review {PLURAL(Math.min(due.length, k), "stop", "stops")} due
          </button>
        )}
        <button type="button" className="metro-btn ghost" onClick={onProgress}>See your progress</button>
        <button type="button" className="metro-cta metro-cta-inline" onClick={onMap}>Plan another ride</button>
      </div>
    </div>
  );
}

window.MetroProgress = MetroProgress;
window.MetroArrival = MetroArrival;
