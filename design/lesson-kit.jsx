/* global React, BU_DATA, BU_METRO */
// ─────────────────────────────────────────────────────────────────
// LESSON KIT — how a stop is taught (shared by Learn and the lesson page)
//
// A stop's lesson comes from window.BU_LESSON_CARDS (scripts/build_lesson_cards.py,
// lifted from the wiki pages) with BU_DATA.LESSONS as the fallback. The kit
// turns it into beats, the order a stop is taught in:
//   why → idea → see → how → traps → check
// ("see" is the stop's animated diagram from lesson-visuals.jsx, BU_VISUALS)
// and renders their content: Markdown (nested lists, bold, code, [[links]])
// and maths ($…$ / $$…$$) typeset by a small TeX renderer: fractions, roots,
// sub/superscripts, accents, \text, \mathbb and the usual symbols. React
// nodes only, never innerHTML.
//
// Exports window.BU_LESSON.
// ─────────────────────────────────────────────────────────────────

const { useState: useKitState } = React;

// ─── maths ────────────────────────────────────────────────────────
const TEX_SYM = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ",
  Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", sim: "∼", simeq: "≃", equiv: "≡",
  propto: "∝", ll: "≪", gg: "≫", in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃",
  supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅", varnothing: "∅", bigcup: "⋃", bigcap: "⋂",
  forall: "∀", exists: "∃", neg: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
  circ: "∘", cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", bullet: "•",
  to: "→", rightarrow: "→", leftarrow: "←", gets: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐",
  Leftrightarrow: "⇔", iff: "⇔", implies: "⇒", mapsto: "↦", rightsquigarrow: "⇝", leadsto: "⇝", uparrow: "↑",
  downarrow: "↓", infty: "∞", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", ell: "ℓ", hbar: "ℏ",
  ldots: "…", dots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋",
  lceil: "⌈", rceil: "⌉", lvert: "|", rvert: "|", mid: "|", vert: "|", Vert: "‖", lVert: "‖", rVert: "‖",
  parallel: "∥", perp: "⊥", angle: "∠", triangle: "△", top: "⊤", bot: "⊥", prime: "′", dagger: "†",
};
const TEX_OPS = new Set(["log", "ln", "lg", "exp", "min", "max", "arg", "sup", "inf", "lim", "sin", "cos", "tan",
  "det", "dim", "deg", "gcd", "Pr", "mod", "ker", "sgn", "poly", "polylog"]);
const TEX_SPACE = { quad: " ", qquad: "  ", ",": " ", ";": " ", ":": " ", "!": "", " ": " " };
const TEX_SKIP = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr",
  "displaystyle", "textstyle", "limits", "nolimits", "nonumber", "notag"]);
const TEX_FONT = { text: "up", textrm: "up", mathrm: "up", operatorname: "up", mathsf: "up", texttt: "up",
  textbf: "bold", mathbf: "bold", boldsymbol: "bold", bm: "bold", textit: "it", mathit: "it",
  mathcal: "cal", mathscr: "cal", mathfrak: "cal" };
const TEX_BB = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", E: "𝔼", P: "ℙ", F: "𝔽", 1: "𝟙" };
const TEX_ACCENT = { tilde: "̃", widetilde: "̃", hat: "̂", widehat: "̂", bar: "̄",
  dot: "̇", ddot: "̈", vec: "⃗" };

function texText(nodes) { // the characters a parsed fragment shows
  return [].concat(nodes).map(n => (n == null || n === false ? "" : typeof n === "string" ? n
    : n.props ? texText(React.Children.toArray(n.props.children)) : String(n))).join("");
}

function texNodes(src) {
  const s = String(src || "");
  let i = 0, k = 0;
  const key = () => "x" + (k++);
  const isLetter = c => !!c && /[a-zA-Z]/.test(c);
  const rawGroup = () => { // {…} as raw text
    while (s[i] === " ") i++;
    if (s[i] !== "{") return s[i++] || "";
    let depth = 0, out = "";
    for (; i < s.length; i++) {
      if (s[i] === "{") { if (depth++) out += "{"; } else if (s[i] === "}") { if (!--depth) { i++; break; } out += "}"; } else out += s[i];
    }
    return out;
  };
  const atom = () => { // one argument: a group, a command or a single character
    while (s[i] === " ") i++;
    if (s[i] === "{") { i++; const n = seq("}"); i++; return n; }
    if (s[i] === "\\") return [].concat(command());
    const c = s[i++];
    return c === undefined ? [] : [isLetter(c) ? <i key={key()}>{c}</i> : c];
  };
  function command() {
    i++; // the backslash
    let name = "";
    if (isLetter(s[i])) while (isLetter(s[i])) name += s[i++]; else name = s[i++] || "";
    if (name in TEX_SYM) return TEX_SYM[name];
    if (TEX_OPS.has(name)) return <span key={key()} className="tex-op">{name}</span>;
    if (name in TEX_SPACE) return TEX_SPACE[name];
    if (TEX_SKIP.has(name)) { if ((name === "left" || name === "right") && s[i] === ".") i++; return ""; }
    if (name === "begin" || name === "end") { rawGroup(); return ""; }
    if (name === "mathbb") return rawGroup().split("").map(c => TEX_BB[c] || c).join("");
    if (name in TEX_FONT) return <span key={key()} className={"tex-" + TEX_FONT[name]}>{atom()}</span>;
    if (name in TEX_ACCENT) {
      const arg = atom(), t = texText(arg);
      if (t.length === 1) return isLetter(t) ? <i key={key()}>{t + TEX_ACCENT[name]}</i> : t + TEX_ACCENT[name];
      return name === "bar" ? <span key={key()} className="tex-over">{arg}</span> : arg;
    }
    if (name === "overline") return <span key={key()} className="tex-over">{atom()}</span>;
    if (name === "underline") return <span key={key()} className="tex-under">{atom()}</span>;
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "binom") {
      const num = atom(), den = atom();
      const f = <span key={key()} className={"tex-frac" + (name === "binom" ? " tex-binom" : "")}><span>{num}</span><span>{den}</span></span>;
      return name === "binom" ? ["(", f, ")"] : f;
    }
    if (name === "sqrt") {
      let root = "";
      if (s[i] === "[") { const j = s.indexOf("]", i); root = s.slice(i + 1, j); i = j + 1; }
      return <span key={key()} className="tex-sqrt">{root && <sup>{root}</sup>}√<span className="tex-over">{atom()}</span></span>;
    }
    if (name === "|") return "‖";
    if ("{}%$_&#".indexOf(name) >= 0) return name;
    return <span key={key()} className="tex-up">{name}</span>; // unknown: show its name
  }
  function seq(stop) {
    const out = [];
    const push = n => { [].concat(n).forEach(x => { if (x !== "" && x != null) out.push(x); }); };
    while (i < s.length && s[i] !== stop) {
      const c = s[i];
      if (c === "\\") { if (s[i + 1] === "\\") { i += 2; out.push(<br key={key()} />); } else push(command()); }
      else if (c === "{") { i++; push(seq("}")); i++; }
      else if (c === "^" || c === "_") { i++; const a = atom(); out.push(c === "^" ? <sup key={key()}>{a}</sup> : <sub key={key()}>{a}</sub>); }
      else if (c === "&") i++;
      else if (c === "~") { i++; out.push(" "); }
      else if (c === " " || c === "\n" || c === "\t") { i++; if (out[out.length - 1] !== " ") out.push(" "); }
      else if (isLetter(c)) { let run = ""; while (isLetter(s[i])) run += s[i++]; out.push(<i key={key()}>{run}</i>); }
      else { i++; out.push(c === "-" ? "−" : c === "'" ? "′" : c === "*" ? "∗" : c); }
    }
    return out;
  }
  try { return seq(undefined); } catch (_) { return [s]; }
}

function Tex({ src, block }) {
  return block
    ? <div className="tex tex-block">{texNodes(src)}</div>
    : <span className="tex">{texNodes(src)}</span>;
}

// Maths as plain characters, for the platform boards and read-aloud.
function texPlain(src) {
  let s = String(src || "");
  for (let n = 0; n < 4; n++) s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\\(?:tilde|widetilde)\s*\{?\\?([A-Za-z]+)\}?/g, (_, a) => (TEX_SYM[a] || a) + "̃")
    .replace(/\\mathbb\s*\{(\w)\}/g, (_, c) => TEX_BB[c] || c)
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, " ")
    .replace(/\\\\/g, "; ")
    .replace(/\\([a-zA-Z]+)/g, (m, w) => (w in TEX_SYM ? TEX_SYM[w] : w in TEX_SPACE ? " " : TEX_SKIP.has(w) || w in TEX_FONT || w in TEX_ACCENT ? "" : w))
    .replace(/\\([{}|%$_&#,;:! ])/g, (m, c) => ("{}|%$_&#".indexOf(c) >= 0 ? (c === "|" ? "‖" : c) : " "))
    .replace(/\^\{([^{}]*)\}/g, "^($1)").replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/[{}&]/g, "").replace(/-/g, "−").replace(/\s+/g, " ");
  return s.trim();
}

// ─── Markdown ─────────────────────────────────────────────────────
function kitName(id) {
  const net = window.BU_METRO && BU_METRO.network();
  const n = net && net.byId[id];
  return n ? n.name : String(id).replace(/_/g, " ");
}
function mdInline(text, key = "i") {
  const s = String(text || "").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => label || kitName(id));
  return s.split(/(\*\*[^*]+\*\*|\$[^$\n]+\$|`[^`]+`)/g).filter(p => p !== "").map((p, i) => {
    const k = key + i;
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <strong key={k}>{mdInline(p.slice(2, -2), k)}</strong>;
    if (p.length > 2 && p.startsWith("$") && p.endsWith("$")) return <Tex key={k} src={p.slice(1, -1)} />;
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return <code key={k}>{p.slice(1, -1)}</code>;
    return p.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1$2"); // *emphasis* → plain
  });
}
function mdBlocks(md) {
  const src = String(md || "").replace(/\r/g, "")
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, t) => "\n$$" + t.replace(/\n/g, " ") + "$$\n");
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) { out.push(<p key={"p" + out.length}>{mdInline(para.join(" "), "p" + out.length)}</p>); para = []; } };
  const renderList = (l, k) => {
    const Tag = l.ordered ? "ol" : "ul";
    return (
      <Tag key={k}>
        {l.items.map((it, i) => (
          <li key={i}>{mdInline(it.text, k + i)}{it.sub && it.sub.items.length > 0 && renderList(it.sub, k + i + "s")}</li>
        ))}
      </Tag>
    );
  };
  const flushList = () => { if (list) { out.push(renderList(list, "l" + out.length)); list = null; } };
  src.split("\n").forEach(raw => {
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, "  ").length, line = raw.trim();
    if (!line) { flushPara(); return; }
    if (line.startsWith("$$") && line.endsWith("$$") && line.length > 4) {
      flushPara(); flushList();
      out.push(<Tex key={"m" + out.length} src={line.slice(2, -2)} block />);
      return;
    }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(<h4 key={"h" + out.length}>{mdInline(h[1].replace(/\*\*/g, ""), "h" + out.length)}</h4>); return; }
    const m = line.match(/^([-*]|\d+[.)])\s+(.*)$/);
    if (m) {
      flushPara();
      const ordered = /\d/.test(m[1]);
      if (list && indent >= 2 && list.items.length) { // a nested bullet
        const parent = list.items[list.items.length - 1];
        parent.sub = parent.sub || { ordered, items: [] };
        parent.sub.items.push({ text: m[2] });
      } else {
        if (!list || (list.ordered !== ordered && indent < 2)) { flushList(); list = { ordered, items: [] }; }
        list.items.push({ text: m[2] });
      }
      return;
    }
    if (list && indent >= 2 && list.items.length) { // continuation of the last item
      const it = list.items[list.items.length - 1];
      const target = it.sub && it.sub.items.length ? it.sub.items[it.sub.items.length - 1] : it;
      target.text += " " + line;
      return;
    }
    flushList();
    para.push(line);
  });
  flushPara(); flushList();
  return out;
}
function Md({ src, className = "metro-prose" }) {
  return <div className={className}>{mdBlocks(src)}</div>;
}
// Markdown as plain text (boards, read-aloud, short summaries).
function mdPlain(md) {
  return String(md || "")
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, t) => " " + texPlain(t) + " ")
    .replace(/\$([^$\n]+)\$/g, (_, t) => texPlain(t))
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => label || kitName(id))
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\n\s*(?:[-*]|\d+[.)])\s+/g, "; ")
    .replace(/:\s*;\s*/g, ": ")
    .replace(/\s+/g, " ")
    .trim();
}
function clipText(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const dot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (dot > max * 0.5 ? cut.slice(0, dot + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…").replace(/;$/, ".");
}
const firstSentences = (md, max) => clipText(mdPlain(md), max);

// ─── a stop's lesson, as beats ─────────────────────────────────────
const BEAT_TITLES = { why: "Why it matters", idea: "The idea", see: "See it", how: "How it works", ideas: "Key ideas", traps: "Watch out", check: "Check yourself" };

function lessonKit(nodeId) {
  const name = kitName(nodeId);
  const lesson = (window.BU_DATA && BU_DATA.lessonFor(nodeId)) || {};
  const card = (window.BU_LESSON_CARDS || {})[nodeId] || null;
  const idea = (card && card.idea) || lesson.summary || "";
  // key ideas that only repeat the definition are left out
  const flat = t => mdPlain(t).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const ideaFlat = flat(idea);
  const ideas = (lesson.key_ideas || []).filter(k => k && (k.h || k.b))
    .filter(k => ideaFlat.indexOf(flat([k.h, k.b].filter(Boolean).join(" "))) < 0);
  const keys = [];
  if (card && card.why) keys.push("why");
  keys.push("idea");
  const visual = window.BU_VISUALS ? BU_VISUALS.sceneFor(nodeId) : null;
  if (visual) keys.push("see");
  if (card && (card.how || card.example)) keys.push("how");
  else if (!card && ideas.length) keys.push("ideas");
  if (card && card.pitfalls) keys.push("traps");
  keys.push("check");
  const kit = { id: nodeId, name, lesson, card, idea, ideas, visual, color: kitColor(nodeId), beats: keys.map(key => ({ key, title: BEAT_TITLES[key] })) };
  kit.beats.forEach(b => { b.board = boardLines(kit, b.key); b.speech = beatSpeech(kit, b.key); });
  return kit;
}

// The stop's line colour (diagrams draw in it).
function kitColor(nodeId) {
  if (!window.BU_METRO) return "#d4351c";
  const net = BU_METRO.network(), n = net.byId[nodeId], L = n && net.lineOfCluster[n.cluster];
  return L ? L.color : "#d4351c";
}

// The few lines a platform board carries for a beat.
function boardLines(kit, key) {
  const c = kit.card || {};
  if (key === "why") return [firstSentences(c.why.md, 240)];
  if (key === "idea") {
    const lines = [firstSentences(kit.idea, 150)];
    if (c.equations && c.equations[0]) lines.push(clipText(texPlain(c.equations[0].tex), 60));
    return lines;
  }
  if (key === "see") return [kit.visual.title];
  if (key === "how") return (c.how || []).concat(c.example ? [c.example] : []).filter(b => b.h).slice(0, 3).map(b => "•  " + b.h);
  if (key === "ideas") return kit.ideas.slice(0, 3).map(k => "•  " + clipText(mdPlain(k.h || k.b), 60));
  if (key === "traps") return c.pitfalls.slice(0, 3).map(p => "✕  " + clipText(mdPlain(p.h), 60));
  return ["Say it from memory first.", "Then rate how well it landed."];
}
// What read-aloud says for a beat.
function beatSpeech(kit, key) {
  const c = kit.card || {};
  if (key === "why") return mdPlain(c.why.md);
  if (key === "idea") return mdPlain(kit.idea);
  if (key === "see") return kit.visual.title + ". " + kit.visual.frames.map(f => f.say).join(" ");
  if (key === "how") return (c.how || []).map(b => (b.h ? b.h + ". " : "") + mdPlain(b.md)).join(" ");
  if (key === "ideas") return kit.ideas.map(k => mdPlain([k.h, k.b].filter(Boolean).join(": "))).join(". ");
  if (key === "traps") return "Watch out. " + c.pitfalls.map(p => mdPlain(p.h) + ". " + p.points.map(mdPlain).join(". ")).join(". ");
  return "Check yourself. What is " + kit.name + "? Say it from memory, then rate how well it landed.";
}

// ─── beat content ─────────────────────────────────────────────────
function Reveal({ prompt, label = "Show answer", children }) {
  const [open, setOpen] = useKitState(false);
  return (
    <div className={"metro-reveal" + (open ? " open" : "")}>
      <p>{prompt}</p>
      {open
        ? <div className="metro-reveal-body">{children}</div>
        : <button type="button" className="metro-btn ghost" onClick={() => setOpen(true)}>{label}</button>}
    </div>
  );
}

function Equations({ list }) {
  return (
    <div className="metro-eqs">
      {list.map((e, i) => (
        <figure key={i}>
          {e.label && <figcaption>{mdInline(e.label, "el" + i)}</figcaption>}
          <Tex src={e.tex} block />
          {e.note && <p className="metro-note">{mdInline(e.note, "en" + i)}</p>}
        </figure>
      ))}
    </div>
  );
}

function Uses({ list, max = 4 }) {
  return (
    <ul className="metro-uses">
      {list.slice(0, max).map((u, i) => (
        <li key={i}><b>{mdInline(u.h, "u" + i)}</b>{u.points[0] && <span>{mdInline(u.points[0], "up" + i)}</span>}</li>
      ))}
    </ul>
  );
}

// Common mistakes, each one tapped open: read the trap, think why, then check.
function Traps({ list }) {
  const [open, setOpen] = useKitState({});
  return (
    <ul className="metro-traps">
      {list.map((p, i) => (
        <li key={i} className={open[i] ? "open" : ""}>
          <button type="button" aria-expanded={!!open[i]} onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}>
            <span aria-hidden="true">✕</span>
            <b>{mdInline(p.h, "t" + i)}</b>
            <em>{open[i] ? "Hide" : "Why is that wrong?"}</em>
          </button>
          {open[i] && <ul>{p.points.map((t, j) => <li key={j}>{mdInline(t, "tp" + i + j)}</li>)}</ul>}
        </li>
      ))}
    </ul>
  );
}

// One beat of a stop's lesson. `compact` (the ride card) keeps each beat to
// what fits a card; the lesson page shows the same pieces at full length.
function BeatBody({ kit, beat, compact = false }) {
  const c = kit.card || {};
  if (beat === "why") {
    return (
      <>
        {c.why.h && <h3 className="metro-beat-h">{c.why.h}</h3>}
        <Md src={c.why.md} />
        {c.uses && <><h4 className="metro-beat-sub">Where it's used</h4><Uses list={c.uses} max={compact ? 3 : 4} /></>}
      </>
    );
  }
  if (beat === "idea") {
    return (
      <>
        <Md src={kit.idea} />
        {c.equations && <Equations list={compact ? c.equations.slice(0, 1) : c.equations} />}
        {!c.why && c.uses && <><h4 className="metro-beat-sub">Where it's used</h4><Uses list={c.uses} max={compact ? 3 : 4} /></>}
      </>
    );
  }
  if (beat === "see") {
    const { Visual } = window.BU_VISUALS;
    return (
      <>
        <h3 className="metro-beat-h">{kit.visual.title}</h3>
        <Visual scene={kit.visual} accent={kit.color} compact={compact} />
      </>
    );
  }
  if (beat === "how") {
    const blocks = (c.how || []).slice(0, compact ? 2 : 3);
    return (
      <>
        {blocks.map((b, i) => (
          <React.Fragment key={i}>{b.h && <h3 className="metro-beat-h">{b.h}</h3>}<Md src={b.md} /></React.Fragment>
        ))}
        {c.example && (!compact || !blocks.length) && <><h3 className="metro-beat-h">{c.example.h || "Example"}</h3><Md src={c.example.md} /></>}
      </>
    );
  }
  if (beat === "ideas") {
    return (
      <ol className="metro-ideas">
        {kit.ideas.slice(0, compact ? 4 : 8).map((k, i) => (
          <li key={i}>
            <span className="metro-ideas-num" aria-hidden="true">{i + 1}</span>
            <div>
              {k.h && <b>{mdInline(String(k.h).replace(/[.:]$/, ""), "h" + i)}</b>}
              {k.b && <span>{mdInline(k.b, "b" + i)}</span>}
            </div>
          </li>
        ))}
      </ol>
    );
  }
  if (beat === "traps") {
    return (
      <>
        <p className="metro-note">Each of these is a common mistake. Decide why before you open it.</p>
        <Traps list={c.pitfalls} />
      </>
    );
  }
  // check: recall first, then look
  const eq = c.equations && c.equations.find(e => e.label);
  return (
    <>
      <Reveal prompt={<>From memory: what is <b>{kit.name}</b>?</>}><Md src={kit.idea} /></Reveal>
      {eq && (
        <Reveal prompt={<>Recall the key relation: {mdInline(eq.label, "ce")}…</>}>
          <Tex src={eq.tex} block />
          {eq.note && <p className="metro-note">{mdInline(eq.note, "cn")}</p>}
        </Reveal>
      )}
      {!eq && c.pitfalls && (
        <Reveal prompt={<>Name one common mistake people make with {kit.name}.</>}>
          <ul className="metro-prose">{c.pitfalls.map((p, i) => <li key={i}>{mdInline(p.h, "cp" + i)}</li>)}</ul>
        </Reveal>
      )}
    </>
  );
}

window.BU_LESSON = { lessonKit, BeatBody, Md, Tex, Reveal, Traps, Uses, Equations, mdInline, mdBlocks, mdPlain, texPlain, clipText, BEAT_TITLES };
