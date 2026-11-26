/* global React, BU_DATA */
// ─────────────────────────────────────────────────────────────────
// SCREEN · MAP — every topic is a train line
//
// The knowledge graph drawn like a metro map over a city: each course
// cluster is a coloured line, each concept is a stop (one idea, about
// 5 minutes), and a white pill marks two stops that really link two
// courses. "How long do you have?" turns into how many stops your ticket
// covers: that part of every line is in full colour, the rest is faded.
//
// Exports:
//   window.MetroMap  — the screen ({ onStartRide(tour) })
//   window.BU_METRO  — the network model, shared with the Learn screen
// ─────────────────────────────────────────────────────────────────

const { useState, useMemo, useEffect, useRef } = React;

// Line colours, by course name (fallback: a fixed rotation below).
const METRO_COLORS = {
  "spanning tree": "#d4351c",
  "tree decomposition": "#00843d",
  "Directed acyclic graph DAG": "#e87722",
  "convergecast": "#0072ce",
  "randomized rounding": "#00a19a",
  "graph coloring": "#8c4fbf",
  "twin-width": "#6ba539",
  "occurrence list": "#c964cf",
  "Four Color Theorem": "#e0457b",
  "conflict graph": "#c99a00",
  "State space model": "#5a5fd6",
  "Boundary layer": "#2aa1d8",
  "Scan": "#8b5e3c",
  "flow-cut gap": "#7d8a96",
  "Robot autonomy (PoRA)": "#b4531f",
};
const METRO_FALLBACK = ["#d4351c", "#00843d", "#0072ce", "#e87722", "#8c4fbf", "#00a19a", "#e0457b", "#5a5fd6"];

// Hand-drawn layout for the linked part of the network: straight runs at
// 0, 45 and 90 degrees, stations keyed by node id.
//   station: [nodeId, x, y, labelDx, labelDy, textAnchor, labelLines?]
// A course is only drawn this way while its concepts match this table
// exactly; if the data changes, it falls back to a stub line below.
const METRO_LAYOUT = [
  { pts: [[380, 400], [730, 400]], st: [
    ["spanning_tree", 380, 400, -18, 5, "end"],
    ["Minimum_Spanning_Tree_MST", 467, 400, 0, -36, "middle", ["Minimum Spanning", "Tree MST"]],
    ["breadth-first_search_BFS", 555, 400, 0, 28, "middle", ["breadth-first", "search BFS"]],
    ["Rooted_tree_structure", 642, 400, 0, -36, "middle", ["Rooted tree", "structure"]],
    ["distributed_graph_algorithms", 730, 400, 10, 28, "end", ["distributed graph", "algorithms"]] ] },
  { pts: [[380, 370], [380, 235], [420, 195], [600, 195]], st: [
    ["fundamental_cycle", 380, 370, -18, 5, "end"],
    ["planar_graph", 380, 300, 16, 5, "start"],
    ["tree_decomposition", 380, 235, 16, 5, "start"],
    ["Treewidth", 490, 195, 0, -18, "middle"],
    ["graph_diameter", 600, 195, 8, 28, "end"] ] },
  { pts: [[630, 195], [950, 195]], st: [
    ["Distributed_algorithms", 630, 195, 0, -36, "middle", ["Distributed", "algorithms"]],
    ["Approximation_algorithms", 710, 195, 0, 28, "middle", ["Approximation", "algorithms"]],
    ["Vertex_Cover", 790, 195, 0, -18, "middle"],
    ["independent_set", 870, 195, 0, 28, "middle"],
    ["graph_coloring", 950, 195, 0, -18, "middle"] ] },
  { pts: [[760, 260], [760, 540]], st: [
    ["interval_allocation_procedure", 760, 260, 16, 5, "start", ["interval allocation procedure"]],
    ["convergecast", 760, 330, 16, 5, "start"],
    ["BFS_tree", 760, 400, 16, 5, "start"],
    ["CONGEST_model", 760, 470, 16, 5, "start"],
    ["Thorup-Zwicks_tree_routing_scheme", 760, 540, 16, 5, "start"] ] },
  { pts: [[380, 430], [380, 500], [330, 550], [330, 660]], st: [
    ["arborescence", 380, 430, -18, 5, "end"],
    ["Directed_acyclic_graph_DAG", 380, 495, 16, 5, "start"],
    ["biedged_graph", 330, 575, 16, 5, "start"],
    ["ultrabubble", 330, 618, 16, 5, "start"],
    ["independent_sets", 330, 660, 16, 5, "start"] ] },
  { pts: [[350, 300], [70, 300]], st: [
    ["double-ladder", 350, 300, 8, 28, "end"],
    ["concentration_inequalities", 280, 300, 0, -34, "middle", ["concentration", "inequalities"]],
    ["randomized_rounding", 210, 300, 0, 28, "middle", ["randomized", "rounding"]],
    ["PAC_learning", 140, 300, 0, -18, "middle"],
    ["Halfspace_approximation", 70, 300, 0, 28, "middle", ["Halfspace", "approximation"]] ] },
];

const STUB_GAP = 30, STUB_SHOWN = 5, MIN_PER_STOP = 5;

// ─── geometry helpers ─────────────────────────────────────────────
function mmCum(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}
function mmProject(pts, cum, x, y) {
  let best = 0, bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < bd) { bd = d; best = cum[i - 1] + Math.sqrt(len2) * t; }
  }
  return best;
}
function mmAt(pts, cum, s) {
  for (let i = 1; i < pts.length; i++) {
    if (s <= cum[i] + 1e-6) {
      const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
  }
  return pts[pts.length - 1];
}
function mmSub(pts, cum, s0, s1) {
  if (s1 - s0 < 0.5) return "";
  const out = [mmAt(pts, cum, s0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
  out.push(mmAt(pts, cum, s1));
  return out.map((p, j) => (j ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
}
function mmPath(pts) { return pts.map((p, j) => (j ? "L" : "M") + p[0] + " " + p[1]).join(" "); }
function mmMix(hex, t) {
  const n = parseInt(hex.slice(1), 16), m = c => Math.round(c + (255 - c) * t);
  return "#" + [m(n >> 16 & 255), m(n >> 8 & 255), m(n & 255)].map(c => c.toString(16).padStart(2, "0")).join("");
}
function listAnd(names) {
  return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}
function mmWrap(name, max = 18) {
  if (name.length <= max || name.indexOf(" ") < 0) return [name];
  const mid = name.length / 2;
  let cut = -1;
  for (let i = 0; i < name.length; i++) if (name[i] === " " && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
  return [name.slice(0, cut), name.slice(cut + 1)];
}

// ─── the network model ───────────────────────────────────────────
function buildMetro() {
  const D = window.BU_DATA;
  const byId = {};
  D.NODES.forEach(n => { byId[n.id] = n; });
  const isConcept = id => byId[id] && !byId[id].kind; // defense nodes are not stops
  const adj = {};
  D.EDGES.forEach(([a, b]) => {
    if (!isConcept(a) || !isConcept(b)) return;
    (adj[a] = adj[a] || []).push(b);
    (adj[b] = adj[b] || []).push(a);
  });
  const deg = id => (byId[id] && byId[id].degree) || 0;
  const linked = (a, b) => (adj[a] || []).indexOf(b) >= 0;
  const membersOf = {};
  D.NODES.forEach(n => { if (!n.kind) (membersOf[n.cluster] = membersOf[n.cluster] || []).push(n.id); });

  const startOf = (cid, ids) => {
    const cname = ((D.CLUSTERS[cid] || {}).name || "").toLowerCase();
    const named = ids.find(id => byId[id].name.toLowerCase() === cname);
    return named || ids.slice().sort((a, b) => deg(b) - deg(a))[0];
  };

  // Ride order along a drawn line: start at the course's namesake stop and
  // grow outwards one neighbouring stop at a time, so the stops your
  // ticket covers are always one unbroken stretch of line.
  const contiguousOrder = (seq, start) => {
    let lo = seq.indexOf(start), hi = lo;
    const order = [lo];
    while (order.length < seq.length) {
      const a = lo - 1 >= 0 ? lo - 1 : null, b = hi + 1 < seq.length ? hi + 1 : null;
      let pick;
      if (a === null) pick = "b";
      else if (b === null) pick = "a";
      else if (deg(seq[a]) !== deg(seq[b])) pick = deg(seq[a]) > deg(seq[b]) ? "a" : "b";
      else pick = linked(seq[a], seq[lo]) && !linked(seq[b], seq[hi]) ? "a" : "b";
      if (pick === "a") { lo = a; order.push(a); } else { hi = b; order.push(b); }
    }
    return order;
  };

  // Ride order for a course with no drawn layout: depth-first along its own
  // links, best-connected neighbour first.
  const dfsOrder = ids => {
    const inSet = new Set(ids), seen = new Set(), out = [];
    const visit = id => {
      seen.add(id); out.push(id);
      (adj[id] || []).filter(n => inSet.has(n) && !seen.has(n)).sort((a, b) => deg(b) - deg(a)).forEach(n => { if (!seen.has(n)) visit(n); });
    };
    const first = startOf(byId[ids[0]].cluster, ids);
    visit(first);
    ids.slice().sort((a, b) => deg(b) - deg(a)).forEach(id => { if (!seen.has(id)) visit(id); });
    return out;
  };

  const colorFor = (cid, i) => {
    const c = D.CLUSTERS[cid] || {};
    return METRO_COLORS[c.name] || c.color || METRO_FALLBACK[i % METRO_FALLBACK.length];
  };

  const lines = [], laid = new Set();
  METRO_LAYOUT.forEach(spec => {
    const ids = spec.st.map(s => s[0]);
    if (!ids.every(isConcept)) return;
    const cid = byId[ids[0]].cluster;
    const members = membersOf[cid] || [];
    if (laid.has(cid) || members.length !== ids.length || !ids.every(id => byId[id].cluster === cid)) return;
    const start = startOf(cid, ids);
    const order = contiguousOrder(ids, start);
    laid.add(cid);
    lines.push({
      cid, pts: spec.pts, lone: false,
      stations: spec.st.map(s => ({
        id: s[0], name: byId[s[0]].name, x: s[1], y: s[2], dx: s[3], dy: s[4], anchor: s[5],
        label: s[6] || mmWrap(byId[s[0]].name),
      })),
      stops: order.map(i => ids[i]),
      order,
    });
  });

  // Every other course: a short stub in the block below the network.
  let slot = 0;
  D.CLUSTERS.forEach(c => {
    const ids = membersOf[c.id] || [];
    if (laid.has(c.id) || !ids.length) return;
    const stops = dfsOrder(ids);
    const x0 = 510 + (slot % 4) * 160, y = 700 + Math.floor(slot / 4) * 50;
    slot += 1;
    const shown = stops.slice(0, STUB_SHOWN);
    lines.push({
      cid: c.id, lone: true,
      pts: [[x0, y], [x0 + STUB_GAP * Math.max(1, shown.length - 1), y]],
      stations: shown.map((id, j) => ({ id, name: byId[id].name, x: x0 + j * STUB_GAP, y, dx: -6, dy: -14, anchor: "start", label: [""] })),
      stops,
      order: shown.map((_, j) => j),
    });
  });

  lines.forEach((L, i) => {
    const c = D.CLUSTERS[L.cid] || {};
    L.index = i;
    L.name = c.name || "Line " + (i + 1);
    L.color = colorFor(L.cid, i);
    L.cum = mmCum(L.pts);
  });
  const lineOfCluster = {};
  lines.forEach(L => { lineOfCluster[L.cid] = L; });

  // Ride outward from any stop: along the drawn line for laid-out courses,
  // on through the course's own order for stubs.
  lines.forEach(L => {
    if (L.lone) {
      L.orderFrom = id => { const i = Math.max(0, L.stops.indexOf(id)); return L.stops.slice(i).concat(L.stops.slice(0, i)); };
    } else {
      const ids = L.stations.map(s => s.id);
      L.orderFrom = id => contiguousOrder(ids, ids.indexOf(id) >= 0 ? id : L.stops[0]).map(i => ids[i]);
    }
  });

  // Stops on other lines that this stop really links to.
  const partnersAt = id => {
    const me = byId[id];
    if (!me) return [];
    return (adj[id] || []).filter(n => byId[n].cluster !== me.cluster && lineOfCluster[byId[n].cluster])
      .map(n => ({ line: lineOfCluster[byId[n].cluster], id: n }));
  };

  // Courses a stop links to (its "Change here for …" list).
  const changesAt = id => {
    const me = byId[id];
    if (!me) return [];
    const seen = new Set(), out = [];
    (adj[id] || []).forEach(n => {
      const c = byId[n].cluster;
      if (c !== me.cluster && !seen.has(c) && lineOfCluster[c]) { seen.add(c); out.push(lineOfCluster[c]); }
    });
    return out;
  };

  // White pills: two drawn stations, on different lines, that really link
  // and sit side by side on the map.
  const pos = {};
  lines.forEach(L => { if (!L.lone) L.stations.forEach(s => { pos[s.id] = s; }); });
  const pills = [], pilled = new Set();
  D.EDGES.forEach(([a, b]) => {
    const p = pos[a], q = pos[b];
    if (!p || !q || byId[a].cluster === byId[b].cluster) return;
    const sameRow = Math.abs(p.y - q.y) < 0.5, sameCol = Math.abs(p.x - q.x) < 0.5;
    if (!(sameRow || sameCol) || Math.hypot(p.x - q.x, p.y - q.y) > 34) return;
    pills.push({ x: Math.min(p.x, q.x) - 9, y: Math.min(p.y, q.y) - 9, w: Math.abs(p.x - q.x) + 18, h: Math.abs(p.y - q.y) + 18 });
    pilled.add(a); pilled.add(b);
  });

  const lastRow = Math.max(0, Math.floor((slot - 1) / 4));
  const height = Math.max(630, 700 + lastRow * 50 + 40 - 140);

  return { lines, pills, pilled, changesAt, partnersAt, lineOfCluster, byId, height };
}

let _metro = null;
function metroNetwork() {
  if (!_metro) _metro = buildMetro();
  return _metro;
}

function stopsForTime(minutes) {
  return Math.max(1, Math.round(minutes / MIN_PER_STOP));
}

// A ticket: the stops a ride of `k` stops (k × 5 minutes) covers. It starts
// at `startId` when the learner chose a stop, otherwise at the line's next
// stop they haven't ridden. If the line runs out first, the ticket changes
// once, at an interchange, onto a linked line, the way a journey planner
// fills the time you have.
function planRide(L, k, startId) {
  const net = metroNetwork(), P = window.BU_PROGRESS;
  const done = id => !!(P && P.isDone(id));
  let first, again = false;
  const explicit = !!startId && L.stops.indexOf(startId) >= 0;
  if (explicit) first = L.orderFrom(startId);
  else {
    first = L.stops.filter(id => !done(id));
    if (!first.length) { first = L.stops.slice(); again = true; }
  }
  const legs = [{ line: L, stops: first.slice(0, k) }];
  const need = k - legs[0].stops.length;
  if (need > 0) {
    const taken = new Set(legs[0].stops);
    let best = null;
    legs[0].stops.slice().reverse().forEach(id => { // prefer changing at the last stop
      net.partnersAt(id).forEach(p => {
        if (p.line === L) return;
        const cont = p.line.orderFrom(p.id).filter(n => !taken.has(n) && !done(n)).slice(0, need);
        if (cont.length && (!best || cont.length > best.stops.length)) best = { line: p.line, stops: cont, at: id };
      });
    });
    if (best) legs.push(best);
  }
  return { legs, stops: [].concat(...legs.map(g => g.stops)), again, explicit };
}

// The tour format every learning screen shares: [{ node, cluster, kind, rationale }].
function rideTour(plan) {
  const net = metroNetwork(), n = plan.stops.length, out = [];
  plan.legs.forEach((g, gi) => g.stops.forEach((id, j) => {
    const i = out.length, name = net.byId[id].name;
    const changes = net.changesAt(id).filter(c => c !== g.line).map(c => c.name);
    let why = i === 0 ? `Board the ${g.line.name} line at ${name}.`
      : gi > 0 && j === 0 ? `Change to the ${g.line.name} line: ${net.byId[g.at].name} links to ${name}.`
      : `Stop ${i + 1} of ${n} on the ${g.line.name} line.`;
    if (changes.length) why += ` Change here for the ${listAnd(changes)} line${changes.length > 1 ? "s" : ""}.`;
    out.push({
      node: id, cluster: g.line.cid, rationale: why,
      kind: i === 0 ? "start" : i === n - 1 ? "capstone" : gi > 0 && j === 0 ? "bridge" : "deepen",
    });
  }));
  return out;
}

// ─── the little train on the map ─────────────────────────────────
// It rides the stretch of a line between `ids` (the ticket's stops on it),
// pausing at each, starting from the first.
function trainPlan(L, ids) {
  let lit = ids.map(id => L.stations.findIndex(s => s.id === id)).filter(i => i >= 0);
  if (!lit.length) lit = [0];
  const ss = lit.map(i => mmProject(L.pts, L.cum, L.stations[i].x, L.stations[i].y));
  const sorted = ss.slice().sort((a, b) => a - b), start = sorted.indexOf(ss[0]), n = sorted.length - 1;
  const seq = [];
  for (let i = start; i <= n; i++) seq.push(i);
  for (let i = n - 1; i >= 0; i--) seq.push(i);
  for (let i = 1; i < start; i++) seq.push(i);
  if (seq.length > 1 && seq[seq.length - 1] === seq[0]) seq.pop();
  const segs = [];
  let total = 0;
  const DWELL = 1.1, SPEED = 75;
  seq.forEach((a, j) => {
    const sa = sorted[a], sb = sorted[seq[(j + 1) % seq.length]];
    segs.push({ t0: total, dur: DWELL, sa, sb: sa }); total += DWELL;
    if (seq.length > 1) { const d = Math.max(0.6, Math.abs(sb - sa) / SPEED); segs.push({ t0: total, dur: d, sa, sb }); total += d; }
  });
  return { pts: L.pts, cum: L.cum, segs, total, scale: L.lone ? 0.8 : 1.2, born: performance.now() };
}
function trainPose(plan, t) {
  let seg = plan.segs[0];
  for (const s of plan.segs) if (t >= s.t0) seg = s;
  const u = Math.min(1, (t - seg.t0) / seg.dur), e = u * u * (3 - 2 * u), s = seg.sa + (seg.sb - seg.sa) * e;
  const end = plan.cum[plan.cum.length - 1];
  const p = mmAt(plan.pts, plan.cum, s), q = mmAt(plan.pts, plan.cum, Math.min(end, s + 1)), r = mmAt(plan.pts, plan.cum, Math.max(0, s - 1));
  let ang = Math.atan2(q[1] - r[1], q[0] - r[0]) * 180 / Math.PI;
  if (ang > 90.5 || ang < -90.5) ang -= 180; // looks the same both ways; keep it upright
  return `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${plan.scale})`;
}

// ─── small pieces ────────────────────────────────────────────────
// A side-on train: the map title's icon (outlined) and the ride button's (white on red).
function TrainGlyph({ width = 40, windows = "#14171a", outline = "#14171a", wheels = "#14171a", stripe = "#d4351c" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 44 26" style={{ flex: "none", width, height: width * 26 / 44 }}>
      <rect x="2" y="2" width="40" height="17" rx="7" fill="#ffffff" stroke={outline || "none"} strokeWidth="2.5" />
      <rect x="8" y="6" width="7" height="5" rx="1.5" fill={windows} />
      <rect x="18.5" y="6" width="7" height="5" rx="1.5" fill={windows} />
      <rect x="29" y="6" width="7" height="5" rx="1.5" fill={windows} />
      {stripe && <rect x="6" y="13" width="32" height="2.5" rx="1" fill={stripe} />}
      <circle cx="12" cy="22" r="2.6" fill={wheels} />
      <circle cx="32" cy="22" r="2.6" fill={wheels} />
    </svg>
  );
}

function CityBackdrop({ height }) {
  const bottom = 140 + height;
  const streets = useMemo(() => {
    let d = "";
    for (let gx = 42; gx < 1130; gx += 44) d += `M${gx} 140 V${bottom} `;
    for (let gy = 162; gy < bottom; gy += 44) d += `M20 ${gy} H1130 `;
    return d;
  }, [bottom]);
  const trees = useMemo(() => {
    let t = "", h = 0;
    [[464, 248, 686, 336], [70, 584, 284, 716], [882, 292, 1112, 418]].forEach(pk => {
      for (let y = pk[1] + 16; y < pk[3] - 10; y += 24) for (let x = pk[0] + 18; x < pk[2] - 12; x += 26) {
        h += 1;
        const r1 = Math.abs(Math.sin(h * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.sin(h * 78.233) * 12345.678) % 1;
        if (r1 < 0.42) continue;
        const cx = x + (r2 - 0.5) * 12, cy = y + (r1 - 0.5) * 10, r = 4.5 + r2 * 2.5;
        t += `M${(cx - r).toFixed(1)} ${cy.toFixed(1)} a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0 a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0 `;
      }
    });
    return t;
  }, []);
  return (
    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
      <rect x="20" y="140" width="1110" height={height} fill="#efede6" />
      <path d={streets} fill="none" stroke="#f9f8f4" strokeWidth="2.5" />
      <path d={`M20 720 L470 270 M640 ${bottom} L1130 ${bottom - 490}`} fill="none" stroke="#fbfaf7" strokeWidth="8" />
      <path d="M482 248 H668 A18 18 0 0 1 686 266 V318 A18 18 0 0 1 668 336 H482 A18 18 0 0 1 464 318 V266 A18 18 0 0 1 482 248 Z M92 584 H262 A22 22 0 0 1 284 606 V694 A22 22 0 0 1 262 716 H92 A22 22 0 0 1 70 694 V606 A22 22 0 0 1 92 584 Z M902 292 H1092 A20 20 0 0 1 1112 312 V398 A20 20 0 0 1 1092 418 H902 A20 20 0 0 1 882 398 V312 A20 20 0 0 1 902 292 Z" fill="#d5e6c9" />
      <path d={trees} fill="#bdd7ad" />
      <path d="M20 140 L330 140 C290 168 230 186 160 192 C100 197 55 214 20 236 Z" fill="#c6dfea" />
      <path d="M20 470 C120 462 210 510 300 522 S470 548 560 584 S760 606 870 594 S1050 572 1130 604" fill="none" stroke="#c6dfea" strokeWidth="30" />
    </g>
  );
}

function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
}

// ─── the screen ──────────────────────────────────────────────────
function MetroMap({ onStartRide }) {
  const net = metroNetwork();
  const LINES = net.lines;
  const P = window.BU_PROGRESS;
  const [time, setTime] = useState(() => {
    const t = readPref("bu_metro_time", 15);
    return [5, 15, 30].indexOf(t) >= 0 ? t : 15;
  });
  const [sel, setSel] = useState(() => {
    const cid = readPref("bu_metro_line", null);
    const L = cid === null ? null : net.lineOfCluster[cid];
    return L ? L.index : 0;
  });
  const [startId, setStartId] = useState(null); // a stop the learner chose to start at
  const [q, setQ] = useState("");
  const [, rerender] = useState(0);
  useEffect(() => writePref("bu_metro_time", time), [time]);
  useEffect(() => writePref("bu_metro_line", LINES[sel].cid), [sel]);
  useEffect(() => (P ? P.subscribe(() => rerender(n => n + 1)) : undefined), []);

  const isDone = id => !!(P && P.isDone(id));
  const S = LINES[sel];
  const k = stopsForTime(time);
  const plan = planRide(S, k, startId);
  const defaults = LINES.map(L => (L === S ? plan : planRide(L, k)));
  const litOf = L => {
    const leg = plan.legs.find(g => g.line === L);
    return leg ? leg.stops : defaults[L.index].legs[0].stops;
  };
  const startStop = plan.stops[0];
  const n = plan.stops.length;

  const pickLine = li => { setSel(li); setStartId(null); };
  const pickStop = (li, id) => {
    setSel(li);
    setStartId(id === planRide(LINES[li], k).stops[0] ? null : id);
  };

  // Search: the stop whose own name matches the most words wins.
  const STOPWORDS = { the: 1, and: 1, for: 1, with: 1, from: 1, this: 1, that: 1, into: 1 };
  const tokens = v => v.toLowerCase().split(/[\s,;./·]+/).filter(w => w.length > 2 && !STOPWORDS[w]);
  const hits = (text, toks) => toks.reduce((a, w) => a + (text.toLowerCase().indexOf(w) >= 0 ? 1 : 0), 0);
  const best = useMemo(() => {
    const toks = tokens(q);
    if (!toks.length) return null;
    let top = null, topN = 0, lines = 0;
    LINES.forEach((L, li) => {
      let any = false;
      L.stops.forEach(id => {
        const h = hits(net.byId[id].name, toks);
        if (h > 0) any = true;
        if (h > topN) { top = { li, id }; topN = h; }
      });
      if (any || hits(L.name, toks) > 0) lines += 1;
    });
    return top ? { ...top, lines } : { lines: 0 };
  }, [q]);
  const onQuery = e => {
    const v = e.target.value;
    setQ(v);
    const toks = tokens(v);
    let top = null, topN = 0;
    LINES.forEach((L, li) => L.stops.forEach(id => {
      const h = hits(net.byId[id].name, toks);
      if (h > topN) { top = { li, id }; topN = h; }
    }));
    if (top) pickStop(top.li, top.id);
  };

  // the train rides the stretch of the selected line your ticket covers
  const trainRef = useRef(null);
  const trainIds = plan.legs[0].stops;
  const train = useMemo(() => trainPlan(S, trainIds), [sel, trainIds.join("|")]);
  useEffect(() => {
    let raf = 0, dead = false;
    const reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const tick = () => {
      if (dead) return;
      const el = trainRef.current;
      if (el) el.setAttribute("transform", trainPose(train, reduce ? 0 : ((performance.now() - train.born) / 1000) % train.total));
      if (!reduce) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, [train]);

  const start = () => onStartRide && onStartRide(rideTour(plan));

  // Review: stops whose spaced-repetition review is due (from your ratings)
  const dueList = P && P.due ? P.due().filter(c => net.byId[c.node]) : [];
  const dueIds = new Set(dueList.map(c => c.node));
  const nReview = Math.min(dueList.length, k);
  const startReview = () => {
    const RATED = { 0: "Not yet", 1: "Not yet", 2: "Not yet", 3: "Mostly", 4: "Mostly", 5: "Got it" };
    const tour = dueList.slice(0, nReview).map((c, i) => ({
      node: c.node, cluster: net.byId[c.node].cluster,
      kind: i === 0 ? "start" : i === nReview - 1 ? "capstone" : "deepen",
      rationale: `Review: you rated this "${RATED[c.last_quality] || "Not yet"}" last time. Rate it again to set the next review.`,
    }));
    if (tour.length && onStartRide) onStartRide(tour);
  };

  // the panel's stop list: the selected line in riding order (a window of it
  // for long lines), then the stops after a change of line
  const pos = {};
  plan.stops.forEach((id, i) => { pos[id] = i; });
  let rows = S.stops, before = 0, after = 0;
  if (rows.length > 8) {
    const at = Math.max(0, Math.min(S.stops.length - 8, S.stops.indexOf(plan.legs[0].stops[0]) - 1));
    rows = S.stops.slice(at, at + 8); before = at; after = S.stops.length - at - rows.length;
  }
  const doneOn = L => L.stops.filter(isDone).length;
  const tagOf = id => (id in pos ? (pos[id] === 0 ? "start" : pos[id] * MIN_PER_STOP + " min") : isDone(id) ? "done" : "later");
  const stopRow = (L, li, id, last, key) => {
    const inPlan = id in pos, done = isDone(id), next = rows[rows.indexOf(id) + 1];
    const railOn = inPlan && L === S && next !== undefined && next in pos;
    const ch = net.changesAt(id).filter(c => c !== L);
    return (
      <li key={key}>
        <div aria-hidden="true" className="metro-rail">
          <span style={{ background: last ? "transparent" : railOn ? L.color : "#dfe2dd" }} />
          <i style={{ borderColor: inPlan || done ? L.color : "#b9bec4", background: (done && !inPlan) || id === startStop ? L.color : "#ffffff" }} />
        </div>
        <div className="metro-stop">
          <button type="button" className="metro-stopbtn" onClick={() => pickStop(li, id)}
                  style={{ fontWeight: id === startStop ? 700 : 600, color: inPlan ? "#14171a" : "#6b7178" }}>
            {net.byId[id].name}
          </button>
          {ch.length > 0 && <span className="metro-change">Change for {listAnd(ch.map(c => c.name))}</span>}
        </div>
        <span className="metro-when">{tagOf(id) === "done" ? "✓ done" : tagOf(id)}</span>
      </li>
    );
  };

  const transfer = plan.legs[1];
  const height = net.height;

  return (
    <div className="metro metro-page">
      <aside className="metro-card metro-panel" aria-label="Plan your trip">
        <div className="metro-field">
          <label htmlFor="metro-q" className="metro-label-strong">What do you want to learn?</label>
          <input id="metro-q" type="text" autoComplete="off" placeholder="e.g. graph algorithms"
                 value={q} onChange={onQuery} className="metro-input" />
          {best && (
            <span className="metro-note">
              {best.id
                ? <>Best match: <b>{net.byId[best.id].name}</b> on the {LINES[best.li].name} line{best.lines > 1 ? ` (${best.lines} lines match)` : ""}.</>
                : "No stop matches that yet."}
            </span>
          )}
        </div>

        <div className="metro-field">
          <span id="metro-time" className="metro-label-strong">How long do you have?</span>
          <div role="group" aria-labelledby="metro-time" className="metro-tickets">
            {[5, 15, 30].map(v => (
              <button key={v} type="button" aria-pressed={v === time} onClick={() => setTime(v)}
                      className={"metro-ticket" + (v === time ? " on" : "")}>{v} min</button>
            ))}
          </div>
        </div>

        {dueList.length > 0 && (
          <div className="metro-review">
            <div>
              <b>Review · {dueList.length} {dueList.length === 1 ? "stop" : "stops"} due</b>
              <span>{listAnd(dueList.slice(0, 3).map(c => net.byId[c.node].name))}{dueList.length > 3 ? " and more" : ""}</span>
            </div>
            <button type="button" className="metro-btn ghost" onClick={startReview}>
              Review {nReview} {nReview === 1 ? "stop" : "stops"}
            </button>
          </div>
        )}

        <div className="metro-field" style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="metro-chip" style={{ background: S.color }}>{S.name} line</span>
            {doneOn(S) > 0 && <span className="metro-note">{doneOn(S)} of {S.stops.length} ridden</span>}
          </div>
          {before > 0 && <span className="metro-note">{before} earlier {before === 1 ? "stop" : "stops"}</span>}
          <ol aria-label={`Stops on the ${S.name} line, in riding order. Choose one to start there.`} className="metro-stoplist">
            {rows.map((id, i) => stopRow(S, sel, id, i === rows.length - 1 && !transfer, id))}
            {transfer && (
              <li className="metro-transfer">
                <span style={{ background: transfer.line.color }} aria-hidden="true" />
                Change at {net.byId[transfer.at].name} for the {transfer.line.name} line
              </li>
            )}
            {transfer && transfer.stops.map((id, i) => stopRow(transfer.line, transfer.line.index, id, i === transfer.stops.length - 1, "t" + id))}
          </ol>
          <span className="metro-note">
            {after > 0 ? `…and ${after} more ${after === 1 ? "stop" : "stops"}. ` : ""}
            {S.lone ? "This line is not linked to the main network yet. " : ""}
            {plan.again ? "You've ridden this whole line, so this ticket rides it again. " : ""}
            {`Your ${time}-minute ticket covers ${n} ${n === 1 ? "stop" : "stops"}${transfer ? " on two lines" : ""}`}
            {n < k ? `; the line ends after ${n * MIN_PER_STOP} minutes.` : "."}
          </span>
          {plan.explicit && (
            <button type="button" className="metro-linkbtn" onClick={() => setStartId(null)}>
              Start from my next stop instead
            </button>
          )}
        </div>

        <button type="button" className="metro-cta" onClick={start}>
          <TrainGlyph width={34} windows="#d4351c" outline={null} wheels="#ffffff" stripe={null} />
          Start ride · {n} {n === 1 ? "stop" : "stops"}{transfer ? " · 1 change" : ""}
        </button>
      </aside>

      <section className="metro-card metro-mapcard" aria-labelledby="metro-title">
        <div className="metro-maphead">
          <h1 id="metro-title"><TrainGlyph width={40} />Topic map</h1>
          <span>Read it like a metro map: each line is a topic, each stop is one idea (about {MIN_PER_STOP} minutes). Click a stop to start there.</span>
        </div>

        <div className="metro-mapbox">
          <svg role="img" viewBox={`20 140 1110 ${height}`}
               aria-label={`Topic map drawn like a metro map over a city. ${LINES.length} topics are coloured lines; ${LINES.filter(L => !L.lone).length} meet at interchanges and ${LINES.filter(L => L.lone).length} are not linked to them yet. The ${S.name} line is selected; your ride starts at ${net.byId[startStop].name}. On every line the part your ${time} minutes reaches is in full colour, and stops you have ridden are filled in.`}>
            <CityBackdrop height={height} />
            {LINES.map((L, li) => {
              const isSel = li === sel, ids = litOf(L);
              const ss = ids.map(id => L.stations.find(s => s.id === id)).filter(Boolean)
                .map(s => mmProject(L.pts, L.cum, s.x, s.y));
              const d = mmPath(L.pts), dLit = ss.length ? mmSub(L.pts, L.cum, Math.min(...ss), Math.max(...ss)) : "";
              return (
                <g key={L.cid}>
                  {isSel && <path d={d} fill="none" stroke="rgba(20,23,26,0.28)" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />}
                  <path d={d} fill="none" stroke="#ffffff" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
                  <path d={d} fill="none" stroke={mmMix(L.color, 0.65)} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
                  {dLit && <path d={dLit} fill="none" stroke={L.color} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />}
                  <path d={d} className="metro-hit" onClick={() => pickLine(li)} fill="none" stroke="transparent" strokeWidth="26" strokeLinecap="round" />
                </g>
              );
            })}
            {net.pills.map((p, i) => <rect key={"o" + i} x={p.x} y={p.y} width={p.w} height={p.h} rx="9" fill="#14171a" stroke="#14171a" strokeWidth="6" />)}
            {net.pills.map((p, i) => <rect key={"f" + i} x={p.x} y={p.y} width={p.w} height={p.h} rx="9" fill="#ffffff" />)}
            {LINES.map((L, li) => {
              const isSel = li === sel, lit = litOf(L), faded = mmMix(L.color, 0.65);
              return L.stations.map((s, si) => {
                const on = lit.indexOf(s.id) >= 0, change = net.pilled.has(s.id), first = s.id === startStop, done = isDone(s.id);
                const label = L.lone ? (si === 0 ? [L.name] : [""]) : s.label;
                return (
                  <g key={s.id} className="metro-hit" onClick={() => pickStop(li, s.id)}>
                    {dueIds.has(s.id) && <circle cx={s.x} cy={s.y} r={first ? 14 : 11} fill="none" stroke="#e8a100" strokeWidth="3" />}
                    <circle cx={s.x} cy={s.y} r={first ? 10 : change ? 7.5 : 6.5}
                            fill={first || done ? L.color : "#ffffff"}
                            stroke={first || change ? "#14171a" : on || done ? L.color : faded}
                            strokeWidth={first ? 4 : 3} />
                    {done && !first && (
                      <path d={`M${s.x - 3} ${s.y} l2.2 2.4 l4 -4.6`} fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                    <text className="metro-maplabel" x={s.x + s.dx} y={s.y + s.dy} textAnchor={s.anchor}
                          style={{ fontWeight: isSel ? 700 : 500, fill: isSel ? "#14171a" : L.lone ? "#2b3036" : "#3a3f45" }}>
                      <tspan x={s.x + s.dx}>{label[0]}</tspan>
                      {label[1] && <tspan x={s.x + s.dx} dy="16">{label[1]}</tspan>}
                    </text>
                  </g>
                );
              }).concat(L.lone && L.stops.length > L.stations.length ? [
                <text key="more" className="metro-maplabel" x={L.pts[1][0] + 14} y={L.pts[1][1] + 5}
                      style={{ fontSize: 13, fill: "#51575e" }}>+{L.stops.length - L.stations.length}</text>,
              ] : []);
            })}
            {LINES.some(L => L.lone) && (
              <text className="metro-maplabel" x="504" y="655" style={{ fontWeight: 700, fill: "#51575e" }}>
                Not linked to the main network yet
              </text>
            )}
            <g ref={trainRef} transform={trainPose(train, 0)} aria-hidden="true" style={{ pointerEvents: "none" }}>
              <rect x="-19" y="-9" width="38" height="17" rx="7" fill="#ffffff" stroke="#14171a" strokeWidth="2.5" />
              <rect x="-13" y="-5" width="7" height="5" rx="1.5" fill="#14171a" />
              <rect x="-3.5" y="-5" width="7" height="5" rx="1.5" fill="#14171a" />
              <rect x="6" y="-5" width="7" height="5" rx="1.5" fill="#14171a" />
              <rect x="-15" y="2" width="30" height="2.5" rx="1" fill={S.color} />
              <circle cx="-10" cy="11" r="2.6" fill="#14171a" />
              <circle cx="10" cy="11" r="2.6" fill="#14171a" />
            </g>
          </svg>
        </div>

        <div className="metro-key">
          <b>Key</b>
          <span><svg aria-hidden="true" viewBox="0 0 40 12" width="40" height="12"><path d="M4 6 L36 6" stroke="#d4351c" strokeWidth="8" strokeLinecap="round" /></svg>In your time</span>
          <span><svg aria-hidden="true" viewBox="0 0 40 12" width="40" height="12"><path d="M4 6 L36 6" stroke="#f2b9ae" strokeWidth="8" strokeLinecap="round" /></svg>Later</span>
          <span><svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="6" fill="#ffffff" stroke="#d4351c" strokeWidth="3" /></svg>Stop: one idea, about {MIN_PER_STOP} min</span>
          <span><svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="6" fill="#d4351c" stroke="#d4351c" strokeWidth="3" /><path d="M6 9 l2.2 2.4 l4 -4.6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Done</span>
          <span><svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="8.5" fill={S.color} stroke="#14171a" strokeWidth="3.5" /></svg>Your first stop</span>
          {dueIds.size > 0 && <span><svg aria-hidden="true" viewBox="0 0 26 26" width="24" height="24"><circle cx="13" cy="13" r="10" fill="none" stroke="#e8a100" strokeWidth="3" /><circle cx="13" cy="13" r="5.5" fill="#ffffff" stroke="#d4351c" strokeWidth="3" /></svg>Due for review</span>}
          <span><svg aria-hidden="true" viewBox="0 0 44 18" width="44" height="18"><rect x="2" y="2" width="40" height="14" rx="7" fill="#ffffff" stroke="#14171a" strokeWidth="2.5" /></svg>Change lines here</span>
        </div>

        <div role="group" aria-label="Lines" className="metro-linegrid">
          {LINES.map((L, li) => {
            const d = doneOn(L);
            return (
              <button key={L.cid} type="button" aria-pressed={li === sel} onClick={() => pickLine(li)}
                      className={"metro-linebtn" + (li === sel ? " on" : "")}>
                <span aria-hidden="true" style={{ background: L.color }} />
                <em>{L.name}</em>
                {d > 0 && <small>{d}/{L.stops.length}</small>}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

window.MetroMap = MetroMap;
window.BU_METRO = { network: metroNetwork, planRide, rideTour, stopsForTime, listAnd, mix: mmMix, TrainGlyph, MIN_PER_STOP };
