/* global React, BU_DATA, CourseChip, KindGlyph, TopoRidge, BrainGraph3D */

const { useState, useEffect, useMemo } = React;

// ─────────────────────────────────────────────────────────────────
// SCREEN 5 — RETURNING-LEARNER DASHBOARD
// "What trails you've walked, what's open, where you stopped."
// ─────────────────────────────────────────────────────────────────

// Pick ~14 real, high-degree node IDs from BU_DATA.NODES so the dashboard
// 3D brain highlights nodes that actually exist (the old hardcoded list
// silently dropped 10 of 14 because the IDs didn't match the corpus).
function _demoVisitedSet() {
  try {
    const nodes = (window.BU_DATA?.NODES) || [];
    if (!nodes.length) return new Set();
    const sorted = [...nodes].sort((a, b) => (b.weight || b.degree || 0) - (a.weight || a.degree || 0));
    return new Set(sorted.slice(0, 14).map(n => n.id));
  } catch {
    return new Set();
  }
}

// Demo trails — each carries a real start_node so Resume actually plans a
// tour from that concept (not a hardcoded fallback).
const MOCK_TRAILS = [
  {
    id: "t1", title: "Reynolds → Manifolds → Markov chains",
    start_node: "Reynolds_number",
    started: "yesterday", progress: 1.0, stops: 6, courses: 3,
    summary: "Aero → Diff geo → Info theory. Capstone reached.",
    color: "#7641eb",
  },
  {
    id: "t2", title: "Graph theory → Louvain → PageRank",
    start_node: "Graph_theory",
    started: "3 days ago", progress: 0.5, stops: 6, courses: 2,
    summary: "Stopped at PageRank — bridge to information theory pending.",
    color: "#2ec4b6",
  },
  {
    id: "t3", title: "State space → Kalman → Hodgkin-Huxley",
    start_node: "State_space",
    started: "last week", progress: 0.83, stops: 6, courses: 3,
    summary: "Almost summit — one stop left in cellular biology.",
    color: "#1e6fa8",
  },
];

// Real history from BU_PROGRESS (rides on the Map / Learn screens), shaped
// like the demo trails so the same cards render it. Null when this browser
// hasn't ridden anything yet, in which case the dashboard stays a demo.
function _ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d + " days ago";
}
function _realHistory() {
  const P = window.BU_PROGRESS;
  if (!P) return null;
  const rides = P.rides();
  if (!P.doneCount() && !rides.length) return null;
  const node = id => BU_DATA.NODES.find(n => n.id === id);
  const nameOf = id => (node(id) || {}).name || String(id).replace(/_/g, " ");
  const lineOf = c => ((BU_DATA.CLUSTERS[c] || {}).name || "?");
  const net = window.BU_METRO && window.BU_METRO.network ? window.BU_METRO.network() : null;
  const colorOf = c => (net && net.lineOfCluster[c] ? net.lineOfCluster[c].color : (BU_DATA.CLUSTERS[c] || {}).color || "#d4351c");
  const done = P.doneSet();
  const total = net ? net.lines.reduce((a, L) => a + L.stops.length, 0) : BU_DATA.NODES.filter(n => !n.kind).length;
  const courses = new Set([...done].map(id => (node(id) || {}).cluster).filter(c => c !== undefined));
  const trails = rides.map(r => {
    const lines = [...new Set(r.tour.map(s => s.cluster))];
    const here = r.tour[Math.min(r.idx, r.tour.length - 1)];
    return {
      id: r.id,
      title: r.tour.length === 1 ? nameOf(r.tour[0].node)
        : nameOf(r.tour[0].node) + " → " + nameOf(r.tour[r.tour.length - 1].node),
      started: _ago(r.updated),
      progress: r.finished ? 1 : r.idx / r.tour.length,
      stops: r.tour.length, courses: lines.length,
      summary: r.finished
        ? "Finished the " + lines.map(lineOf).join(" and ") + (lines.length > 1 ? " lines." : " line.")
        : "Stopped at " + nameOf(here.node) + " on the " + lineOf(here.cluster) + " line.",
      color: colorOf(r.tour[0].cluster),
    };
  });
  // How well you know each line — the backend heatmap's formula
  // (agents/heatmap.py: 0.3 visits + 0.4 ratings + 0.3 review depth),
  // over the same data the server holds for this learner.
  const cards = P.cards ? P.cards() : {};
  const mastery = (net ? net.lines : []).map(L => {
    const seen = L.stops.filter(id => done.has(id)).length;
    const rated = L.stops.map(id => cards[id]).filter(c => c && c.last_quality >= 0);
    if (!seen && !rated.length) return null;
    const visit = seen / L.stops.length;
    const quiz = rated.length ? rated.reduce((a, c) => a + c.last_quality, 0) / rated.length / 5 : 0;
    const depth = rated.length ? rated.reduce((a, c) => a + Math.min(3, c.repetitions) / 3, 0) / rated.length : 0;
    return {
      name: L.name, color: L.color, score: 0.3 * visit + 0.4 * quiz + 0.3 * depth,
      seen, total: L.stops.length, rated: rated.length,
      avg: rated.length ? rated.reduce((a, c) => a + c.last_quality, 0) / rated.length : 0,
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return { done, total, courses: courses.size, trails, streak: P.streak(), mastery,
           due: P.due ? P.due().length : 0, sync: P.sync ? P.sync() : null };
}

function SyncNote({ sync }) {
  if (!sync || !sync.server) return null;
  const text = sync.online
    ? (sync.pending ? `Saving ${sync.pending} change${sync.pending > 1 ? "s" : ""} to the server…` : "Saved to the server.")
    : `Saved in this browser; ${sync.pending ? sync.pending + " change" + (sync.pending > 1 ? "s" : "") + " will" : "it will"} sync when the server is reachable.`;
  return <p className="t-cap" style={{ margin: "4px 0 0", color: "var(--c-ink-muted)" }}>{text}</p>;
}

function LineMastery({ rows, due, onNewTrail }) {
  return (
    <div className="card" style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <div className="t-tag" style={{ color: "var(--c-ink-muted)" }}>HOW WELL YOU KNOW EACH LINE</div>
        {due > 0 && (
          <button className="btn" onClick={onNewTrail}>{due} {due === 1 ? "stop" : "stops"} due for review · open the map</button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr auto", gap: 12, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ flex: "none", width: 22, height: 7, borderRadius: 4, background: r.color }} />
              {r.name}
            </span>
            <div role="img" aria-label={`${Math.round(r.score * 100)} percent`} style={{ height: 8, borderRadius: 4, background: "var(--c-bg-elev-2)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(r.score * 100)}%`, height: "100%", background: r.color }} />
            </div>
            <span className="t-cap" style={{ whiteSpace: "nowrap" }}>
              {r.seen}/{r.total} stops{r.rated ? ` · rated ${r.avg.toFixed(1)}/5` : " · not rated yet"}
            </span>
          </div>
        ))}
      </div>
      <div className="t-cap" style={{ marginTop: 12 }}>
        Stops you've ridden, how well you said they landed, and how many reviews they've survived.
      </div>
    </div>
  );
}

// Plain-English RL metric cell with hover-tooltip explaining the math.
function MetricCell({ label, value, valueColor, tooltip, jargon }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ position: "relative", cursor: "help" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ fontSize: 11.5, color: "var(--c-ink-muted)", letterSpacing: 0.2, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: valueColor, fontFamily: "var(--f-mono)" }}>
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--c-ink-dim)", marginTop: 3, fontFamily: "var(--f-mono)" }}>
        {jargon}
      </div>
      {hover && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)", left: 0,
          zIndex: 50,
          width: 260,
          padding: 10,
          background: "var(--c-bg-elev-2)",
          border: "1px solid var(--c-line-strong)",
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--c-ink)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}>
          {tooltip}
        </div>
      )}
    </div>
  );
}

function Dashboard({ learner, onResume, onResumeRide, onNewTrail }) {
  // Re-read when progress changes (a ride logged, the server sync landing).
  const [ver, setVer] = useState(0);
  useEffect(() => (window.BU_PROGRESS ? window.BU_PROGRESS.subscribe(() => setVer(v => v + 1)) : undefined), []);
  const real = useMemo(_realHistory, [ver]);
  const totalNodesVisited = real ? real.done.size : 14;
  const totalCourses = real ? real.courses : 4;
  const totalConcepts = real ? real.total : BU_DATA.NODES.length;
  const visitedSet = useMemo(() => (real ? real.done : _demoVisitedSet()), [real]);
  return (
    <div style={{ minHeight: "calc(100vh - 56px)" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 56, pointerEvents: "none", opacity: 0.45 }}>
        <TopoRidge height={420} layers={6} />
      </div>

      <div style={{ position: "relative", maxWidth: 1120, margin: "0 auto", padding: "48px 28px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32 }}>
          <div>
            <div className="t-tag" style={{ color: "var(--c-ink-muted)" }}>
              {real ? "YOUR PROGRESS" : learner?.interest ? "WELCOME BACK" : "DEMO DASHBOARD"}
            </div>
            <h1 className="t-display" style={{ margin: "6px 0 0" }}>
              {learner?.name || "Learner"}
            </h1>
            <p className="t-cap" style={{ margin: "6px 0 0" }}>
              {real
                ? <>{totalNodesVisited} stops ridden · {totalNodesVisited * 5} minutes · {totalCourses} {totalCourses === 1 ? "line" : "lines"} entered ·{" "}</>
                : <>{totalNodesVisited} concepts walked · {totalCourses} courses entered ·{" "}</>}
              <span style={{ color: "var(--c-ink-muted)" }}>{Math.max(0, totalConcepts - totalNodesVisited)} {real ? "stops to go" : "concepts unwalked"}</span>
            </p>
            {!real && (
              <p className="t-cap" style={{ margin: "4px 0 0", color: "var(--c-ink-muted)" }}>
                Ride a line on the Map and your real progress replaces this demo.
              </p>
            )}
            {real && <SyncNote sync={real.sync} />}
          </div>
          <button className="btn primary" onClick={onNewTrail}>
            Plan a ride on the map
          </button>
        </div>

        {real && real.mastery.length > 0 && <LineMastery rows={real.mastery} due={real.due} onNewTrail={onNewTrail} />}

        {/* Progress on the brain */}
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--c-line)",
                        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="t-h3">Where you've been on the brain</div>
              <div className="t-cap" style={{ marginTop: 2 }}>
                Visited concepts in amber. Hovering rotates the camera.
              </div>
            </div>
            <span className="t-mono" style={{ fontSize: 11, color: "var(--c-ink-muted)" }}>
              {totalNodesVisited}/{totalConcepts} ·
              <span style={{ color: "var(--c-visited)" }}> {Math.round(100*totalNodesVisited/totalConcepts)}% explored</span>
            </span>
          </div>
          <div style={{ height: 360, background: "var(--c-bg-elev-2)" }}>
            <BrainGraph3D
              visited={visitedSet}
              showLabels="hubs"
              cinematic={true}
              background="var(--c-bg-elev-2)"
            />
          </div>
        </div>

        {/* Trails grid */}
        <div className="t-tag" style={{ color: "var(--c-ink-muted)", marginBottom: 12 }}>
          {real ? "YOUR RIDES" : "YOUR TRAIL JOURNAL (DEMO)"}
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px,1fr))",
          gap: 12,
        }}>
          {real
            ? real.trails.map(t => (
                <TrailCard key={t.id} trail={t} onResume={() => onResumeRide && onResumeRide(t.id)} />
              ))
            : MOCK_TRAILS.map(t => (
                <TrailCard key={t.id} trail={t} onResume={() => onResume(t.start_node)} />
              ))}
          {/* Surprise me card */}
          <div className="card" style={{
            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
            minHeight: 200, cursor: "pointer",
            border: "1px dashed var(--c-line-strong)",
            background: "transparent",
          }} onClick={onNewTrail}>
            <div style={{ fontSize: 28, color: "var(--c-bridge)", marginBottom: 6 }}>≈</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Surprise me</div>
            <div className="t-cap" style={{ textAlign: "center", maxWidth: 200 }}>
              Pick a random unvisited peak with high cross-course span.
            </div>
          </div>
        </div>

        {/* Streaks / RL feedback (subtle, no gamification slop) */}
        <div style={{ marginTop: 32,
                      display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div className="card" style={{ position: "relative" }}>
            <span style={{
              position: "absolute", top: 12, right: 14,
              fontSize: 10, letterSpacing: "0.10em",
              padding: "3px 8px", borderRadius: 999,
              background: "color-mix(in oklch, var(--c-here, #f96167) 14%, transparent)",
              color: "var(--c-here, #f96167)",
              fontFamily: "var(--f-mono)",
            }}>DEMO DATA</span>
            <div className="t-tag" style={{ color: "var(--c-ink-muted)", marginBottom: 12 }}>
              SYSTEM IS LEARNING FROM YOU
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
              <MetricCell
                label="Interest in Manifold concepts"
                value="+34%"
                valueColor="var(--c-ink)"
                tooltip="Hebbian boost — clicks and dwell time on Manifold-related nodes increased the graph weight into that cluster by 0.34. Future recommendations lean here."
                jargon="Hebbian +0.34"
              />
              <MetricCell
                label="Memory of older sessions"
                value="92% kept / week"
                valueColor="var(--c-ink)"
                tooltip="Eligibility decay (λ=0.92) — each session retains 92% of prior interest signal. Old clicks fade so the system tracks current you, not last-year you."
                jargon="λ = 0.92 / session"
              />
              <MetricCell
                label="Lesson quality vs. no-RL"
                value="+12% better"
                valueColor="var(--c-cs)"
                tooltip="Auto-judge — a rubric grader scored your last 6 lessons 12 points higher than the same lessons would've scored without RL re-weighting. The personalization is helping."
                jargon="+12 vs baseline"
              />
            </div>
            <div className="t-cap" style={{ marginTop: 14 }}>
              Your last 6 walks re-weighted the graph for the next learner. Hover any metric to see the math.
            </div>
          </div>
          <div className="card recessed" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
            <div className="t-tag" style={{ color: "var(--c-ink-muted)" }}>STREAK</div>
            <div className="t-num" style={{ marginTop: 6, color: "var(--c-visited)" }}>{real ? real.streak : 4}</div>
            <div className="t-cap" style={{ marginTop: 2 }}>{real ? (real.streak === 1 ? "day riding" : "days riding") : "days walking (demo)"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrailCard({ trail, onResume }) {
  const done = trail.progress >= 1;
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10,
                                    padding: 16, cursor: "pointer" }} onClick={onResume}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="t-tag" style={{ color: "var(--c-ink-muted)" }}>
            {done ? "★ COMPLETED" : "RESUME · " + trail.started.toUpperCase()}
          </div>
          <h3 style={{ margin: "4px 0 0", fontSize: 15.5, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
            {trail.title}
          </h3>
        </div>
        {done && <span style={{ color: "var(--c-summit)", fontSize: 18 }}>★</span>}
      </div>
      <div className="t-cap" style={{ flex: 1 }}>{trail.summary}</div>
      {/* Topo-style progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, height: 6, borderRadius: 3,
          background: "var(--c-bg-elev-2)",
          overflow: "hidden",
        }}>
          <div style={{
            width: `${trail.progress * 100}%`, height: "100%",
            background: done
              ? "linear-gradient(90deg, var(--c-here), var(--c-visited), var(--c-bridge), var(--c-summit))"
              : "linear-gradient(90deg, var(--c-here), var(--c-visited))",
          }} />
        </div>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--c-ink-muted)" }}>
          {Math.round(trail.progress * trail.stops)}/{trail.stops}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SCREEN 6 — PROPOSE
// Strip the "?" placeholder course name that the upstream synthesis
// generator leaks when a cluster has no name. e.g.
//   "spans 5 courses (?, cycle participation, graph coloring, ...)"
// becomes
//   "spans 5 courses (cycle participation, graph coloring, ...)"
function _cleanSynthesis(text) {
  if (!text) return text;
  return text
    .replace(/\(\?\s*,\s*/g, "(")
    .replace(/,\s*\?\s*\)/g, ")")
    .replace(/,\s*\?\s*,/g, ",")
    .replace(/\(\s*\?\s*\)/g, "")
    .replace(/\s{2,}/g, " ");
}

// Free-text idea → matched concepts + grounded synthesis
// ─────────────────────────────────────────────────────────────────

// Normalize the live /propose backend response to the render shape the
// Propose screen expects (and which the mock examples already use).
function _normalizePropose(r) {
  if (!r) return null;
  const matched = (r.matched_concepts || [])
    .map(m => m.name || m.id).filter(Boolean);
  const bridges = (r.bridge_paths || []).map(b => {
    const path = b.path || [];
    return {
      from: path[0] || b.from || "",
      to:   path[path.length - 1] || b.to || "",
      via:  b.via || (path.length
              ? path.map(x => String(x).replace(/_/g, " ")).join(" → ")
              : ""),
    };
  });
  return {
    matched,
    bridges,
    synthesis: r.synthesis || "",
    recommendations: r.recommendations || null,
  };
}

function Propose({ onJumpToNode }) {
  const examples = Object.keys(BU_DATA.PROPOSE_EXAMPLES);
  const [query, setQuery] = useState(examples[0]);
  const [result, setResult] = useState(BU_DATA.PROPOSE_EXAMPLES[examples[0]]);
  const [thinking, setThinking] = useState(false);

  const handleSubmit = async (q) => {
    setThinking(true);
    setResult(null);
    // Live backend (Gemma) when reachable; otherwise the mock example.
    try {
      if (window.BU_API && BU_API.live && BU_API.live()) {
        const r = await BU_API.propose(q);
        setResult(_normalizePropose(r));
        setThinking(false);
        return;
      }
    } catch (e) { /* fall through to mock */ }
    setTimeout(() => {
      setResult(BU_DATA.PROPOSE_EXAMPLES[q] || BU_DATA.PROPOSE_EXAMPLES[examples[0]]);
      setThinking(false);
    }, 800);
  };

  return (
    <div style={{ minHeight: "calc(100vh - 56px)", padding: "48px 28px 80px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div className="t-tag" style={{ color: "var(--c-ink-muted)" }}>≈ PROPOSE</div>
        <h1 className="t-display" style={{ margin: "6px 0 4px" }}>
          Drop in a half-formed idea.
        </h1>
        <p className="t-cap" style={{ marginBottom: 24, fontSize: 14 }}>
          The brain finds matching concepts, traces shortest paths between them, and writes back a
          grounded paragraph you can use as a starting answer.
        </p>

        {/* Input — deliberately not a search bar */}
        <div style={{ position: "relative" }}>
          <textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g. drone swarm coordination · explain entropy to a physicist · how does diffusion show up in ion channels?"
            style={{
              width: "100%", minHeight: 96,
              background: "var(--c-bg-elev)",
              border: "1px solid var(--c-line-strong)",
              borderRadius: "var(--r-lg)",
              padding: "16px 18px",
              color: "var(--c-ink)",
              fontFamily: "var(--f-sans)", fontSize: 16, lineHeight: 1.5,
              outline: "none", resize: "vertical",
            }}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey||e.ctrlKey)) handleSubmit(query); }}
          />
          <button className="btn primary" onClick={() => handleSubmit(query)} style={{
            position: "absolute", bottom: 12, right: 12,
          }}>Trace ⏎</button>
        </div>

        {/* Example chips */}
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="t-cap" style={{ color: "var(--c-ink-dim)", marginRight: 4 }}>Try:</span>
          {examples.map(ex => (
            <button key={ex} className="btn ghost" style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => { setQuery(ex); handleSubmit(ex); }}>
              {ex}
            </button>
          ))}
        </div>

        {/* Result */}
        {thinking && (
          <div style={{ marginTop: 32 }} className="fade-in">
            <div className="shimmer-text t-h2">
              Tracing through {BU_DATA.NODES.length} concepts ·
              finding bridges · grounding response…
            </div>
            <div style={{
              marginTop: 16, height: 4, borderRadius: 2,
              background: "linear-gradient(90deg, transparent, var(--c-bridge), transparent)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.4s infinite",
            }} />
          </div>
        )}

        {!thinking && result && (
          <div className="slide-up" style={{ marginTop: 32 }}>
            {/* Matched concepts */}
            <div className="t-tag" style={{ color: "var(--c-ink-muted)", marginBottom: 8 }}>
              MATCHED · {result.matched.length} CONCEPTS IN GRAPH
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
              {result.matched.map(id => {
                const node = BU_DATA.NODES.find(n => n.id === id);
                if (!node) return null;
                const c = BU_DATA.CLUSTERS[node.cluster];
                return (
                  <button key={id} className="btn"
                    onClick={() => onJumpToNode?.(id, node.cluster)}
                    style={{
                      borderColor: c.color + "55",
                      background: c.color + "0c",
                      fontFamily: "var(--f-mono)", fontSize: 12,
                    }}>
                    <span style={{ color: c.color }}>●</span>
                    {node.name}
                  </button>
                );
              })}
            </div>

            {/* Bridges traced */}
            {result.bridges.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div className="t-tag" style={{ color: "var(--c-ink-muted)", marginBottom: 8 }}>
                  BRIDGES TRACED · {result.bridges.length} FOUND
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {result.bridges.map((b, i) => (
                    <div key={i} className="card recessed" style={{ padding: 12 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6,
                                    fontFamily: "var(--f-mono)", fontSize: 12 }}>
                        <span style={{ color: "var(--c-ink)" }}>{b.from.replace(/_/g," ")}</span>
                        <span style={{ color: "var(--c-bridge)" }}>≈</span>
                        <span style={{ color: "var(--c-ink)" }}>{b.to.replace(/_/g," ")}</span>
                      </div>
                      <div className="t-cap" style={{ fontSize: 13, color: "var(--c-ink-muted)", lineHeight: 1.5 }}>
                        {b.via}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Synthesis paragraph */}
            <div className="t-tag" style={{ color: "var(--c-ink-muted)", marginBottom: 8 }}>
              GROUNDED SYNTHESIS
            </div>
            <div className="card" style={{ padding: 24,
              borderLeft: "3px solid var(--c-bridge)",
            }}>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.65 }}>{_cleanSynthesis(result.synthesis)}</p>
              <div className="t-cap" style={{
                marginTop: 14, color: "var(--c-ink-dim)",
                display: "flex", gap: 12,
              }}>
                <span>generated by `agents.proposal_responder`</span>
                <span>·</span>
                <span>grounded in {result.matched.length} graph concepts + {result.bridges.length} traced bridges</span>
              </div>
            </div>

            {/* Where to start — actionable breakdown */}
            {result.recommendations && (result.recommendations.steps || []).length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div className="t-tag" style={{ color: "var(--c-ink-muted)", marginBottom: 12 }}>
                  WHERE TO START
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.recommendations.steps.map((s, i) => {
                    const node = s.concept
                      ? BU_DATA.NODES.find(n =>
                          (n.name || "").toLowerCase() === s.concept.toLowerCase() ||
                          n.id === s.concept ||
                          n.id === s.concept.replace(/ /g, "_"))
                      : null;
                    const c = node ? BU_DATA.CLUSTERS[node.cluster] : null;
                    return (
                      <div key={i} className="card" style={{
                        padding: 16, display: "grid",
                        gridTemplateColumns: "32px 1fr", gap: 14, alignItems: "start",
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: (c ? c.color : "var(--c-bridge)") + "1a",
                          border: `1.5px solid ${c ? c.color : "var(--c-bridge)"}`,
                          color: c ? c.color : "var(--c-bridge)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 600,
                        }}>{i + 1}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15.5, marginBottom: 4 }}>
                            {s.title}
                          </div>
                          {s.why && (
                            <div className="t-cap" style={{ fontSize: 13.5,
                              color: "var(--c-ink-muted)", lineHeight: 1.5, marginBottom: 8 }}>
                              {s.why}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap",
                            alignItems: "center" }}>
                            {s.action && (
                              <span style={{ fontSize: 13.5, color: "var(--c-ink)" }}>
                                <span style={{ color: "var(--c-bridge)", fontWeight: 600 }}>→ </span>
                                {s.action}
                              </span>
                            )}
                            {node && (
                              <button className="btn ghost"
                                onClick={() => onJumpToNode?.(node.id, node.cluster)}
                                style={{ fontSize: 12, padding: "3px 10px",
                                  borderColor: (c ? c.color : "var(--c-bridge)") + "55" }}>
                                Open {node.name} →
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {result.recommendations.open_question && (
                  <div className="card recessed" style={{
                    marginTop: 12, padding: 16,
                    borderLeft: "3px solid var(--c-here)",
                  }}>
                    <div className="t-tag" style={{ color: "var(--c-here)", marginBottom: 6 }}>
                      OPEN QUESTION
                    </div>
                    <div style={{ fontSize: 15, lineHeight: 1.55 }}>
                      {result.recommendations.open_question}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
window.Propose = Propose;
