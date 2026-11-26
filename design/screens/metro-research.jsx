/* global React, BU_DATA, BU_METRO, ARXIVIS, ARXIVIS_DAILY, OPEN_PROBLEMS, PaperVideo, IngestModal, _normalizePropose, _cleanSynthesis */
// ─────────────────────────────────────────────────────────────────
// SCREEN · RESEARCH — papers, open problems, and asking the graph
//
// One page with three tabs, in the Train of Thought style:
//   Papers        — the arXivis library: search, sort, filter by source; a
//                   paper's one-line pitch, key finding, novelty and rigor,
//                   what it builds on and introduces, and its video explainer.
//   Open problems — gaps the library reveals (bridges nobody has built,
//                   clusters gone quiet), with the closest papers.
//   Ask           — describe an idea; the graph answers with the concepts it
//                   touches (POST /propose), or a saved example when offline.
// Any concept that is a stop on the map is a button: ride from it.
// The older 3D views (paper explorer, open-problems brain) stay one click away.
// ─────────────────────────────────────────────────────────────────

const { useState, useEffect, useMemo, useRef } = React;

const RESEARCH_TABS = [
  { id: "papers", label: "Papers" },
  { id: "problems", label: "Open problems" },
  { id: "ask", label: "Ask" },
];
const PAPER_SORTS = [
  { id: "composite", label: "Best overall" },
  { id: "novelty_bits", label: "Most novel" },
  { id: "rigor", label: "Most rigorous" },
  { id: "year", label: "Newest" },
];
const PROBLEM_KINDS = { missing_bridge: "Missing bridge", stale_cluster: "Gone quiet" };
const PAGE = 40;

// The library lists some papers twice (same id); show each once, best score kept.
let _library = null;
function library() {
  if (!_library) {
    const byId = new Map();
    ((window.ARXIVIS && ARXIVIS.papers) || []).forEach(p => {
      const had = byId.get(p.id);
      if (!had || (p.composite || 0) > (had.composite || 0)) byId.set(p.id, p);
    });
    _library = [...byId.values()];
  }
  return _library;
}

// concept id ("wiki:Kalman_filter", "Kalman_filter", "kalman filter") → stop id on the map, if it is one
function stopFor(id) {
  const net = BU_METRO.network();
  if (!stopFor.index) {
    stopFor.index = {};
    net.lines.forEach(L => L.stops.forEach(s => { stopFor.index[s.toLowerCase()] = s; stopFor.index[net.byId[s].name.toLowerCase()] = s; }));
  }
  const key = String(id || "").replace(/^wiki:/, "").toLowerCase();
  return stopFor.index[key] || stopFor.index[key.replace(/_/g, " ")] || null;
}

// The extracted pitch often opens by repeating the title; the key finding is
// often a cut-off fragment. Show each only when it adds a readable sentence.
function pitchOf(p) {
  let t = String(p.pitch || "").trim();
  if (t.toLowerCase().startsWith(String(p.title || "").toLowerCase())) t = t.slice(String(p.title).length).trim();
  return t.length > 40 ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : "";
}
function findingOf(p) {
  const t = String(p.key_finding || "").trim();
  return /[.!?]$/.test(t) && t.length > 40 ? t : "";
}

function ConceptChips({ list, onRide }) {
  if (!list || !list.length) return null;
  const net = BU_METRO.network();
  return (
    <ul className="metro-chips">
      {list.map((c, i) => {
        const id = typeof c === "string" ? c : c.id, name = (typeof c === "string" ? c : c.name || c.id || "").replace(/^wiki:/, "").replace(/_/g, " ");
        const stop = stopFor(id);
        const line = stop && net.lineOfCluster[net.byId[stop].cluster];
        return (
          <li key={id + i}>
            {stop && onRide
              ? <button type="button" onClick={() => onRide(stop)} title={`Ride from ${name}`}>
                  <i aria-hidden="true" style={{ background: line ? line.color : "#d4351c" }} />{name}<span aria-hidden="true">›</span>
                </button>
              : <span>{name}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Meter({ label, value, max, text }) {
  const pct = Math.max(2, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className="metro-meter">
      <span>{label}</span>
      <div role="img" aria-label={`${label}: ${text}`}><i style={{ width: pct + "%" }} /></div>
      <b>{text}</b>
    </div>
  );
}

// ─── Papers ───────────────────────────────────────────────────────
function PapersTab({ focus, select, onSelect, onRide, onOpen3D }) {
  const papers = library();
  const [q, setQ] = useState(focus || "");
  const [sort, setSort] = useState("composite");
  const [source, setSource] = useState("All");
  const [shown, setShown] = useState(PAGE);
  const [ingest, setIngest] = useState(false);
  const detailRef = useRef(null);
  useEffect(() => { if (focus) setQ(focus); }, [focus]);

  const sources = useMemo(() => ["All"].concat([...new Set(papers.map(p => p.source).filter(Boolean))]), [papers]);
  const maxNovelty = useMemo(() => Math.max(1, ...papers.map(p => p.novelty_bits || 0)), [papers]);
  const list = useMemo(() => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const val = p => (sort === "rigor" ? (p.rigor && p.rigor.total) || 0 : p[sort] || 0);
    return papers
      .filter(p => source === "All" || p.source === source)
      .filter(p => {
        if (!toks.length) return true;
        const hay = (p.title + " " + (p.concepts || []).map(c => c.name).join(" ") + " " + (p.pitch || "")).toLowerCase();
        return toks.every(t => hay.indexOf(t) >= 0);
      })
      .sort((a, b) => val(b) - val(a));
  }, [papers, q, sort, source]);
  useEffect(() => { setShown(PAGE); }, [q, sort, source]);

  const sel = papers.find(p => p.id === select) || list[0] || null;
  const fresh = (window.ARXIVIS_DAILY && ARXIVIS_DAILY.top) || [];
  const pick = id => { onSelect(id); if (detailRef.current && window.innerWidth < 900) detailRef.current.scrollIntoView({ block: "start" }); };

  if (!papers.length) return <p className="metro-note">The paper library didn't load.</p>;
  return (
    <>
      <div className="metro-toolbar">
        <div className="metro-field" style={{ flex: "1 1 260px" }}>
          <label htmlFor="res-q" className="metro-label-strong">Search papers</label>
          <input id="res-q" type="search" className="metro-input" value={q} onChange={e => setQ(e.target.value)}
                 placeholder="A concept, a method, a word in the title" autoComplete="off" />
        </div>
        <div className="metro-field">
          <label htmlFor="res-sort" className="metro-label-strong">Sort by</label>
          <select id="res-sort" className="metro-input" value={sort} onChange={e => setSort(e.target.value)}>
            {PAPER_SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="metro-field">
          <label htmlFor="res-src" className="metro-label-strong">Source</label>
          <select id="res-src" className="metro-input" value={source} onChange={e => setSource(e.target.value)}>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="metro-actions">
          {typeof IngestModal !== "undefined" && <button type="button" className="metro-btn ghost" onClick={() => setIngest(true)}>Add a paper</button>}
          {onOpen3D && <button type="button" className="metro-btn ghost" onClick={() => onOpen3D("papers", sel && sel.id)}>3D explorer</button>}
        </div>
      </div>

      {!q && fresh.length > 0 && (
        <div className="metro-fresh" aria-label="New this month">
          <b>New this month</b>
          {fresh.slice(0, 4).map(p => (
            <button key={p.id} type="button" onClick={() => pick(p.id)} className={sel && sel.id === p.id ? "on" : ""}>{p.title}</button>
          ))}
        </div>
      )}

      <div className="metro-research-grid">
        <div>
          <p className="metro-note" role="status">{list.length} {list.length === 1 ? "paper" : "papers"}{q ? ` for “${q}”` : ""}</p>
          <ul className="metro-paperlist" aria-label="Papers">
            {list.slice(0, shown).map(p => (
              <li key={p.id}>
                <button type="button" aria-current={sel && sel.id === p.id ? "true" : undefined}
                        className={sel && sel.id === p.id ? "on" : ""} onClick={() => pick(p.id)}>
                  <b>{p.title}</b>
                  <span>{[p.source, p.year, (p.category_hint || "").replace(/_/g, ".")].filter(Boolean).join(" · ")}</span>
                  <em title="Overall score: novelty and rigor together">{Math.round(p.composite || 0)}</em>
                </button>
              </li>
            ))}
          </ul>
          {list.length > shown && (
            <button type="button" className="metro-btn ghost" style={{ marginTop: 10 }} onClick={() => setShown(n => n + PAGE)}>
              Show {Math.min(PAGE, list.length - shown)} more
            </button>
          )}
          {!list.length && <p className="metro-note">No paper matches. Try fewer words, or another source.</p>}
        </div>

        <article className="metro-paper" ref={detailRef} aria-live="polite">
          {sel ? (
            <>
              <span className="metro-ride-tag">{[sel.source, sel.year].filter(Boolean).join(" · ")}</span>
              <h2 className="metro-h2" style={{ fontSize: 22, lineHeight: 1.2 }}>{sel.title}</h2>
              {sel.url && <a className="metro-extlink" href={sel.url} target="_blank" rel="noopener noreferrer">Read the paper ↗</a>}
              {pitchOf(sel) && <><h3 className="metro-beat-sub">In short</h3><p className="metro-paper-text">{pitchOf(sel)}</p></>}
              {findingOf(sel) && <><h3 className="metro-beat-sub">Key finding</h3><p className="metro-paper-text">{findingOf(sel)}</p></>}
              <div className="metro-meters">
                <Meter label="Overall" value={sel.composite || 0} max={100} text={Math.round(sel.composite || 0) + " of 100"} />
                <Meter label="Novelty" value={sel.novelty_bits || 0} max={maxNovelty} text={(sel.novelty_bits || 0).toFixed(1) + " bits"} />
                {sel.rigor && <Meter label="Rigor" value={sel.rigor.total || 0} max={10} text={(sel.rigor.total || 0).toFixed(1) + " of 10"} />}
              </div>
              {sel.rigor && sel.rigor.flags && (
                <ul className="metro-flags">
                  {(sel.rigor.flags.green || []).map((f, i) => <li key={"g" + i} className="good"><span aria-hidden="true">✓</span>{f}</li>)}
                  {(sel.rigor.flags.red || []).map((f, i) => <li key={"r" + i} className="bad"><span aria-hidden="true">!</span>{f}</li>)}
                </ul>
              )}
              {sel.foundations && sel.foundations.length > 0 && <><h3 className="metro-beat-sub">Builds on</h3><ConceptChips list={sel.foundations} onRide={onRide} /></>}
              {sel.introduced && sel.introduced.length > 0 && <><h3 className="metro-beat-sub">Introduces</h3><ConceptChips list={sel.introduced.slice(0, 8)} onRide={onRide} /></>}
              {typeof PaperVideo !== "undefined" && (
                <><h3 className="metro-beat-sub">Video explainer</h3><div className="metro-video"><PaperVideo key={sel.id} paperId={sel.id} /></div></>
              )}
            </>
          ) : <p className="metro-note">Pick a paper to see what it found.</p>}
        </article>
      </div>
      {ingest && typeof IngestModal !== "undefined" && <IngestModal onClose={() => setIngest(false)} />}
    </>
  );
}

// ─── Open problems ────────────────────────────────────────────────
function ProblemsTab({ onRide, onPaper, onOpen3D }) {
  const all = (window.OPEN_PROBLEMS && OPEN_PROBLEMS.problems) || [];
  const [kind, setKind] = useState("all");
  const [selIdx, setSelIdx] = useState(0);
  const list = all.filter(p => kind === "all" || p.kind === kind);
  const sel = list[Math.min(selIdx, list.length - 1)] || null;
  useEffect(() => { setSelIdx(0); }, [kind]);
  if (!all.length) return <p className="metro-note">The open-problems list didn't load.</p>;
  return (
    <>
      <div className="metro-toolbar">
        <div role="group" aria-label="Kind of gap" className="metro-seg">
          {[["all", "All"]].concat(Object.entries(PROBLEM_KINDS)).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={kind === id} className={kind === id ? "on" : ""} onClick={() => setKind(id)}>
              {label} <small>{id === "all" ? all.length : all.filter(p => p.kind === id).length}</small>
            </button>
          ))}
        </div>
        <span className="metro-note" style={{ flex: 1 }}>Gaps the paper library reveals: ideas nobody has connected yet, and areas that have gone quiet.</span>
        {onOpen3D && <button type="button" className="metro-btn ghost" onClick={() => onOpen3D("problems")}>3D view</button>}
      </div>
      <div className="metro-research-grid">
        <ul className="metro-paperlist" aria-label="Open problems">
          {list.map((p, i) => (
            <li key={p.title}>
              <button type="button" aria-current={sel === p ? "true" : undefined} className={sel === p ? "on" : ""} onClick={() => setSelIdx(i)}>
                <b>{p.title}</b>
                <span>{PROBLEM_KINDS[p.kind] || p.kind}</span>
                <em title="How promising this gap looks">{Math.round(p.score)}</em>
              </button>
            </li>
          ))}
        </ul>
        <article className="metro-paper" aria-live="polite">
          {sel && (
            <>
              <span className="metro-ride-tag">{PROBLEM_KINDS[sel.kind] || sel.kind}</span>
              <h2 className="metro-h2" style={{ fontSize: 22, lineHeight: 1.2 }}>{sel.title}</h2>
              <p className="metro-paper-text">{sel.why}</p>
              <h3 className="metro-beat-sub">Start from</h3>
              <ConceptChips list={sel.suggested_foundations && sel.suggested_foundations.length ? sel.suggested_foundations : sel.concepts} onRide={onRide} />
              {sel.closest_papers && sel.closest_papers.length > 0 && (
                <>
                  <h3 className="metro-beat-sub">Closest papers</h3>
                  <ul className="metro-reading">
                    {sel.closest_papers.filter((cp, i, a) => a.findIndex(x => x.id === cp.id) === i).map(cp => (
                      <li key={cp.id}><button type="button" className="metro-linkbtn" onClick={() => onPaper(cp.id)}>{cp.title}</button></li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </article>
      </div>
    </>
  );
}

// ─── Ask ──────────────────────────────────────────────────────────
function AskTab({ onRide }) {
  const examples = Object.keys((window.BU_DATA && BU_DATA.PROPOSE_EXAMPLES) || {});
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ status: "idle" }); // idle | thinking | done | offline
  const base = (window.BU_API_BASE || "").replace(/\/+$/, "");

  const ask = async text => {
    const q = String(text || "").trim();
    if (!q) return;
    setQuery(q);
    setState({ status: "thinking" });
    const saved = BU_DATA.PROPOSE_EXAMPLES[q];
    try {
      if (!base) throw new Error("no server");
      let token = null;
      try { token = sessionStorage.getItem("bu_auth_token"); } catch (_) { /* private mode */ }
      const r = await fetch(base + "/propose", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
        body: JSON.stringify({ user_id: window.BU_USER_ID || "anon", text: q }),
      });
      if (!r.ok) throw new Error("status " + r.status);
      const data = await r.json();
      const result = typeof _normalizePropose === "function" ? _normalizePropose(data) : data;
      if (!result || (!result.synthesis && !(result.matched || []).length)) throw new Error("empty answer");
      setState({ status: "done", result, live: true });
    } catch (_) {
      if (saved) setState({ status: "done", result: saved, live: false });
      else setState({ status: "offline" });
    }
  };

  const res = state.result;
  const clean = t => (typeof _cleanSynthesis === "function" ? _cleanSynthesis(t) : t);
  return (
    <div className="metro-ask">
      <form onSubmit={e => { e.preventDefault(); ask(query); }} className="metro-field">
        <label htmlFor="res-ask" className="metro-label-strong">Describe an idea, a project or a question</label>
        <textarea id="res-ask" className="metro-input metro-textarea" rows={3} value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="e.g. drone swarm coordination using graph theory" />
        <div className="metro-actions">
          <button type="submit" className="metro-btn primary" disabled={!query.trim() || state.status === "thinking"}>
            {state.status === "thinking" ? "Thinking…" : "Ask the graph"}
          </button>
          <span className="metro-note">It answers with the concepts your idea touches and where they connect.</span>
        </div>
      </form>
      {examples.length > 0 && (
        <div className="metro-fresh" aria-label="Examples">
          <b>Try</b>
          {examples.slice(0, 4).map(ex => <button key={ex} type="button" onClick={() => ask(ex)}>{ex}</button>)}
        </div>
      )}
      <div aria-live="polite">
        {state.status === "offline" && (
          <p className="metro-paper-text" role="status">
            The server didn't answer, so I can't work on a new question right now. The examples above are saved and still work.
          </p>
        )}
        {state.status === "done" && res && (
          <article className="metro-paper">
            {!state.live && <span className="metro-ride-tag">Saved example</span>}
            {res.synthesis && <BU_LESSON.Md src={clean(res.synthesis)} />}
            {(res.matched || []).length > 0 && <><h3 className="metro-beat-sub">Concepts it touches</h3><ConceptChips list={res.matched} onRide={onRide} /></>}
            {(res.bridges || []).length > 0 && (
              <>
                <h3 className="metro-beat-sub">Where they connect</h3>
                <ul className="metro-reading">
                  {res.bridges.map((b, i) => (
                    <li key={i}>{String(b.from).replace(/_/g, " ")} → {String(b.to).replace(/_/g, " ")}{b.via ? <span className="metro-note"> via {b.via}</span> : null}</li>
                  ))}
                </ul>
              </>
            )}
          </article>
        )}
      </div>
    </div>
  );
}

// ─── the screen ───────────────────────────────────────────────────
function MetroResearch({ tab = "papers", focus = "", onTab, onRide, onOpen3D }) {
  const [paperId, setPaperId] = useState(null);
  const nPapers = library().length;
  const nProblems = ((window.OPEN_PROBLEMS && OPEN_PROBLEMS.problems) || []).length;
  const openPaper = id => { setPaperId(id); onTab("papers"); };
  const onKey = e => {
    const i = RESEARCH_TABS.findIndex(t => t.id === tab);
    if (e.key === "ArrowRight") onTab(RESEARCH_TABS[(i + 1) % RESEARCH_TABS.length].id);
    else if (e.key === "ArrowLeft") onTab(RESEARCH_TABS[(i + RESEARCH_TABS.length - 1) % RESEARCH_TABS.length].id);
  };
  return (
    <div className="metro metro-page metro-stack">
      <section className="metro-card metro-pad" aria-labelledby="res-title">
        <div className="metro-headrow">
          <div>
            <h1 id="res-title" className="metro-h1">Research</h1>
            <span className="metro-note">{nPapers} papers and {nProblems} open problems, linked to the stops on your map.</span>
          </div>
          <div role="tablist" aria-label="Research" className="metro-tabs" onKeyDown={onKey}>
            {RESEARCH_TABS.map(t => (
              <button key={t.id} type="button" role="tab" id={"res-tab-" + t.id} aria-selected={tab === t.id} aria-controls="res-panel"
                      tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div role="tabpanel" id="res-panel" aria-labelledby={"res-tab-" + tab}>
          {tab === "papers" && <PapersTab focus={focus} select={paperId} onSelect={setPaperId} onRide={onRide} onOpen3D={onOpen3D} />}
          {tab === "problems" && <ProblemsTab onRide={onRide} onPaper={openPaper} onOpen3D={onOpen3D} />}
          {tab === "ask" && <AskTab onRide={onRide} />}
        </div>
      </section>
    </div>
  );
}

window.MetroResearch = MetroResearch;
