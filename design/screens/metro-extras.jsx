/* global React, BU_DATA, BU_METRO, BU_LESSON */
// ─────────────────────────────────────────────────────────────────
// Train of Thought pieces that replace older learner screens:
//   MetroChange        — "Change lines": the panel a stop's interchange opens
//                        (replaces BranchPanel, same onFork contract)
//   MetroInterchanges  — More → Changing lines: every real interchange on the
//                        map, each a place to start a ride (replaces Bridge)
// ─────────────────────────────────────────────────────────────────

const { useEffect: useXEffect, useRef: useXRef, useMemo: useXMemo } = React;

function teaserFor(id) {
  if (!window.BU_LESSON) return "";
  const kit = BU_LESSON.lessonKit(id);
  const md = kit.card && kit.card.why ? kit.card.why.md : kit.idea;
  return BU_LESSON.clipText(BU_LESSON.mdPlain(md), 170);
}

// Linked stops on other lines, one per line (the strongest link first).
function changesFrom(nodeId) {
  if (!nodeId || !window.BU_METRO) return [];
  const net = BU_METRO.network();
  const seen = new Set(), out = [];
  net.partnersAt(nodeId).forEach(p => {
    if (seen.has(p.line.cid)) return;
    seen.add(p.line.cid);
    out.push({ line: p.line, to: p.id, toName: net.byId[p.id].name });
  });
  return out;
}

function MetroChange({ open, fromNode, onStay, onFork }) {
  const net = window.BU_METRO && BU_METRO.network();
  const options = useXMemo(() => changesFrom(fromNode), [fromNode]);
  const panelRef = useXRef(null);
  useXEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") onStay(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => { const b = panelRef.current && panelRef.current.querySelector("button"); if (b) b.focus(); }, 60);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [open]);
  if (!open || !net) return null;
  const here = net.byId[fromNode], hereLine = here && net.lineOfCluster[here.cluster];
  return (
    <div className="metro metro-drawer-wrap">
      <div className="metro-drawer-back" onClick={onStay} aria-hidden="true" />
      <aside className="metro-drawer" role="dialog" aria-modal="true" aria-labelledby="change-title" ref={panelRef}>
        <div className="metro-drawer-head">
          <div>
            <span className="metro-ride-tag">Interchange</span>
            <h2 id="change-title" className="metro-h2" style={{ margin: "4px 0 6px" }}>Change lines at {here ? here.name : "this stop"}</h2>
            <p className="metro-note">
              These stops on other lines share an idea with {here ? here.name : "this stop"}. Change, and your ride carries on along that line.
            </p>
          </div>
          <button type="button" className="metro-btn ghost" onClick={onStay} aria-label="Close">✕</button>
        </div>
        <ul className="metro-change-list">
          {options.map(o => (
            <li key={o.line.cid}>
              <span className="metro-chip" style={{ background: o.line.color }}>{o.line.name} line</span>
              <b>via {o.toName}</b>
              <p>{teaserFor(o.to)}</p>
              <button type="button" className="metro-btn primary" onClick={() => onFork(o.to, o.line.cid)}>
                Change to the {o.line.name} line
              </button>
            </li>
          ))}
          {!options.length && <li><p>No other line meets this stop.</p></li>}
        </ul>
        <div className="metro-drawer-foot">
          <button type="button" className="metro-btn dark" onClick={onStay}>
            Stay on the {hereLine ? hereLine.name + " line" : "line"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function MetroInterchanges({ onRide, onMap }) {
  const net = BU_METRO.network();
  const pairs = useXMemo(() => {
    const seen = new Set(), out = [];
    net.lines.forEach(L => L.stops.forEach(id => net.partnersAt(id).forEach(p => {
      const key = [id, p.id].sort().join("|");
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ a: { id, line: L }, b: { id: p.id, line: p.line } });
    })));
    return out.sort((x, y) => Number(x.a.line.lone) - Number(y.a.line.lone));
  }, []);
  const Side = ({ s }) => (
    <button type="button" className="metro-xside" onClick={() => onRide(s.id)} title={`Ride from ${net.byId[s.id].name}`}>
      <i aria-hidden="true" style={{ background: s.line.color }} />
      <span><b>{net.byId[s.id].name}</b><small>{s.line.name} line</small></span>
    </button>
  );
  return (
    <div className="metro metro-page metro-stack">
      <section className="metro-card metro-pad" aria-labelledby="xchg-title">
        <div className="metro-headrow">
          <div>
            <h1 id="xchg-title" className="metro-h1">Changing lines</h1>
            <span className="metro-note">Where two topics share an idea, the map draws an interchange. Ride to one and you can change lines.</span>
          </div>
          {onMap && <button type="button" className="metro-btn ghost" onClick={onMap}>Open the map</button>}
        </div>
        <div className="metro-xexplain">
          <svg viewBox="0 0 260 90" aria-hidden="true" width="260" height="90">
            <path d="M10 60 H250" stroke="#d4351c" strokeWidth="9" strokeLinecap="round" />
            <path d="M118 10 V82" stroke="#0072ce" strokeWidth="9" strokeLinecap="round" />
            <rect x="105" y="44" width="48" height="32" rx="10" fill="#ffffff" stroke="#14171a" strokeWidth="3" />
            <circle cx="118" cy="60" r="7" fill="#ffffff" stroke="#14171a" strokeWidth="3" />
            <circle cx="140" cy="60" r="7" fill="#ffffff" stroke="#14171a" strokeWidth="3" />
            <circle cx="60" cy="60" r="6.5" fill="#ffffff" stroke="#d4351c" strokeWidth="3" />
            <circle cx="210" cy="60" r="6.5" fill="#ffffff" stroke="#d4351c" strokeWidth="3" />
            <circle cx="118" cy="22" r="6.5" fill="#ffffff" stroke="#0072ce" strokeWidth="3" />
          </svg>
          <ol className="metro-prose" style={{ margin: 0 }}>
            <li>Each line is one topic. Its stops are the ideas it's made of.</li>
            <li>A white pill joins two stops on different lines that really link: learning one helps with the other.</li>
            <li>At an interchange the ride offers <b>Change lines</b>; your time on the ticket carries over.</li>
          </ol>
        </div>
        <h2 className="metro-h2" style={{ marginTop: 22 }}>Every interchange ({pairs.length})</h2>
        <p className="metro-note" style={{ marginBottom: 8 }}>Pick either side to ride from it.</p>
        <ul className="metro-xlist">
          {pairs.map(p => (
            <li key={p.a.id + p.b.id}><Side s={p.a} /><span aria-label="links to" className="metro-xlink">⇄</span><Side s={p.b} /></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

window.MetroChange = MetroChange;
window.MetroInterchanges = MetroInterchanges;
