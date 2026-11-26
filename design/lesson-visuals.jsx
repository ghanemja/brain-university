/* global React, BU_DATA, BU_METRO */
// ─────────────────────────────────────────────────────────────────
// LESSON VISUALS — a picture for every stop
//
// Each stop gets a short animated diagram ("See it"). Diagrams are computed
// by running the real thing on a small example, so they are correct, not
// decorative: Kruskal picks the edges, BFS spreads in layers, max-flow finds
// the cut, the 2-approximate cover is compared with the true optimum, the
// Kalman filter really filters. Three kinds of scene:
//   graph — nodes and edges, per-frame styles, labels, packets, bags
//   array — rows of cells (scan, filter, partition, sort, indexes)
//   plot  — curves, points and bands on axes (physics, control, statistics)
// Stops without a scene of their own get "where it connects": the stop and
// its real links on the map.
//
// Pure functions render a frame to an SVG string (also used to paint the
// platform boards in the 3D ride); <Visual> plays the frames.
// Exports window.BU_VISUALS = { sceneFor, Visual, svgFor, dataUrlFor }.
// ─────────────────────────────────────────────────────────────────

const VW = 400, VH = 240, NODE_R = 14;
const VFONT = "Geist, 'Helvetica Neue', Arial, sans-serif";
const PAL = ["#d4351c", "#1d70b8", "#00703c", "#f2c200"];
const PAL_INK = ["#ffffff", "#ffffff", "#ffffff", "#14171a"];

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function ekey(a, b, dir) { return dir ? a + ">" + b : (a < b ? a + "-" + b : b + "-" + a); }

// ─── small graph algorithms (on {nodes:{id:[x,y]}, edges:[[a,b,w?]]}) ───
function adjOf(g) {
  const adj = {};
  Object.keys(g.nodes).forEach(id => { adj[id] = []; });
  g.edges.forEach(([a, b, w]) => { adj[a].push([b, w == null ? 1 : w]); if (!g.directed) adj[b].push([a, w == null ? 1 : w]); });
  Object.values(adj).forEach(l => l.sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  return adj;
}
function bfs(g, root) {
  const adj = adjOf(g), dist = { [root]: 0 }, parent = {}, order = [root], q = [root];
  while (q.length) {
    const u = q.shift();
    adj[u].forEach(([v]) => { if (!(v in dist)) { dist[v] = dist[u] + 1; parent[v] = u; order.push(v); q.push(v); } });
  }
  return { dist, parent, order };
}
function treePath(parent, a, b) { // path a→b in a rooted tree given parent links
  const up = x => { const p = [x]; while (parent[x] !== undefined) { x = parent[x]; p.push(x); } return p; };
  const pa = up(a), pb = up(b), sb = new Set(pb);
  const lca = pa.find(x => sb.has(x));
  return pa.slice(0, pa.indexOf(lca) + 1).concat(pb.slice(0, pb.indexOf(lca)).reverse());
}
function pathEdges(path, dir) { const out = []; for (let i = 1; i < path.length; i++) out.push(ekey(path[i - 1], path[i], dir)); return out; }
function unionFind(ids) {
  const p = {}; ids.forEach(i => { p[i] = i; });
  const find = x => (p[x] === x ? x : (p[x] = find(p[x])));
  return { find, union: (a, b) => { p[find(a)] = find(b); } };
}
function subsetsMin(ids, ok) { // smallest subset satisfying ok (brute force, tiny graphs only)
  let best = null;
  for (let m = 0; m < (1 << ids.length); m++) {
    const s = ids.filter((_, i) => m & (1 << i));
    if ((!best || s.length < best.length) && ok(new Set(s))) best = s;
  }
  return best;
}
function subsetsMax(ids, ok) {
  let best = [];
  for (let m = 0; m < (1 << ids.length); m++) {
    const s = ids.filter((_, i) => m & (1 << i));
    if (s.length > best.length && ok(new Set(s))) best = s;
  }
  return best;
}
const styleAll = (ids, s) => { const o = {}; ids.forEach(i => { o[i] = s; }); return o; };

// ─── sample graphs ────────────────────────────────────────────────
const G8 = { // planar, 8 nodes, 12 weighted edges
  nodes: { A: [50, 120], B: [130, 45], C: [130, 195], D: [220, 95], E: [220, 195], F: [300, 45], G: [310, 170], H: [370, 105] },
  edges: [["A", "B", 4], ["A", "C", 2], ["B", "C", 3], ["B", "D", 3], ["C", "D", 6], ["C", "E", 7], ["D", "E", 1], ["D", "F", 8], ["E", "G", 4], ["F", "G", 2], ["F", "H", 5], ["G", "H", 3]],
};
const T7 = { // a rooted tree
  nodes: { r: [200, 32], a: [115, 112], b: [285, 112], c: [60, 196], d: [165, 196], e: [240, 196], f: [340, 196] },
  edges: [["r", "a"], ["r", "b"], ["a", "c"], ["a", "d"], ["b", "e"], ["b", "f"]],
};
const W5 = { // wheel: hub + 5-cycle (needs 4 colours)
  nodes: { h: [200, 122], p: [200, 26], q: [300, 92], s: [262, 210], t: [138, 210], u: [100, 92] },
  edges: [["h", "p"], ["h", "q"], ["h", "s"], ["h", "t"], ["h", "u"], ["p", "q"], ["q", "s"], ["s", "t"], ["t", "u"], ["u", "p"]],
};

// ─── scene builders ───────────────────────────────────────────────
function gscene(g, frames, extra) { return Object.assign({ kind: "graph", nodes: g.nodes, edges: g.edges, directed: !!g.directed, frames }, extra || {}); }

function spanningTreeScene(opts = {}) {
  const g = G8, { parent, dist } = bfs(g, "A");
  const tree = Object.keys(parent).map(v => ekey(v, parent[v]));
  const maxd = Math.max(...Object.values(dist));
  const frames = [{ say: "A connected graph: 8 nodes, 12 edges. Keep every node, drop edges until no loop is left." }];
  for (let d = 1; d <= maxd; d++) {
    const n = {}, e = {};
    Object.keys(dist).forEach(v => { n[v] = dist[v] <= d ? "on" : "base"; });
    Object.keys(parent).forEach(v => { if (dist[v] <= d) e[ekey(v, parent[v])] = "on"; });
    frames.push({ say: d === 1 ? "Start at A and take one edge to each new node it can reach." : "Keep reaching new nodes, one edge each.", n, e });
  }
  const e = styleAll(g.edges.map(x => ekey(x[0], x[1])), "dim"); tree.forEach(k => { e[k] = "on"; });
  frames.push({ say: "A spanning tree: all 8 nodes, exactly 7 edges, no cycles. Remove any edge and it falls apart.", n: styleAll(Object.keys(g.nodes), "on"), e });
  const extraEdge = opts.cycleEdge || ["C", "D"];
  const cyc = pathEdges(treePath(parent, extraEdge[0], extraEdge[1]));
  const e2 = Object.assign({}, e); cyc.forEach(k => { e2[k] = "hot"; }); e2[ekey(extraEdge[0], extraEdge[1])] = "hot";
  frames.push({ say: `Add back any other edge, like ${extraEdge.join("–")}, and it closes exactly one cycle.`, n: styleAll(Object.keys(g.nodes), "on"), e: e2 });
  return gscene(g, frames, { title: "Building a spanning tree" });
}

function fundamentalCycleScene() {
  const g = G8, { parent } = bfs(g, "A");
  const tree = new Set(Object.keys(parent).map(v => ekey(v, parent[v])));
  const base = styleAll(g.edges.map(x => ekey(x[0], x[1])), "dim"); tree.forEach(k => { base[k] = "on"; });
  const frames = [{ say: "Start from a spanning tree (bold). The 5 faint edges are not in the tree.", n: styleAll(Object.keys(g.nodes), "on"), e: base }];
  g.edges.filter(x => !tree.has(ekey(x[0], x[1]))).slice(0, 3).forEach(([a, b]) => {
    const e = Object.assign({}, base);
    pathEdges(treePath(parent, a, b)).forEach(k => { e[k] = "hot"; }); e[ekey(a, b)] = "hot";
    frames.push({ say: `Edge ${a}–${b} plus the tree path between ${a} and ${b}: its fundamental cycle.`, n: styleAll(Object.keys(g.nodes), "on"), e });
  });
  frames.push({ say: "One cycle per non-tree edge. Together they generate every cycle of the graph.", n: styleAll(Object.keys(g.nodes), "on"), e: base });
  return gscene(g, frames, { title: "Fundamental cycles" });
}

function mstScene() {
  const g = G8, uf = unionFind(Object.keys(g.nodes));
  const sorted = g.edges.slice().sort((x, y) => x[2] - y[2] || (x[0] + x[1] < y[0] + y[1] ? -1 : 1));
  const e = {}, frames = [{ say: "Each edge has a cost. Kruskal's method: look at edges cheapest first.", showW: true }];
  let taken = 0, total = 0;
  for (const [a, b, w] of sorted) {
    if (taken === 7) break;
    const k = ekey(a, b);
    if (uf.find(a) !== uf.find(b)) {
      uf.union(a, b); taken++; total += w; e[k] = "on";
      frames.push({ say: `${a}–${b} costs ${w} and joins two separate pieces: take it.`, e: Object.assign({}, e), showW: true });
    } else {
      frames.push({ say: `${a}–${b} costs ${w} but would close a loop: skip it.`, e: Object.assign({}, e, { [k]: "hot" }), showW: true });
      e[k] = "dim";
    }
  }
  const fin = styleAll(g.edges.map(x => ekey(x[0], x[1])), "dim"); Object.keys(e).forEach(k => { if (e[k] === "on") fin[k] = "on"; });
  frames.push({ say: `Done after 7 edges: total cost ${total}. No other spanning tree costs less.`, e: fin, n: styleAll(Object.keys(g.nodes), "on"), showW: true });
  return gscene(g, frames, { title: "Minimum spanning tree (Kruskal)" });
}

function bfsScene({ treeOnly = false, root = "A", g = G8, title = "Breadth-first search" } = {}) {
  const { dist, parent } = bfs(g, root), maxd = Math.max(...Object.values(dist));
  const frames = [{ say: `Start at ${root}. It is 0 steps from itself.`, n: { [root]: "on" }, nl: { [root]: "0" } }];
  for (let d = 1; d <= maxd; d++) {
    const n = {}, nl = {}, e = {};
    Object.keys(dist).forEach(v => { if (dist[v] <= d) { n[v] = dist[v] === d ? "visit" : "on"; nl[v] = String(dist[v]); } });
    Object.keys(parent).forEach(v => { if (dist[v] <= d) e[ekey(v, parent[v])] = "on"; });
    const layer = Object.keys(dist).filter(v => dist[v] === d);
    frames.push({ say: `Layer ${d}: ${layer.join(", ")}, found from layer ${d - 1}. Every node at distance ${d} is reached before any at ${d + 1}.`, n, nl, e });
  }
  const e = styleAll(g.edges.map(x => ekey(x[0], x[1])), "dim"); Object.keys(parent).forEach(v => { e[ekey(v, parent[v])] = "on"; });
  const nl = {}; Object.keys(dist).forEach(v => { nl[v] = String(dist[v]); });
  frames.push({ say: treeOnly ? `The BFS tree: each node hangs under the node that found it, at its true distance from ${root}.` : `Kept edges form a BFS tree: its paths are shortest paths from ${root}.`, n: styleAll(Object.keys(g.nodes), "on"), nl, e });
  return gscene(g, frames, { title });
}

function diameterScene() {
  const g = G8, ids = Object.keys(g.nodes);
  let best = null;
  ids.forEach(s => { const { dist, parent } = bfs(g, s); ids.forEach(t => { if (!best || dist[t] > best.d) best = { s, t, d: dist[t], parent }; }); });
  const ecc = {}; ids.forEach(s => { ecc[s] = String(Math.max(...Object.values(bfs(g, s).dist))); });
  const path = treePath(best.parent, best.t, best.s);
  const e = {}; pathEdges(path).forEach(k => { e[k] = "hot"; });
  return gscene(g, [
    { say: "How far apart can two nodes be, travelling the shortest way?" },
    { say: "Run BFS from every node and note its farthest distance (its eccentricity).", nl: ecc },
    { say: `The largest is ${best.d}: from ${best.s} to ${best.t}. That's the diameter.`, nl: ecc, n: Object.assign(styleAll(path, "visit"), { [best.s]: "hot", [best.t]: "hot" }), e },
    { say: `In a distributed network, news needs at least ${best.d} rounds to cross it: the diameter is a speed limit.`, n: Object.assign(styleAll(path, "visit"), { [best.s]: "hot", [best.t]: "hot" }), e },
  ], { title: "Graph diameter" });
}

function roundsScene({ mode = "flood", g = G8, root = "A" } = {}) {
  const { dist, parent } = bfs(g, root), maxd = Math.max(...Object.values(dist));
  const intro = {
    flood: `Every node is a computer that only talks to its neighbours, in rounds. ${root} has news.`,
    congest: "CONGEST model: in each round, every edge carries one small message, about log n bits, each way.",
    tree: "Distributed BFS tree: each node joins under the first neighbour that reaches it.",
  }[mode];
  const frames = [{ say: intro, n: { [root]: "on" } }];
  for (let r = 1; r <= maxd; r++) {
    const n = {}, e = {}, pk = [];
    Object.keys(dist).forEach(v => { if (dist[v] < r) n[v] = "on"; else if (dist[v] === r) n[v] = "visit"; });
    Object.keys(parent).forEach(v => {
      if (dist[v] < r && mode === "tree") e[ekey(v, parent[v])] = "on";
      if (dist[v] === r) pk.push([parent[v], v, mode === "congest" ? "id" : "!"]);
    });
    frames.push({ say: `Round ${r}: nodes that know send to their neighbours; ${Object.keys(dist).filter(v => dist[v] === r).join(", ")} learn${mode === "tree" ? " and pick a parent" : ""}.`, n, e, pk });
  }
  const e = mode === "tree" ? (() => { const o = styleAll(g.edges.map(x => ekey(x[0], x[1])), "dim"); Object.keys(parent).forEach(v => { o[ekey(v, parent[v])] = "on"; }); return o; })() : {};
  frames.push({ say: mode === "congest" ? `Done in ${maxd} rounds, with small messages only. Clever algorithms work within that bandwidth.` : `Everyone knows after ${maxd} rounds, the farthest distance from ${root}. Time is counted in rounds, not steps.`, n: styleAll(Object.keys(g.nodes), "on"), e });
  return gscene(g, frames, { title: mode === "congest" ? "The CONGEST model" : "Distributed rounds" });
}

function rootedTreeScene() {
  const g = T7, { dist } = bfs(g, "r");
  const nl = {}; Object.keys(dist).forEach(v => { nl[v] = "depth " + dist[v]; });
  const dg = Object.assign({}, g, { directed: true, edges: g.edges.map(([a, b]) => [b, a]) });
  return gscene(dg, [
    { say: "Pick one node to be the root: r.", n: { r: "on" } },
    { say: "Every other node gets a parent: its neighbour one step closer to the root.", n: { r: "on", a: "visit", b: "visit" }, nl },
    { say: "Arrows point to the parent. Each node has exactly one, except the root.", n: styleAll(Object.keys(g.nodes), "on"), nl, e: styleAll(dg.edges.map(x => ekey(x[0], x[1], true)), "on") },
    { say: "Depth = steps to the root. Children, subtrees and leaves (c, d, e, f) all follow from the parents.", n: Object.assign(styleAll(["c", "d", "e", "f"], "visit"), { r: "on", a: "on", b: "on" }), nl },
  ], { title: "A rooted tree" });
}

function convergecastScene() {
  const g = T7, val = { r: 1, a: 2, b: 3, c: 4, d: 5, e: 6, f: 7 };
  const nl0 = {}; Object.keys(val).forEach(v => { nl0[v] = "has " + val[v]; });
  const sumA = val.a + val.c + val.d, sumB = val.b + val.e + val.f, tot = val.r + sumA + sumB;
  return gscene(g, [
    { say: "Each node holds a number. The root wants the total, but nodes only talk to neighbours.", nl: nl0, n: { r: "on" } },
    { say: "Round 1: the leaves send their numbers up to their parents.", nl: nl0, n: styleAll(["c", "d", "e", "f"], "visit"), pk: [["c", "a", "4", 0.4], ["d", "a", "5", 0.4], ["e", "b", "6", 0.4], ["f", "b", "7", 0.4]] },
    { say: `Round 2: a and b add what they got to their own and pass one number up.`, nl: Object.assign({}, nl0, { a: "sum " + sumA, b: "sum " + sumB }), n: styleAll(["a", "b"], "visit"), pk: [["a", "r", String(sumA), 0.4], ["b", "r", String(sumB), 0.4]] },
    { say: `The root adds them up: ${tot}. One message per edge, rounds = tree depth. That's a convergecast.`, nl: Object.assign({}, nl0, { r: "total " + tot }), n: styleAll(Object.keys(g.nodes), "on"), e: styleAll(g.edges.map(x => ekey(x[0], x[1])), "on") },
  ], { title: "Convergecast" });
}

function dfsIntervals(g, root) { // pre-order numbering; each node's interval covers its subtree
  const adj = adjOf(g), num = {}, iv = {};
  let next = 1;
  const go = (u, p) => { num[u] = next++; adj[u].forEach(([v]) => { if (v !== p) go(v, u); }); iv[u] = [num[u], next - 1]; };
  go(root, null);
  return iv;
}
function intervalScene() {
  const g = T7, iv = dfsIntervals(g, "r");
  const lab = ids => { const o = {}; ids.forEach(v => { o[v] = `[${iv[v][0]},${iv[v][1]}]`; }); return o; };
  return gscene(g, [
    { say: "Give every node a number in depth-first order: r is 1, then down the left side first.", nl: (() => { const o = {}; Object.keys(iv).forEach(v => { o[v] = String(iv[v][0]); }); return o; })() },
    { say: `The root gets the whole range ${lab(["r"]).r}.`, nl: lab(["r"]), n: { r: "on" } },
    { say: "Each child gets a slice just big enough for its subtree.", nl: lab(["r", "a", "b"]), n: { r: "on", a: "visit", b: "visit" } },
    { say: "Down to the leaves. A node's interval holds exactly the numbers of its subtree, so 'is x below me?' is one comparison.", nl: lab(Object.keys(g.nodes)), n: styleAll(Object.keys(g.nodes), "on") },
  ], { title: "Interval allocation" });
}

function treeRoutingScene() {
  const g = T7, iv = dfsIntervals(g, "r"), lab = {}; Object.keys(iv).forEach(v => { lab[v] = `[${iv[v][0]},${iv[v][1]}]`; });
  const { parent } = bfs(g, "r"), path = treePath(parent, "c", "f"), dest = iv.f[0];
  const frames = [{ say: `Each node knows its interval. A packet at c is addressed to f, whose label is ${dest}.`, nl: lab, n: { c: "on", f: "hot" } }];
  for (let i = 1; i < path.length; i++) {
    const at = path[i - 1], to = path[i], down = iv[to][0] <= dest && dest <= iv[to][1] && parent[to] === at;
    frames.push({ say: down ? `At ${at}: ${dest} is inside child ${to}'s interval ${lab[to]}, so go down to ${to}.` : `At ${at}: ${dest} is not in ${at}'s own interval ${lab[at]}, so go up to the parent ${to}.`, nl: lab, n: Object.assign(styleAll(path.slice(0, i), "visit"), { [to]: "on", f: "hot" }), pk: [[at, to, "→" + dest]], e: styleAll(pathEdges(path.slice(0, i + 1)), "on") });
  }
  frames.push({ say: "Delivered using only small labels and local decisions: the idea behind compact tree routing schemes.", nl: lab, n: Object.assign(styleAll(path, "visit"), { f: "hot" }), e: styleAll(pathEdges(path), "on") });
  return gscene(g, frames, { title: "Routing in a tree with interval labels" });
}

function greedyColoring(g, order) {
  const adj = adjOf(g), col = {};
  order.forEach(v => { const used = new Set(adj[v].map(([u]) => col[u]).filter(c => c != null)); let c = 0; while (used.has(c)) c++; col[v] = c; });
  return col;
}
function coloringScene() {
  const g = G8, order = Object.keys(g.nodes), col = greedyColoring(g, order);
  const frames = [{ say: "Colour every node so that no edge joins two nodes of the same colour." }];
  const n = {};
  for (let i = 0; i < order.length; i += 2) {
    order.slice(i, i + 2).forEach(v => { n[v] = "c" + col[v]; });
    frames.push({ say: `${order.slice(i, i + 2).join(" and ")}: take the first colour their coloured neighbours don't use.`, n: Object.assign({}, n) });
  }
  const k = Math.max(...Object.values(col)) + 1;
  frames.push({ say: `${k} colours, no clash on any edge. B, C and D form a triangle, so ${k} is the fewest possible here.`, n: Object.assign({}, n) });
  return gscene(g, frames, { title: "Graph colouring" });
}

function coverOk(g) { return s => g.edges.every(([a, b]) => s.has(a) || s.has(b)); }
function indepOk(g) { return s => g.edges.every(([a, b]) => !(s.has(a) && s.has(b))); }
function vertexCoverScene({ approx = false } = {}) {
  const g = G8, ids = Object.keys(g.nodes), cover = new Set(), frames = [];
  frames.push({ say: "Vertex cover: choose nodes so every edge touches at least one chosen node." });
  const e = {}, first = ["B-D", "C-E", "F-G"];
  const order = g.edges.slice().sort((x, y) => (first.includes(ekey(y[0], y[1])) ? 1 : 0) - (first.includes(ekey(x[0], x[1])) ? 1 : 0));
  order.forEach(([a, b]) => {
    if (cover.has(a) || cover.has(b)) return;
    cover.add(a); cover.add(b);
    g.edges.forEach(([x, y]) => { if (cover.has(x) || cover.has(y)) e[ekey(x, y)] = "dim"; });
    e[ekey(a, b)] = "hot";
    frames.push({ say: `Edge ${a}–${b} isn't covered yet: take both ends.`, n: styleAll([...cover], "on"), e: Object.assign({}, e) });
    e[ekey(a, b)] = "dim";
  });
  const opt = subsetsMin(ids, coverOk(g));
  frames.push({ say: `Every edge is covered with ${cover.size} nodes. The best possible needs ${opt.length}${approx ? `: ratio ${(cover.size / opt.length).toFixed(1)}, never worse than 2` : ""}.`, n: styleAll([...cover], "on") });
  frames.push({ say: `A smallest cover: ${opt.join(", ")}. Finding it is NP-hard in general; taking both ends of uncovered edges is fast and at most twice as big.`, n: styleAll(opt, "good") });
  return gscene(g, frames, { title: approx ? "A 2-approximation" : "Vertex cover" });
}
function independentSetScene({ conflict = false } = {}) {
  const g = G8, adj = adjOf(g), alive = new Set(Object.keys(g.nodes)), pick = [], frames = [];
  frames.push({ say: conflict ? "Conflict graph: nodes are options, an edge means two options clash. Pick as many as possible with no clash." : "Independent set: choose nodes with no edge between any two of them." });
  const n = {};
  while (alive.size) {
    const v = [...alive].sort((x, y) => adj[x].filter(([u]) => alive.has(u)).length - adj[y].filter(([u]) => alive.has(u)).length || (x < y ? -1 : 1))[0];
    pick.push(v); n[v] = "on"; alive.delete(v);
    adj[v].forEach(([u]) => { if (alive.has(u)) { alive.delete(u); n[u] = "dim"; } });
    frames.push({ say: `Take ${v} (fewest free neighbours) and rule out its neighbours.`, n: Object.assign({}, n) });
  }
  const opt = subsetsMax(Object.keys(g.nodes), indepOk(g));
  frames.push({ say: `Greedy found ${pick.length}: ${pick.join(", ")}. The largest possible has ${opt.length}: ${opt.join(", ")}.`, n: styleAll(opt, "good") });
  return gscene(g, frames, { title: conflict ? "Choosing without conflicts" : "Independent set" });
}

const D6 = {
  directed: true,
  nodes: { s1: [50, 60], s2: [50, 180], m1: [160, 60], m2: [160, 180], m3: [265, 120], t: [360, 120] },
  edges: [["s1", "m1"], ["s1", "m2"], ["s2", "m2"], ["m1", "m3"], ["m2", "m3"], ["m2", "t"], ["m3", "t"]],
};
function dagScene() {
  const g = D6, indeg = {}, out = {};
  Object.keys(g.nodes).forEach(v => { indeg[v] = 0; out[v] = []; });
  g.edges.forEach(([a, b]) => { indeg[b]++; out[a].push(b); });
  const frames = [{ say: "A directed acyclic graph: every edge has a direction, and you can never walk in a loop." }];
  const nl = {}, n = {}, done = new Set();
  let k = 1;
  while (done.size < Object.keys(g.nodes).length) {
    const ready = Object.keys(g.nodes).filter(v => !done.has(v) && indeg[v] === 0);
    ready.forEach(v => { nl[v] = "#" + k++; n[v] = "on"; done.add(v); out[v].forEach(w => { indeg[w]--; }); });
    frames.push({ say: `Nodes with nothing left pointing into them can go next: ${ready.join(", ")}.`, nl: Object.assign({}, nl), n: Object.assign({}, n) });
  }
  frames.push({ say: "A topological order: every edge points forward. Only acyclic graphs have one.", nl, n });
  return gscene(g, frames, { title: "A DAG and its topological order" });
}
function arborescenceScene() {
  const g = Object.assign({}, T7, { directed: true });
  const ek = g.edges.map(x => ekey(x[0], x[1], true));
  return gscene(g, [
    { say: "An arborescence: a tree whose edges all point away from one root, r.", n: { r: "on" } },
    { say: "From r there is exactly one directed path to every other node.", n: styleAll(Object.keys(g.nodes), "on"), e: styleAll(ek, "on") },
    { say: "Every node except r has exactly one edge coming in. An extra edge into d (highlighted) would break that.", n: styleAll(Object.keys(g.nodes), "on"), e: styleAll(ek, "on"), add: [{ a: "e", b: "d", s: "hot", dir: true }] },
  ], { title: "An arborescence" });
}

function planarScene() {
  const nodes = { a: [100, 40], b: [300, 40], c: [300, 200], d: [100, 200] };
  const edges = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"], ["a", "c"], ["b", "d"]];
  return gscene({ nodes, edges }, [
    { say: "Four nodes, every pair joined (K4). Drawn like this, two edges cross.", e: { "a-c": "hot", "b-d": "hot" } },
    { say: "Move d inside the triangle a, b, c…", pos: { d: [240, 92] } },
    { say: "…and nothing crosses. A graph is planar if some drawing has no crossings.", pos: { d: [240, 92] }, n: styleAll(["a", "b", "c", "d"], "on"), e: styleAll(edges.map(x => ekey(x[0], x[1])), "on") },
    { say: "K5 and K3,3 can never be drawn that way; planar graphs are exactly those that avoid them as minors (Wagner's theorem).", pos: { d: [240, 92] }, n: styleAll(["a", "b", "c", "d"], "on") },
  ], { title: "Planar graphs" });
}

function treeDecompScene({ width = false } = {}) {
  const nodes = { 1: [30, 50], 2: [110, 50], 3: [190, 50], 6: [30, 190], 5: [110, 190], 4: [190, 190] };
  const edges = [["1", "2"], ["2", "3"], ["3", "4"], ["4", "5"], ["5", "6"], ["6", "1"], ["2", "5"]];
  const bags = [["1", "2", "6"], ["2", "5", "6"], ["2", "3", "5"], ["3", "4", "5"]];
  const items = bags.map((b, i) => ({ kind: "bag", x: 250, y: 20 + i * 54, w: 130, h: 38, label: "{" + b.join(", ") + "}" }));
  const links = [0, 1, 2].map(i => ({ kind: "vline", x: 315, y1: 58 + i * 54, y2: 74 + i * 54 }));
  const frames = [{ say: "Two squares sharing edge 2–5. Cut it into small overlapping bags of nodes, arranged as a tree.", items: items.concat(links) }];
  bags.forEach((b, i) => {
    frames.push({ say: i === 0 ? "Every edge must sit inside some bag…" : i === 1 ? "…and a node's bags must be joined up along the tree (2 is in the first three)." : `Bag {${b.join(", ")}} covers ${b.length === 3 ? "its edges" : ""}.`, n: styleAll(b, "on"), items: items.map((it, j) => Object.assign({}, it, { s: j === i ? "on" : "base" })).concat(links) });
  });
  frames.push({ say: width ? "Width = biggest bag − 1 = 2. Treewidth is the smallest width any decomposition can reach: trees have 1, an n×n grid has n." : "A tree decomposition. Hard problems become easy when you solve them bag by bag along the tree.", items: items.map(it => Object.assign({}, it, { s: "on" })).concat(links), n: styleAll(Object.keys(nodes), "on") });
  return gscene({ nodes, edges }, frames, { title: width ? "Treewidth" : "Tree decomposition" });
}

function bubbleScene() {
  const g = {
    directed: true,
    nodes: { s: [35, 135], a: [115, 88], p: [190, 50], q: [190, 126], c: [265, 88], x: [190, 205], t: [345, 135] },
    edges: [["s", "a"], ["s", "x"], ["a", "p"], ["a", "q"], ["p", "c"], ["q", "c"], ["c", "t"], ["x", "t"]],
  };
  const all = Object.keys(g.nodes), outer = { ids: all, label: "ultrabubble (s, t)", pad: 26 };
  return gscene(g, [
    { say: "A variation graph: each path from s to t spells one version of a sequence, say one person's genome." },
    { say: "Paths split at s and all meet again at t: a bubble, a site where versions differ.", n: Object.assign(styleAll(["a", "p", "q", "c", "x"], "visit"), { s: "on", t: "on" }), box: [Object.assign({}, outer, { label: "bubble (s, t)" })] },
    { say: "It's an ultrabubble: inside it there are no cycles and no dead ends, and nothing enters or leaves except through s and t.", n: Object.assign(styleAll(["a", "p", "q", "c", "x"], "visit"), { s: "on", t: "on" }), box: [outer], e: styleAll(g.edges.map(x => ekey(x[0], x[1], true)), "on") },
    { say: "Inside it, a and c bound a smaller ultrabubble. Ultrabubbles nest, giving a tree of variant sites that tools can walk.", n: { s: "on", t: "on", a: "hot", c: "hot", p: "visit", q: "visit" }, box: [outer, { ids: ["a", "p", "q", "c"], label: "nested (a, c)", pad: 14 }] },
  ], { title: "Bubbles and ultrabubbles" });
}
function biedgedScene() {
  const segs = ["1", "2", "3"], nodes = {}, edges = [];
  segs.forEach((s, i) => { nodes[s + "L"] = [55 + i * 125, 120]; nodes[s + "R"] = [115 + i * 125, 120]; edges.push([s + "L", s + "R"]); });
  const black = segs.map(s => ekey(s + "L", s + "R"));
  const grey = [["1R", "2L"], ["2R", "3L"], ["1R", "3L"]];
  return {
    kind: "graph", nodes, edges, title: "A biedged graph", smallNodes: true,
    frames: [
      { say: "Each DNA segment becomes two nodes, its two sides, joined by a black edge.", e: styleAll(black, "ink") },
      { say: "Grey edges join sides that sit next to each other in some genome.", e: styleAll(black, "ink"), add: grey.map(([a, b]) => ({ a, b, s: "grey", curve: a === "1R" && b === "3L" ? -70 : 0 })) },
      { say: "A genome is a walk that alternates black and grey edges. This one reads segments 1, 2, 3.", e: styleAll(black, "ink"), add: grey.map(([a, b]) => ({ a, b, s: a === "1R" && b === "3L" ? "dim" : "on", curve: a === "1R" && b === "3L" ? -70 : 0 })) },
      { say: "Another genome skips segment 2: 1 then 3. Where walks split and rejoin like this, the graph has a bubble.", e: Object.assign(styleAll(black, "ink"), { "2L-2R": "dim" }), add: grey.map(([a, b]) => ({ a, b, s: a === "1R" && b === "3L" ? "hot" : "dim", curve: a === "1R" && b === "3L" ? -70 : 0 })) },
    ],
  };
}

function powerGraphScene() {
  const nodes = { a: [40, 185], b: [95, 100], c: [175, 55], d: [260, 55], e: [325, 105], f: [365, 190] };
  const edges = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["e", "f"]];
  const g = { nodes, edges }, add = [];
  Object.keys(nodes).forEach(u => { const { dist } = bfs(g, u); Object.keys(dist).forEach(v => { if (u < v && dist[v] === 2) add.push({ a: u, b: v, s: "new" }); }); });
  return gscene(g, [
    { say: "A path of 6 nodes." },
    { say: "The square G²: also join every pair at distance 2 (dashed).", add },
    { say: "In G^k, nodes k steps apart become neighbours: one round in G^k is k rounds in G.", add, n: styleAll(Object.keys(nodes), "on") },
  ], { title: "Power graph" });
}
function spannerScene() {
  const nodes = { a: [60, 60], b: [200, 30], c: [340, 60], d: [60, 190], e: [200, 210], f: [340, 190], g: [200, 120] };
  const edges = [["a", "b"], ["b", "c"], ["a", "d"], ["c", "f"], ["d", "e"], ["e", "f"], ["a", "g"], ["b", "g"], ["c", "g"], ["d", "g"], ["e", "g"], ["f", "g"], ["a", "e"], ["b", "f"]];
  const t = 3, keep = [];
  edges.forEach(([u, v]) => { const { dist } = bfs({ nodes, edges: keep }, u); if (!(v in dist) || dist[v] > t) keep.push([u, v]); });
  const kk = new Set(keep.map(x => ekey(x[0], x[1])));
  const dropped = edges.filter(x => !kk.has(ekey(x[0], x[1])));
  const [u, v] = dropped[0], { dist, parent } = bfs({ nodes, edges: keep }, u), path = treePath(parent, v, u);
  const e = {}; edges.forEach(x => { e[ekey(x[0], x[1])] = kk.has(ekey(x[0], x[1])) ? "on" : "dim"; });
  const e2 = Object.assign({}, e); pathEdges(path).forEach(k => { e2[k] = "hot"; }); e2[ekey(u, v)] = "cut";
  return gscene({ nodes, edges }, [
    { say: `A graph with ${edges.length} edges.` },
    { say: `Keep an edge only if its ends are more than ${t} hops apart without it. ${keep.length} edges stay.`, e },
    { say: `Dropped edge ${u}–${v}: its ends are still ${dist[v]} hops apart. Every distance grows by at most ×${t}: a ${t}-spanner.`, e: e2, n: Object.assign(styleAll(path, "visit"), { [u]: "hot", [v]: "hot" }) },
  ], { title: "A 3-spanner" });
}
function twinWidthScene() {
  const nodes = { u: [130, 70], v: [130, 170], a: [290, 30], b: [300, 95], c: [300, 150], d: [290, 210] };
  const edges = [["u", "a"], ["u", "b"], ["u", "c"], ["v", "a"], ["v", "b"], ["v", "d"]];
  return gscene({ nodes, edges }, [
    { say: "u and v are near-twins: both link to a and b; only u links to c, only v to d.", n: { u: "on", v: "on" } },
    { say: "Merge them into one part. Edges they agree on stay black; edges they disagree on turn red.", pos: { u: [130, 120], v: [130, 120] }, n: { u: "on", v: "on" }, e: { "c-u": "red", "d-v": "red" }, nl: { v: "u+v" } },
    { say: "Here the merged part has 2 red edges. Twin-width ≤ d if you can merge all the way down to one part, never exceeding d red edges at any part.", pos: { u: [130, 120], v: [130, 120] }, n: { u: "on", v: "on", c: "hot", d: "hot" }, e: { "c-u": "red", "d-v": "red" }, nl: { v: "red degree 2" } },
  ], { title: "Twin-width" });
}

const BF = {
  directed: true,
  nodes: { S: [40, 120], A: [150, 45], B: [150, 195], C: [265, 45], D: [265, 195], T: [365, 120] },
  edges: [["C", "T", 2], ["D", "C", -2], ["D", "T", 5], ["A", "C", 3], ["B", "D", 4], ["B", "A", -1], ["S", "B", 2], ["S", "A", 4]],
};
function bellmanFordScene() {
  const g = BF, ids = Object.keys(g.nodes), dist = {}, par = {};
  ids.forEach(v => { dist[v] = Infinity; }); dist.S = 0;
  const lab = () => { const o = {}; ids.forEach(v => { o[v] = dist[v] === Infinity ? "∞" : String(dist[v]); }); return o; };
  const frames = [{ say: "Shortest paths from S. Some edges cost less than nothing (negative), so Dijkstra's shortcut fails.", nl: lab(), n: { S: "on" }, showW: true }];
  for (let r = 1; r < ids.length; r++) {
    let changed = [];
    g.edges.forEach(([a, b, w]) => { if (dist[a] + w < dist[b]) { dist[b] = dist[a] + w; par[b] = a; changed.push(b); } });
    if (!changed.length) { frames.push({ say: `Round ${r}: nothing improves, so the distances are final.`, nl: lab(), showW: true, n: styleAll(ids, "on") }); break; }
    frames.push({ say: `Round ${r}: relax every edge, in the same fixed order. Improved: ${[...new Set(changed)].join(", ")}.`, nl: lab(), n: Object.assign(styleAll(ids.filter(v => dist[v] < Infinity), "on"), styleAll([...new Set(changed)], "visit")), showW: true, e: styleAll(Object.keys(par).map(v => ekey(par[v], v, true)), "on") });
  }
  frames.push({ say: "After at most n−1 rounds every shortest path is found. One more improving round would mean a negative cycle.", nl: lab(), n: styleAll(ids, "on"), showW: true, e: styleAll(Object.keys(par).map(v => ekey(par[v], v, true)), "on") });
  return gscene(g, frames, { title: "Bellman–Ford" });
}

function fourColorScene() {
  const g = W5, ids = Object.keys(g.nodes), adj = adjOf(g), col = {};
  const solve = i => { if (i === ids.length) return true; const v = ids[i]; for (let c = 0; c < 4; c++) { if (adj[v].every(([u]) => col[u] !== c)) { col[v] = c; if (solve(i + 1)) return true; delete col[v]; } } return false; };
  solve(0);
  const n = styleAll(ids, "base"), frames = [{ say: "Countries that share a border become neighbours. Here a hub country touches a ring of five." }];
  const ring = ["h", "p", "q", "s", "t", "u"];
  for (let i = 0; i < ring.length; i += 2) { ring.slice(i, i + 2).forEach(v => { n[v] = "c" + col[v]; }); frames.push({ say: i === 0 ? "Colour so that neighbours always differ." : "An odd ring needs 3 colours by itself; the hub needs a 4th.", n: Object.assign({}, n) }); }
  frames.push({ say: "Four colours. The theorem: four always suffice for any map on a plane, proved in 1976 with a computer check of unavoidable configurations.", n: Object.assign({}, n) });
  return gscene(g, frames, { title: "The four colour theorem" });
}
function kempeScene() {
  const g = W5, adj = adjOf(g);
  const col = { h: 3, p: 0, q: 1, s: 0, t: 1, u: 2 };
  const n0 = {}; Object.keys(col).forEach(v => { n0[v] = "c" + col[v]; });
  const comp = new Set(["p"]), q = ["p"];
  while (q.length) { const x = q.shift(); adj[x].forEach(([y]) => { if (!comp.has(y) && (col[y] === 0 || col[y] === 1)) { comp.add(y); q.push(y); } }); }
  const swapped = Object.assign({}, col); comp.forEach(v => { swapped[v] = col[v] === 0 ? 1 : 0; });
  const n1 = {}; Object.keys(swapped).forEach(v => { n1[v] = "c" + swapped[v]; });
  const ce = g.edges.filter(([a, b]) => comp.has(a) && comp.has(b)).map(([a, b]) => ekey(a, b));
  return gscene(g, [
    { say: "A proper colouring. Pick two colours, red and blue.", n: n0 },
    { say: `The red–blue Kempe chain from p: everything reachable from p through red and blue nodes only.`, n: n0, e: styleAll(ce, "ink") },
    { say: "Swap red and blue along the chain. Still proper: inside the chain nothing changes relatively, and outside it nothing touched it.", n: n1, e: styleAll(ce, "ink") },
    { say: "Kempe used such swaps to free a colour for one more node; it's the key move in proofs about colouring planar maps.", n: n1 },
  ], { title: "Kempe chains" });
}
function degreeScene() {
  const g = G8, adj = adjOf(g), nl = {};
  Object.keys(adj).forEach(v => { nl[v] = "deg " + adj[v].length; });
  const mind = Math.min(...Object.values(adj).map(l => l.length)), lows = Object.keys(adj).filter(v => adj[v].length === mind);
  return gscene(g, [
    { say: "The degree of a node: how many edges touch it.", nl },
    { say: `Here degrees range from ${mind} to ${Math.max(...Object.values(adj).map(l => l.length))}.`, nl, n: styleAll(lows, "visit") },
    { say: "Every planar graph has a node of degree at most 5 (from Euler's formula). Colouring proofs remove such a node and recurse.", nl, n: styleAll(lows, "hot") },
  ], { title: "Degrees in planar graphs" });
}

const FN = {
  directed: true,
  nodes: { s: [40, 120], a: [145, 50], b: [145, 190], c: [260, 50], d: [260, 190], t: [365, 120] },
  edges: [["s", "a", 3], ["s", "b", 2], ["a", "c", 2], ["a", "b", 1], ["b", "d", 3], ["c", "t", 3], ["d", "t", 2], ["d", "c", 1]],
};
function maxflow(g, s, t) {
  const cap = {}, ids = Object.keys(g.nodes);
  ids.forEach(u => { cap[u] = {}; ids.forEach(v => { cap[u][v] = 0; }); });
  g.edges.forEach(([a, b, w]) => { cap[a][b] += w; });
  const flow = {}; ids.forEach(u => { flow[u] = {}; ids.forEach(v => { flow[u][v] = 0; }); });
  let total = 0;
  for (;;) {
    const par = { [s]: null }, q = [s];
    while (q.length && !(t in par)) { const u = q.shift(); ids.forEach(v => { if (!(v in par) && cap[u][v] - flow[u][v] > 0) { par[v] = u; q.push(v); } }); }
    if (!(t in par)) break;
    let f = Infinity; for (let v = t; par[v] != null; v = par[v]) f = Math.min(f, cap[par[v]][v] - flow[par[v]][v]);
    for (let v = t; par[v] != null; v = par[v]) { flow[par[v]][v] += f; flow[v][par[v]] -= f; }
    total += f;
  }
  const side = new Set([s]), q = [s];
  while (q.length) { const u = q.shift(); ids.forEach(v => { if (!side.has(v) && cap[u][v] - flow[u][v] > 0) { side.add(v); q.push(v); } }); }
  return { total, flow, side };
}
function flowCutScene({ mode = "gap" } = {}) {
  const g = FN, { total, flow, side } = maxflow(g, "s", "t");
  const cut = g.edges.filter(([a, b]) => side.has(a) && !side.has(b)).map(([a, b]) => ekey(a, b, true));
  const el = {}; g.edges.forEach(([a, b, w]) => { el[ekey(a, b, true)] = `${Math.max(0, flow[a][b])}/${w}`; });
  const frames = [
    { say: "A network: each pipe has a capacity. How much can flow from s to t?", showW: true },
    { say: `Push flow along paths until none has room left: ${total} units get through (flow/capacity).`, el, e: styleAll(g.edges.filter(([a, b]) => flow[a][b] > 0).map(([a, b]) => ekey(a, b, true)), "flow") },
    { say: `Cut the pipes from {${[...side].join(", ")}} to the rest: their capacities add up to ${total} too. Max flow = min cut.`, el, e: Object.assign(styleAll(g.edges.filter(([a, b]) => flow[a][b] > 0).map(([a, b]) => ekey(a, b, true)), "flow"), styleAll(cut, "cut")), n: styleAll([...side], "visit") },
  ];
  if (mode === "gap") frames.push({ say: "With many source–sink pairs sharing the network, the best cut can exceed the best flow. The worst-case ratio is the flow–cut gap: O(log k) for k pairs.", el, e: styleAll(cut, "cut"), n: styleAll([...side], "visit") });
  if (mode === "fractional") frames.push({ say: "A fractional cut gives each pipe a weight from 0 to 1 so that every s–t path adds up to at least 1. Its best value equals the max flow (LP duality); rounding it to a real cut is the hard part.", el, e: styleAll(cut, "cut") });
  if (mode === "edge") frames.push({ say: "Edge-capacitated: the limits sit on the pipes, as here. Cuts remove edges.", el, e: styleAll(cut, "cut") });
  return gscene(g, frames, { title: mode === "gap" ? "Flows and cuts" : mode === "fractional" ? "Fractional cuts" : "Edge capacities" });
}
function vertexCapScene() {
  const g = FN, nl = { a: "cap 2", b: "cap 3", c: "cap 3", d: "cap 1" };
  return gscene(Object.assign({}, g, { edges: g.edges.map(([a, b]) => [a, b]) }), [
    { say: "Vertex-capacitated: now the limits sit on the junctions, not the pipes.", nl },
    { say: "At most 2 units may pass through a, 1 through d. Cuts now remove nodes instead of edges.", nl, n: { a: "visit", d: "hot" } },
    { say: "Split each node into in → out with one edge of the node's capacity, and you're back to edge capacities.", nl, n: styleAll(["a", "b", "c", "d"], "visit") },
  ], { title: "Vertex capacities" });
}
function vertexWeightedScene() {
  const g = { nodes: G8.nodes, edges: G8.edges.map(([a, b]) => [a, b]) };
  const w = { A: 1, B: 3, C: 1, D: 2, E: 5, F: 1, G: 2, H: 1 }, adj = adjOf(g);
  const dist = { A: w.A }, par = {}, done = new Set();
  while (done.size < 8) {
    const u = Object.keys(dist).filter(x => !done.has(x)).sort((x, y) => dist[x] - dist[y])[0];
    done.add(u);
    adj[u].forEach(([v]) => { if (!done.has(v) && (dist[v] === undefined || dist[u] + w[v] < dist[v])) { dist[v] = dist[u] + w[v]; par[v] = u; } });
  }
  const path = treePath(par, "H", "A"), nl = {}; Object.keys(w).forEach(v => { nl[v] = "w " + w[v]; });
  return gscene(g, [
    { say: "Weights on the nodes, not the edges: passing through a node costs its weight.", nl },
    { say: `Cheapest route A → H counts every node it passes: total ${dist.H}.`, nl, n: styleAll(path, "visit"), e: styleAll(pathEdges(path), "on") },
    { say: "That's vertex-weighted distance; it is what vertex-capacitated cut problems are measured in.", nl, n: styleAll(path, "visit"), e: styleAll(pathEdges(path), "on") },
  ], { title: "Vertex-weighted distance" });
}

// ─── arrays ───────────────────────────────────────────────────────
const AR = [3, 1, 4, 1, 5, 9, 2, 6];
const cells = (vals, s) => vals.map((v, i) => ({ v, s: typeof s === "function" ? s(v, i) : s || "base" }));
function scanScene() {
  const frames = [{ say: "Scan (prefix sum): each output is the total of everything up to it.", rows: [{ label: "input", cells: cells(AR) }] }];
  let run = 0; const out = [];
  [0, 1, 2, 4, 7].forEach(stop => {
    while (out.length <= stop) { run += AR[out.length]; out.push(run); }
    frames.push({ say: `Up to position ${stop + 1}: ${AR.slice(0, stop + 1).join(" + ")} = ${out[stop]}.`, rows: [{ label: "input", cells: cells(AR, (v, i) => (i <= stop ? "on" : "base")) }, { label: "scan", cells: cells(out, (v, i) => (i === stop ? "visit" : "on")) }] });
  });
  frames.push({ say: "In parallel this takes about log n steps, not n: a building block of fast algorithms (and of Filter and Partition).", rows: [{ label: "input", cells: cells(AR) }, { label: "scan", cells: cells(out, "on") }] });
  return { kind: "array", title: "Scan", frames };
}
function reduceScene() {
  let level = AR.slice(); const rows = [{ label: "input", cells: cells(level) }], frames = [{ say: "Reduce: combine everything into one value, here a sum.", rows: rows.slice() }];
  let step = 1;
  while (level.length > 1) {
    const next = []; for (let i = 0; i < level.length; i += 2) next.push(level[i] + (level[i + 1] || 0));
    rows.push({ label: "step " + step, cells: cells(next, "on") }); level = next;
    frames.push({ say: step === 1 ? "Add neighbouring pairs, all at once." : `Again: ${next.length === 1 ? "one value left" : next.length + " values left"}.`, rows: rows.slice() });
    step++;
  }
  frames.push({ say: `Total ${level[0]} in ${step - 1} parallel steps (log₂ 8 = 3). Any associative operation works: max, min, product.`, rows });
  return { kind: "array", title: "Reduce", frames };
}
function filterScene() {
  const keep = v => v % 2 === 0 || v > 4, out = AR.filter(keep);
  return { kind: "array", title: "Filter", frames: [
    { say: "Filter: keep the items that pass a test. Test: even or bigger than 4.", rows: [{ label: "input", cells: cells(AR) }] },
    { say: "Mark the ones that pass (1) and fail (0).", rows: [{ label: "input", cells: cells(AR, v => (keep(v) ? "on" : "dim")) }, { label: "pass?", cells: cells(AR.map(v => (keep(v) ? 1 : 0)), v => (v ? "on" : "dim")) }] },
    { say: "A scan of the marks tells each kept item its slot in the output.", rows: [{ label: "pass?", cells: cells(AR.map(v => (keep(v) ? 1 : 0)), v => (v ? "on" : "dim")) }, { label: "slot", cells: cells(AR.map((v, i) => AR.slice(0, i + 1).filter(keep).length), (v, i) => (keep(AR[i]) ? "visit" : "dim")) }] },
    { say: `Write them out: ${out.length} items, in order.`, rows: [{ label: "input", cells: cells(AR, v => (keep(v) ? "on" : "dim")) }, { label: "output", cells: cells(out, "on") }] },
  ] };
}
function partitionScene() {
  const pivot = 4, lo = AR.filter(v => v < pivot), hi = AR.filter(v => v >= pivot);
  return { kind: "array", title: "Partition", frames: [
    { say: `Partition around a pivot, ${pivot}: smaller items go left, the rest go right.`, rows: [{ label: "input", cells: cells(AR, v => (v === pivot ? "hot" : "base")) }] },
    { say: "Compare every item with the pivot (in parallel).", rows: [{ label: "input", cells: cells(AR, v => (v < pivot ? "visit" : "on")) }] },
    { say: `${lo.length} smaller, ${hi.length} not. Two filters, one after the other.`, rows: [{ label: "input", cells: cells(AR, v => (v < pivot ? "visit" : "on")) }, { label: "output", cells: cells(lo.concat(hi), (v, i) => (i < lo.length ? "visit" : "on")) }] },
    { say: "Quicksort is partition applied again inside each side.", rows: [{ label: "output", cells: cells(lo.concat(hi), (v, i) => (i < lo.length ? "visit" : "on")) }] },
  ] };
}
function sortScene() {
  const frames = [{ say: "Merge sort: sort pairs, then merge sorted runs, doubling each time.", rows: [{ label: "input", cells: cells(AR) }] }];
  let runs = AR.map(v => [v]), step = 1;
  while (runs.length > 1) {
    const next = []; for (let i = 0; i < runs.length; i += 2) next.push((runs[i].concat(runs[i + 1] || [])).sort((a, b) => a - b));
    runs = next;
    const flat = [].concat(...runs), bounds = []; let acc = 0; runs.forEach(r => { acc += r.length; bounds.push(acc); });
    frames.push({ say: `Merge into runs of ${runs[0].length}: compare the fronts of two runs, take the smaller.`, rows: [{ label: "step " + step++, cells: flat.map((v, i) => ({ v, s: bounds.findIndex(b => i < b) % 2 ? "visit" : "on" })) }] });
  }
  frames.push({ say: "Sorted. Any sort that only compares items needs about n log n comparisons in the worst case.", rows: [{ label: "sorted", cells: cells(runs[0], "on") }] });
  return { kind: "array", title: "Comparison sort", frames };
}
function occurrenceScene() {
  const words = ["graph", "tree", "path", "graph", "cut", "tree", "graph", "flow"];
  const pos = w => words.map((x, i) => (x === w ? i + 1 : null)).filter(Boolean);
  return { kind: "array", title: "Occurrence lists", frames: [
    { say: "A text, word by word (positions 1–8).", rows: [{ label: "text", cells: cells(words) }] },
    { say: "For each word, store the list of places it occurs.", rows: [{ label: "text", cells: cells(words, w => (w === "graph" ? "on" : "base")) }, { label: "graph →", cells: cells(pos("graph"), "on") }] },
    { say: "Every word gets its list. Now 'where does tree occur?' is a lookup, not a scan of the text.", rows: [{ label: "graph →", cells: cells(pos("graph"), "on") }, { label: "tree →", cells: cells(pos("tree"), "visit") }, { label: "cut →", cells: cells(pos("cut"), "base") }] },
  ] };
}
function directAccessScene() {
  const ans = [2, 5, 7, 11, 13, 17, 19, 23];
  return { kind: "array", title: "Direct access", frames: [
    { say: "A query has many answers. Instead of listing them all, answer 'what is answer number i?'", rows: [{ label: "answers", cells: cells(ans, "dim") }] },
    { say: "After some preparation, jump straight to answer 5 without producing answers 1–4.", rows: [{ label: "answers", cells: cells(ans, (v, i) => (i === 4 ? "hot" : "dim")) }] },
    { say: "Fast direct access also gives counting, medians and random samples of the answers for free.", rows: [{ label: "answers", cells: cells(ans, (v, i) => (i === 3 || i === 4 ? "visit" : "dim")) }] },
  ] };
}
function constantDelayScene() {
  const t = ["prep", "prep", "prep", "out", "out", "out", "out", "out"];
  return { kind: "array", title: "Constant-delay enumeration", frames: [
    { say: "Listing all answers to a query. First, a preparation phase (linear in the input).", rows: [{ label: "time", cells: cells(t, (v, i) => (i < 3 ? "visit" : "dim")) }] },
    { say: "Then answers come out one per tick: the gap between two answers is constant, however big the data.", rows: [{ label: "time", cells: cells(t, (v, i) => (i < 3 ? "visit" : "on")) }] },
    { say: "So the first answer arrives fast and the total time is just preparation + one tick per answer.", rows: [{ label: "time", cells: cells(t, (v, i) => (i < 3 ? "visit" : "on")) }] },
  ] };
}
function streamingScene() {
  const s = [3, 7, 7, 3, 3, 1, 3];
  const frames = [{ say: "A stream: items arrive one at a time and you can't store them all.", rows: [{ label: "stream", cells: cells(s, "dim") }] }];
  let cand = null, cnt = 0;
  s.forEach((x, i) => {
    let why;
    if (cnt === 0) { cand = x; cnt = 1; why = `count was 0, so ${x} becomes the candidate`; } else if (x === cand) { cnt++; why = `${x} matches the candidate: count up`; } else { cnt--; why = `${x} differs: count down`; }
    frames.push({ say: `Item ${i + 1}: ${why}. Memory: candidate ${cand}, count ${cnt}.`, rows: [{ label: "stream", cells: cells(s, (v, j) => (j < i ? "on" : j === i ? "hot" : "dim")) }, { label: "memory", cells: [{ v: cand, s: "visit" }, { v: cnt, s: "visit" }] }] });
  });
  frames.push({ say: `One pass, two numbers of memory: if any item fills more than half the stream, it's the candidate, ${cand} here (Boyer–Moore majority vote).`, rows: [{ label: "stream", cells: cells(s, v => (v === cand ? "hot" : "on")) }, { label: "memory", cells: [{ v: cand, s: "hot" }, { v: cnt, s: "visit" }] }] });
  return { kind: "array", title: "Streaming", frames };
}
function roundingScene() {
  const x = [0.9, 0.5, 0.2, 0.7, 0.4], coin = [0.31, 0.62, 0.15, 0.45, 0.83], r = x.map((v, i) => (coin[i] < v ? 1 : 0));
  return { kind: "array", title: "Randomized rounding", frames: [
    { say: "An integer problem (each choice 0 or 1) is relaxed: solve it with fractions instead.", rows: [{ label: "choose?", cells: cells(["?", "?", "?", "?", "?"], "dim") }] },
    { say: "The relaxation says how much of each choice to take.", rows: [{ label: "fraction", cells: cells(x, "visit") }] },
    { say: "Round: take choice i with probability equal to its fraction (flip a biased coin).", rows: [{ label: "fraction", cells: cells(x, "visit") }, { label: "coin", cells: cells(coin, (v, i) => (v < x[i] ? "on" : "dim")) }] },
    { say: "A whole-number answer whose expected cost equals the relaxation's; concentration bounds show it rarely strays far.", rows: [{ label: "fraction", cells: cells(x, "visit") }, { label: "rounded", cells: cells(r, v => (v ? "on" : "dim")) }] },
  ] };
}

// ─── plots ────────────────────────────────────────────────────────
const sample = (f, a, b, n = 80) => Array.from({ length: n + 1 }, (_, i) => { const x = a + (b - a) * i / n; return [x, f(x)]; });
const gauss = (m, s) => x => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
function pscene(title, axes, frames) { return Object.assign({ kind: "plot", title }, axes, { frames }); }

function concentrationScene() {
  const c = n => ({ pts: sample(gauss(0.5, 0.5 / Math.sqrt(n)), 0, 1, 160), s: n === 64 ? "on" : n === 16 ? "visit" : "base", label: "n = " + n, lx: n === 64 ? 0.6 : n === 16 ? 0.68 : 0.82 });
  const ax = { x: [0, 1], y: [0, 6.6], xl: "average of n coin flips", yl: "how likely", xt: [0, 0.5, 1], yt: [0, 2, 4, 6] };
  return pscene("Concentration", ax, [
    { say: "Average n fair coin flips (heads = 1). With n = 4 the average wanders widely.", curves: [c(4)] },
    { say: "With n = 16 it sticks closer to 0.5…", curves: [c(4), c(16)] },
    { say: "…and with n = 64 closer still. Hoeffding: P(|average − 0.5| ≥ t) ≤ 2·e^(−2nt²).", curves: [c(4), c(16), c(64)], vlines: [{ v: 0.65, label: "t = 0.15" }] },
  ]);
}
function pacScene() {
  const eps = m => Math.min(1, (Math.log(20) + Math.log(1 / 0.05)) / m);
  const ax = { x: [0, 200], y: [0, 0.5], xl: "training examples m", yl: "error bound ε" };
  return pscene("PAC learning", ax, [
    { say: "Learn a rule from m random labelled examples. How wrong can the learned rule be?", curves: [] },
    { say: "For a finite class of rules, with probability 1 − δ the error is at most ε ≈ (ln|H| + ln 1/δ) / m.", curves: [{ pts: sample(eps, 15, 200), s: "on" }] },
    { say: "Probably (1 − δ) approximately (ε) correct: to halve the error, double the data.", curves: [{ pts: sample(eps, 15, 200), s: "on" }], hlines: [{ v: 0.06, label: "ε = 0.06" }], vlines: [{ v: 100, label: "m = 100" }] },
  ]);
}
function halfspaceScene() {
  const pos = [[0.7, 0.8], [0.8, 0.6], [0.6, 0.9], [0.9, 0.85], [0.75, 0.45]], neg = [[0.2, 0.3], [0.3, 0.15], [0.15, 0.6], [0.4, 0.35], [0.35, 0.55]];
  const ax = { x: [0, 1], y: [0, 1], xl: "feature 1", yl: "feature 2" };
  const dots = pos.map(([x, y]) => ({ x, y, s: "on" })).concat(neg.map(([x, y]) => ({ x, y, s: "base" })));
  return pscene("Halfspaces", ax, [
    { say: "Two kinds of points.", dots },
    { say: "A halfspace is everything on one side of a line (a hyperplane in more dimensions): w·x ≥ b.", dots, curves: [{ pts: [[0.25, 1], [0.85, 0]], s: "hot" }] },
    { say: "Learning a halfspace is easy when one fits perfectly; with noise, finding the best approximate one is hard, so we settle for approximations.", dots: dots.concat([{ x: 0.55, y: 0.25, s: "on" }]), curves: [{ pts: [[0.25, 1], [0.85, 0]], s: "hot" }] },
  ]);
}
function paramScene() {
  const ax = { x: [0, 40], y: [0, 40], xl: "input size n", yl: "log₂ time" };
  return pscene("Parameterized complexity", ax, [
    { say: "Brute force on an NP-hard problem: time 2ⁿ. On a log scale, a steep line.", curves: [{ pts: sample(n => n, 0, 40), s: "hot", label: "2ⁿ" }] },
    { say: "If the hardness lives in a small parameter k (say k = 10), an FPT algorithm runs in f(k)·n: 2¹⁰·n here.", curves: [{ pts: sample(n => n, 0, 40), s: "hot", label: "2ⁿ" }, { pts: sample(n => 10 + Math.log2(Math.max(1, n)), 1, 40), s: "on", label: "2ᵏ·n" }] },
    { say: "For big inputs with small k, that's the difference between never and seconds.", curves: [{ pts: sample(n => n, 0, 40), s: "hot", label: "2ⁿ" }, { pts: sample(n => 10 + Math.log2(Math.max(1, n)), 1, 40), s: "on", label: "2ᵏ·n" }] },
  ]);
}
function stateSpaceScene() {
  const pts = []; let x = [1, 0];
  for (let k = 0; k < 40; k++) { pts.push(x.slice()); x = [0.95 * (x[0] * Math.cos(0.3) - x[1] * Math.sin(0.3)), 0.95 * (x[0] * Math.sin(0.3) + x[1] * Math.cos(0.3))]; }
  const ax = { x: [-1.1, 1.1], y: [-1.1, 1.1], xl: "state x₁ (position)", yl: "state x₂ (velocity)", xt: [-1, 0, 1], yt: [-1, 0, 1] };
  return pscene("State space", ax, [
    { say: "The state is a vector, here (position, velocity): one point in the plane.", dots: [{ x: 1, y: 0, s: "hot" }] },
    { say: "Each step, xₖ₊₁ = A·xₖ + B·uₖ moves the point. With no input, A alone traces this path.", dots: pts.slice(0, 12).map(([a, b]) => ({ x: a, y: b, s: "on" })) },
    { say: "We only see an output yₖ = C·xₖ. Control, estimation and stability are all questions about this picture.", curves: [{ pts, s: "on" }], dots: [{ x: pts[39][0], y: pts[39][1], s: "hot" }] },
  ]);
}
function kalmanScene() {
  const truth = 5, R = 1.6, noise = [1.2, -1.5, 0.4, 2.0, -0.6, -1.1, 0.9, -0.3, 1.4, -0.9, 0.2, -1.6, 0.7, 1.1, -0.4];
  let est = 0, P = 10; const ests = [], hi = [], lo = [];
  noise.forEach((n, i) => { const z = truth + n, K = P / (P + R * R); est = est + K * (z - est); P = (1 - K) * P; ests.push([i + 1, est]); hi.push([i + 1, est + Math.sqrt(P)]); lo.push([i + 1, est - Math.sqrt(P)]); });
  const meas = noise.map((n, i) => ({ x: i + 1, y: truth + n, s: "base" }));
  const ax = { x: [0, 16], y: [0, 9], xl: "time step", yl: "estimate of position", yt: [0, 5] };
  return pscene("Kalman filter", ax, [
    { say: "A noisy sensor measures something steady (true value 5). Each dot is one reading.", dots: meas, hlines: [{ v: truth, label: "true" }] },
    { say: "Predict, then update: blend each new reading in with weight K = P / (P + R), so trust shifts towards the estimate as it improves.", dots: meas, curves: [{ pts: ests.slice(0, 5), s: "on" }], bands: [{ hi: hi.slice(0, 5), lo: lo.slice(0, 5) }] },
    { say: "The estimate settles near 5 and its uncertainty band narrows: the best a linear filter can do with Gaussian noise.", dots: meas, curves: [{ pts: ests, s: "on" }], bands: [{ hi, lo }], hlines: [{ v: truth, label: "true" }] },
  ]);
}
function lyapunovScene() {
  const pts = []; let x = 1, v = 0;
  for (let k = 0; k < 120; k++) { pts.push([x, v]); const a = -x - 0.35 * v; v += 0.1 * a; x += 0.1 * v; }
  const ax = { x: [-1.1, 1.1], y: [-1.1, 1.1], xl: "position", yl: "velocity", xt: [-1, 0, 1], yt: [-1, 0, 1] };
  return pscene("Lyapunov stability", ax, [
    { say: "A damped spring, started at position 1.", dots: [{ x: 1, y: 0, s: "hot" }] },
    { say: "It spirals into the rest point (0, 0).", curves: [{ pts, s: "on" }] },
    { say: "Proof without solving: energy V = x² + v² only ever goes down. A function like that is a Lyapunov function, and it proves stability.", curves: [{ pts, s: "on" }, ...[0.8, 0.5, 0.25].map(r => ({ pts: sample(t => r, 0, 2 * Math.PI, 60).map(([t]) => [r * Math.cos(t), r * Math.sin(t)]), s: "dim" }))] },
  ]);
}
function fusionScene() {
  const a = gauss(10, 2), b = gauss(12, 1), m = (1 * 10 + 4 * 12) / 5, s = Math.sqrt(4 / 5);
  const ax = { x: [4, 18], y: [0, 0.48], xl: "distance (m)", yl: "belief", xt: [4, 8, 10, 12, 16], yt: [] };
  return pscene("Sensor fusion", ax, [
    { say: "Sensor 1 says 10 m, give or take 2.", curves: [{ pts: sample(a, 4, 18, 120), s: "base", label: "sensor 1" }] },
    { say: "Sensor 2 says 12 m, give or take 1: more precise.", curves: [{ pts: sample(a, 4, 18, 120), s: "base", label: "sensor 1" }, { pts: sample(b, 4, 18, 120), s: "visit", label: "sensor 2" }] },
    { say: `Fuse by weighting each by its precision: ${m.toFixed(1)} m, give or take ${s.toFixed(2)}. Sharper than either sensor alone.`, curves: [{ pts: sample(a, 4, 18, 120), s: "dim" }, { pts: sample(b, 4, 18, 120), s: "dim" }, { pts: sample(gauss(m, s), 4, 18, 120), s: "on", label: "fused" }] },
  ]);
}
function observabilityScene() {
  const y1 = sample(t => Math.exp(-0.2 * t) * Math.cos(t), 0, 12), y2 = sample(t => 0.6 * Math.exp(-0.2 * t) * Math.cos(t + 0.8), 0, 12);
  const ax = { x: [0, 12], y: [-1.1, 1.1], xl: "time", yl: "measured output y", yt: [-1, 0, 1] };
  return pscene("Observability", ax, [
    { say: "You can't see the state, only an output y = C·x over time.", curves: [{ pts: y1, s: "on" }] },
    { say: "Two different starting states give two different output histories…", curves: [{ pts: y1, s: "on" }, { pts: y2, s: "visit" }] },
    { say: "…so the outputs pin the state down: observable. If some state change never showed in y, no filter could ever recover it.", curves: [{ pts: y1, s: "on" }, { pts: y2, s: "visit" }] },
  ]);
}
function boundaryLayerScene() {
  const prof = sample(eta => eta, 0, 1, 40).map(([eta]) => [Math.min(1, 2 * eta - 2 * eta ** 3 + eta ** 4), eta]);
  const ax = { x: [0, 1.2], y: [0, 1.3], xl: "speed u / U", yl: "height above the wall", xt: [0, 0.5, 1], yt: [0, 0.5, 1] };
  return pscene("Boundary layer", ax, [
    { say: "Air flows over a flat plate at speed U. Right at the wall it can't slip: speed 0.", dots: [{ x: 0, y: 0, s: "hot" }] },
    { say: "Speed rises through a thin layer, the boundary layer, until it matches the outside flow.", curves: [{ pts: prof.concat([[1, 1.3]]), s: "on" }], hlines: [{ v: 1, label: "δ" }] },
    { say: "Inside it, viscosity matters; outside, it doesn't. It thickens downstream as δ ≈ 5x/√Re (laminar).", curves: [{ pts: prof.concat([[1, 1.3]]), s: "on" }], hlines: [{ v: 1, label: "δ" }], vlines: [{ v: 1, label: "U" }] },
  ]);
}
function compressibleScene() {
  const rho = M => Math.pow(1 + 0.2 * M * M, -2.5);
  const ax = { x: [0, 2], y: [0, 1.05], xl: "Mach number M", yl: "density ρ / ρ₀", yt: [0, 0.5, 1] };
  return pscene("Compressible flow", ax, [
    { say: "As flow speeds up, its density drops: ρ/ρ₀ = (1 + 0.2 M²)^−2.5 for air.", curves: [{ pts: sample(rho, 0, 2), s: "on" }] },
    { say: "Below Mach 0.3 density changes by under 5%: treat air as incompressible.", curves: [{ pts: sample(rho, 0, 2), s: "on" }], vlines: [{ v: 0.3, label: "M 0.3" }] },
    { say: "Near Mach 1 and beyond, compressibility dominates: shocks, choking, and very different design rules.", curves: [{ pts: sample(rho, 0, 2), s: "on" }], vlines: [{ v: 0.3, label: "M 0.3" }, { v: 1, label: "M 1" }] },
  ]);
}
function reynoldsScene() {
  const lam = sample(l => Math.log10(64 / Math.pow(10, l)), 2, Math.log10(2300)), tur = sample(l => Math.log10(0.316 * Math.pow(10, l * -0.25)), Math.log10(4000), 5);
  const ax = { x: [2, 5], y: [-2, -0.2], xl: "log₁₀ Re", yl: "log₁₀ friction factor", xt: [2, 3, 4, 5], yt: [-2, -1] };
  return pscene("Reynolds number", ax, [
    { say: "Re = ρVL/μ compares inertia with viscosity. Low Re: smooth, layered (laminar) flow.", curves: [{ pts: lam, s: "on", label: "laminar 64/Re" }] },
    { say: "In a pipe, from about Re 2300 the flow turns turbulent: chaotic eddies.", curves: [{ pts: lam, s: "on", label: "laminar 64/Re" }, { pts: tur, s: "hot", label: "turbulent" }], vlines: [{ v: Math.log10(2300), label: "2300" }] },
    { say: "Same Re means the same flow pattern, so a small model in a wind tunnel predicts the full-size aircraft.", curves: [{ pts: lam, s: "on" }, { pts: tur, s: "hot" }], vlines: [{ v: Math.log10(2300), label: "2300" }] },
  ]);
}
function liftScene() {
  const cl = a => (a <= 14 ? 2 * Math.PI * a * Math.PI / 180 * 0.95 : 1.46 - 0.09 * (a - 14) ** 1.3);
  const ax = { x: [0, 22], y: [0, 1.7], xl: "angle of attack α (degrees)", yl: "lift coefficient C_L", xt: [0, 7, 14, 21], yt: [0, 0.5, 1, 1.5] };
  return pscene("Lift coefficient", ax, [
    { say: "Tilt a wing up (angle of attack) and it lifts more: about 2π per radian, a straight line.", curves: [{ pts: sample(cl, 0, 12), s: "on" }] },
    { say: "Past roughly 14° the flow separates from the top surface and lift collapses: stall.", curves: [{ pts: sample(cl, 0, 22, 120), s: "on" }], vlines: [{ v: 14, label: "stall" }] },
    { say: "Lift = ½ ρ V² S C_L: C_L packs the wing's shape and angle into one number.", curves: [{ pts: sample(cl, 0, 22, 120), s: "on" }], vlines: [{ v: 14, label: "stall" }] },
  ]);
}
function dragPolarScene() {
  const CD0 = 0.02, K = 0.05, pts = sample(cl => cl, -0.2, 1.6).map(([cl]) => [CD0 + K * cl * cl, cl]);
  const clS = Math.sqrt(CD0 / K);
  const ax = { x: [0, 0.16], y: [-0.2, 1.6], xl: "drag coefficient C_D", yl: "lift coefficient C_L", yt: [0, 0.5, 1, 1.5] };
  return pscene("Drag polar", ax, [
    { say: "Drag has a fixed part (skin friction) and a part that grows with lift: C_D = C_D0 + K·C_L².", curves: [{ pts, s: "on" }] },
    { say: `The tangent from the origin touches at C_L = √(C_D0/K) = ${clS.toFixed(2)}: the best lift for the drag.`, curves: [{ pts, s: "on" }, { pts: [[0, 0], [0.1, 0.1 * clS / (2 * CD0)]], s: "dim" }], dots: [{ x: 2 * CD0, y: clS, s: "hot" }] },
    { say: `There L/D peaks at ${(clS / (2 * CD0)).toFixed(1)}: fly there for the longest glide and best range.`, curves: [{ pts, s: "on" }, { pts: [[0, 0], [0.1, 0.1 * clS / (2 * CD0)]], s: "dim" }], dots: [{ x: 2 * CD0, y: clS, s: "hot" }] },
  ]);
}

// ─── robotics, control, vision and learning ───────────────────────
// Seeded randomness, so every learner sees the same (real) run.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function randn(R) { const u = Math.max(1e-9, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const ellipsePts = (cx, cy, a, b, rot = 0, n = 48) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n * 2 * Math.PI, x = a * Math.cos(t), y = b * Math.sin(t);
  return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
});
const BOX = { frame: "box", x: [0, 10], y: [0, 5.8] }; // 2-D scenes drawn to scale
const seg = (a, b, s = "grey", w = 1.6) => ({ pts: [a, b], s, w });

function histogramScene({ title = "Histogram filter", bayes = false } = {}) {
  const N = 10, doors = new Set([1, 3, 7]), start = 1, shift = 2;
  const sense = b => { const nb = b.map((p, i) => p * (doors.has(i) ? 0.8 : 0.1)), s = nb.reduce((a, c) => a + c, 0); return nb.map(p => p / s); };
  const move = b => b.map((_, i) => 0.8 * b[(i - shift + N) % N] + 0.1 * b[(i - shift - 1 + N) % N] + 0.1 * b[(i - shift + 1 + N) % N]);
  const world = { label: "corridor", cells: Array.from({ length: N }, (_, i) => ({ v: doors.has(i) ? "door" : "", s: doors.has(i) ? "visit" : "dim" })) };
  const robot = at => ({ label: "robot", cells: Array.from({ length: N }, (_, i) => ({ v: i === at ? "R" : "", s: i === at ? "ink" : "blank" })) });
  const belief = b => { const m = Math.max(...b); return { label: "belief %", cells: b.map(p => ({ v: Math.round(p * 100), a: p / m * 0.9 })) }; };
  let b = Array(N).fill(1 / N); const fr = [];
  fr.push({ say: "A robot in a ring-shaped corridor with 3 doors (R marks where it really is). It has no idea, so its belief is spread evenly: 10% per cell.", rows: [world, robot(start), belief(b)] });
  b = sense(b);
  fr.push({ say: "It senses a door. Update: multiply each cell by how likely that reading is there (0.8 at a door, 0.1 elsewhere), then rescale to 100%.", rows: [world, robot(start), belief(b)] });
  b = move(b);
  fr.push({ say: `It drives ${shift} cells right. Predict: shift the belief ${shift} cells and blur it a little, because motion is noisy.`, rows: [world, robot(start + shift), belief(b)] });
  b = sense(b);
  const best = b.indexOf(Math.max(...b));
  fr.push({ say: `It senses a door again. Only one place fits both readings: belief peaks at cell ${best + 1} (${Math.round(b[best] * 100)}%), where the robot really is.`, rows: [world, robot(start + shift), belief(b)] });
  fr.push({ say: bayes ? "Predict with the motion model, update with the sensor model, repeat: the recursive Bayes filter. Kalman and particle filters are versions of it." : "A histogram filter keeps one probability per cell and repeats these two steps. Finer cells give better answers, for more work.", rows: [world, robot(start + shift), belief(b)] });
  return { kind: "array", title, frames: fr };
}

function particleScene({ mcl = false } = {}) {
  const R = rng(7), doors = [1.5, 3.5, 7.5], N = 60;
  const lik = x => 0.15 + 0.85 * Math.exp(-(Math.min(...doors.map(d => Math.abs(x - d))) ** 2) / (2 * 0.3 * 0.3));
  const resample = ps => {
    const w = ps.map(p => lik(p.x)), tot = w.reduce((a, c) => a + c, 0), step = tot / N, out = [];
    let target = R() * step, c = w[0], i = 0;
    for (let k = 0; k < N; k++) { while (c < target && i < ps.length - 1) { i++; c += w[i]; } out.push({ x: ps[i].x + randn(R) * 0.08, y: 0.1 + R() * 0.72 }); target += step; }
    return out;
  };
  const dots = (ps, weighted, truth) => ps.filter(p => p.x >= 0 && p.x <= 10).map(p => { const w = lik(p.x); return { x: p.x, y: p.y, s: weighted && w > 0.5 ? "on" : "base", r: weighted ? 1.8 + 4.5 * w : 3 }; })
    .concat([{ x: truth, y: 0.93, s: "hot", r: 6.5 }]);
  const ax = { x: [0, 10], y: [0, 1], xl: "position along the corridor (m)", yl: "", yt: [], xt: [0, 5, 10] };
  const dl = doors.map(d => ({ v: d, label: "door" }));
  let P = Array.from({ length: N }, () => ({ x: R() * 10, y: 0.1 + R() * 0.72 }));
  const fr = [{ say: `${N} particles: ${N} guesses of where the robot might be, spread along the corridor. The big dot at the top is where it really is.`, dots: dots(P, false, 1.5), vlines: dl }];
  fr.push({ say: "It senses a door. Each particle is weighted by how well it explains that reading (bigger = more likely).", dots: dots(P, true, 1.5), vlines: dl });
  P = resample(P);
  fr.push({ say: "Resample: draw new particles in proportion to their weights. They gather at the three doors.", dots: dots(P, false, 1.5), vlines: dl });
  P = P.map(p => ({ x: p.x + 2 + randn(R) * 0.15, y: p.y }));
  fr.push({ say: "The robot drives 2 m. Every particle moves 2 m too, plus a little random noise.", dots: dots(P, false, 3.5), vlines: dl });
  fr.push({ say: "Another door: only the cluster that started at the first door is on a door now.", dots: dots(P, true, 3.5), vlines: dl });
  P = resample(P.filter(p => p.x <= 10));
  fr.push({ say: mcl ? "Resample: the cloud has found the robot. Monte Carlo localisation is this filter on a real map, with each particle a full pose (x, y, heading)." : "Resample again: the cloud has found the robot. Particles can follow any shape of belief, not just one bell curve.", dots: dots(P, false, 3.5), vlines: dl });
  return pscene(mcl ? "Monte Carlo localisation" : "Particle filter", ax, fr);
}

function ekfLocScene({ slam = false } = {}) {
  const q = [0.03, 0.05], rm = 0.02, xs = [1.2, 3.4, 5.6, 7.8], yRob = 2.0, L = [slam ? 5.6 : 7.8, 4.4];
  const ell = (x, y, Px, Py, s) => ({ pts: ellipsePts(x, y, 2 * Math.sqrt(Px), 2 * Math.sqrt(Py)), s, fill: 0.12, w: 2 });
  const fr = [];
  if (!slam) {
    let P = [0.01, 0.01]; const hist = [];
    xs.forEach((x, k) => { if (k) P = [P[0] + q[0], P[1] + q[1]]; hist.push([x, P.slice()]); });
    const robots = n => hist.slice(0, n).map(([x, Pk], i) => ell(x, yRob, Pk[0], Pk[1], i === n - 1 ? "on" : "dim"));
    const path = n => [{ pts: hist.slice(0, n).map(([x]) => [x, yRob]), s: "grey", w: 2, dash: true }];
    fr.push({ say: "The robot knows where it starts: a small uncertainty ellipse (2σ).", curves: robots(1), dots: [{ x: L[0], y: L[1], s: "ink", r: 6, label: "landmark" }] });
    fr.push({ say: "Predict: driving on wheel odometry alone, each step adds noise, so the ellipse grows (P ← F P Fᵀ + Q).", curves: path(3).concat(robots(3)), dots: [{ x: L[0], y: L[1], s: "ink", r: 6, label: "landmark" }] });
    fr.push({ say: "Still growing. Without an outside reference the error can only get worse.", curves: path(4).concat(robots(4)), dots: [{ x: L[0], y: L[1], s: "ink", r: 6, label: "landmark" }] });
    const [x3, P3] = hist[3], Pu = P3.map(p => 1 / (1 / p + 1 / rm));
    fr.push({ say: `Update: it measures the landmark, whose position is known. The Kalman gain pulls the estimate in and the ellipse shrinks (σx ${Math.sqrt(P3[0]).toFixed(2)} → ${Math.sqrt(Pu[0]).toFixed(2)} m).`, curves: path(4).concat(robots(3), [ell(x3, yRob, Pu[0], Pu[1], "on")], [seg([x3, yRob], L, "hot", 2)]), dots: [{ x: L[0], y: L[1], s: "ink", r: 6, label: "landmark" }] });
    return Object.assign({ kind: "plot", title: "EKF localisation", frames: fr }, BOX);
  }
  // EKF-SLAM, one axis at a time: state [robot, landmark] with their cross-covariance
  let Prr = 0.01, Pll = 0, Prl = 0;
  const step = () => { Prr += q[1]; };
  const seen = []; let k = 0;
  const snap = () => seen.push({ x: xs[k], Prr, Pll, Prl });
  snap(); k = 1; step(); Pll = Prr + rm; Prl = Prr; snap(); // first sighting at xs[1]
  k = 2; step(); snap(); k = 3; step(); snap();
  const S = Prr + Pll - 2 * Prl + rm, Kr = (Prl - Prr) / S, Kl = (Pll - Prl) / S; // z = l − r
  const nPrr = Prr - Kr * Kr * S, nPll = Pll - Kl * Kl * S;
  const rob = (i, s) => ell(seen[i].x, yRob, seen[i].Prr, seen[i].Prr, s);
  const lm = (P, s) => ell(L[0], L[1], P, P, s);
  const track = n => [{ pts: seen.slice(0, n).map(o => [o.x, yRob]), s: "grey", w: 2, dash: true }];
  fr.push({ say: "SLAM: the robot builds the map while it localises in it. At the start it knows its own pose well.", curves: [rob(0, "on")] });
  fr.push({ say: "It spots a new landmark. Its position is only as good as the robot's own, plus sensor noise: a bigger ellipse.", curves: track(2).concat([rob(0, "dim"), rob(1, "on"), lm(seen[1].Pll, "visit"), seg([xs[1], yRob], L, "hot", 2)]) });
  fr.push({ say: "Driving on, the robot's uncertainty grows. The landmark's doesn't: it isn't moving.", curves: track(4).concat([rob(0, "dim"), rob(1, "dim"), rob(2, "dim"), rob(3, "on"), lm(seen[1].Pll, "visit")]) });
  fr.push({ say: `It sees the landmark again and its own ellipse shrinks (σ ${Math.sqrt(Prr).toFixed(2)} → ${Math.sqrt(nPrr).toFixed(2)} m), but only as far as the landmark's uncertainty allows: map and pose are estimated together, with correlated errors.`, curves: track(4).concat([rob(0, "dim"), rob(1, "dim"), rob(2, "dim"), ell(xs[3], yRob, nPrr, nPrr, "on"), lm(nPll, "visit"), seg([xs[3], yRob], L, "hot", 2)]) });
  return Object.assign({ kind: "plot", title: "EKF-SLAM", frames: fr }, BOX);
}

function ekfUkfScene() {
  const R = rng(5), sth = 0.35, sr = 0.02;
  const f = (r, th) => [r * Math.cos(th), r * Math.sin(th)];
  const cloud = Array.from({ length: 260 }, () => f(1 + sr * randn(R), Math.PI / 2 + sth * randn(R))).map(([x, y]) => ({ x, y, s: "grey", r: 1.6 }));
  const trueY = Math.exp(-sth * sth / 2);
  // unscented transform, n = 2, κ = 1 (n + κ = 3)
  const c = Math.sqrt(3), sig = [[1, Math.PI / 2], [1 + c * sr, Math.PI / 2], [1 - c * sr, Math.PI / 2], [1, Math.PI / 2 + c * sth], [1, Math.PI / 2 - c * sth]];
  const wts = [1 / 3, 1 / 6, 1 / 6, 1 / 6, 1 / 6], Ys = sig.map(([r, th]) => f(r, th));
  const mx = Ys.reduce((a, p, i) => a + wts[i] * p[0], 0), my = Ys.reduce((a, p, i) => a + wts[i] * p[1], 0);
  const vx = Ys.reduce((a, p, i) => a + wts[i] * (p[0] - mx) ** 2, 0), vy = Ys.reduce((a, p, i) => a + wts[i] * (p[1] - my) ** 2, 0);
  const ax = { x: [-0.95, 0.95], y: [0.38, 1.48], xl: "x", yl: "y", xt: [-0.8, 0, 0.8], yt: [0.5, 1] };
  const truth = { x: 0, y: trueY, s: "ink", r: 5 }, tTrue = { x: -0.06, y: trueY - 0.07, t: "true mean", anchor: "end", size: 11.5 };
  const ekf = { pts: ellipsePts(0, 1, 2 * sth, 2 * sr), s: "hot", w: 2 }, ekfDot = { x: 0, y: 1, s: "hot", r: 5 }, tEkf = { x: 0.07, y: 1.07, t: "EKF mean", anchor: "start", size: 11.5, s: "hot" };
  return pscene("EKF vs UKF", ax, [
    { say: "A range-and-bearing sensor: distance 1 m (precise), angle 90° ± 20°. In x–y the possible positions form a curved banana.", dots: cloud },
    { say: `EKF: linearise at the mean and push the Gaussian through the straight-line version. Its mean sits at y = 1, above the real mean (y = ${trueY.toFixed(2)}).`, dots: cloud.concat([truth, ekfDot]), curves: [ekf], texts: [tTrue, tEkf] },
    { say: `UKF: push 5 sigma points through the true curve and re-average them. Mean y = ${my.toFixed(2)}, right on target, with no derivatives needed.`, dots: cloud.concat([truth, ekfDot], Ys.map(([x, y]) => ({ x, y, s: "on", r: 4.5 })), [{ x: mx, y: my, s: "on", r: 5 }]), texts: [tTrue, tEkf, { x: 0.07, y: my - 0.07, t: "UKF mean", anchor: "start", size: 11.5, s: "on" }], curves: [ekf, { pts: ellipsePts(mx, my, 2 * Math.sqrt(vx), 2 * Math.sqrt(vy)), s: "on", w: 2 }] },
  ]);
}

function lqrScene() {
  const sim = r => { const K1 = Math.sqrt(1 / r), K2 = Math.sqrt(2 * K1); let x = 1, v = 0; const pts = [[0, 1]]; for (let i = 1; i <= 800; i++) { const u = -K1 * x - K2 * v; v += u * 0.01; x += v * 0.01; if (i % 8 === 0) pts.push([i * 0.01, x]); } return pts; };
  const ax = { x: [0, 8], y: [-0.2, 1.05], xl: "time (s)", yl: "position x", xt: [0, 4, 8], yt: [0, 1] };
  const c1 = { pts: sim(1), s: "on", label: "r = 1", lx: 2.4 }, c0 = { pts: sim(0.05), s: "hot", label: "r = 0.05", lx: 0.95 }, c2 = { pts: sim(20), s: "visit", label: "r = 20", lx: 5.2 };
  return pscene("LQR", ax, [
    { say: "Bring a cart (x″ = u) back from x = 1 to 0. LQR picks the feedback u = −K·state that minimises ∫ (x² + r·u²) dt.", curves: [c1], hlines: [{ v: 0 }] },
    { say: "Make control cheap (small r) and it corrects hard and fast.", curves: [c1, c0], hlines: [{ v: 0 }] },
    { say: "Make control expensive (large r) and it eases back gently. K comes from solving a Riccati equation.", curves: [c1, c0, c2], hlines: [{ v: 0 }] },
  ]);
}

function pidScene() {
  const sim = (kp, ki, kd) => {
    let y = 0, v = 0, I = 0, prev = 1; const dt = 0.005, pts = [[0, 0]];
    for (let i = 1; i <= 3000; i++) { const e = 1 - y; I += e * dt; const D = (e - prev) / dt; prev = e; const u = kp * e + ki * I + kd * D; v += (u - 0.8 * v - y) * dt; y += v * dt; if (i % 20 === 0) pts.push([i * dt, y]); }
    return pts;
  };
  const ax = { x: [0, 15], y: [0, 1.6], xl: "time (s)", yl: "output", xt: [0, 5, 10, 15], yt: [0, 1] };
  const P = { pts: sim(3, 0, 0), s: "visit", label: "P", lx: 11 }, PI = { pts: sim(3, 1.5, 0), s: "hot", label: "PI", lx: 4.3 }, PID = { pts: sim(3, 1.5, 1.2), s: "on", label: "PID", lx: 8 };
  const tgt = [{ v: 1, label: "target" }];
  return pscene("PID control", ax, [
    { say: "Hold a springy, lightly damped system at 1. P control pushes in proportion to the error (u = Kp·e): it settles at 0.75, short of the target.", curves: [P], hlines: tgt },
    { say: "Add I, the error summed over time: any lasting error builds up push until it's gone. Now it reaches 1, but swings more.", curves: [P, PI], hlines: tgt },
    { say: "Add D, the error's rate of change: it brakes before it overshoots. Kp = 3, Ki = 1.5, Kd = 1.2 here.", curves: [P, PI, PID], hlines: tgt },
  ]);
}

function linearizationScene() {
  const th0 = 0.6, lin = x => Math.sin(th0) + Math.cos(th0) * (x - th0);
  let lo = th0, hi = th0;
  while (lo > 0 && Math.abs(Math.sin(lo) - lin(lo)) < 0.05) lo -= 0.01;
  while (hi < 3.1 && Math.abs(Math.sin(hi) - lin(hi)) < 0.05) hi += 0.01;
  const ax = { x: [0, 3.1], y: [-0.3, 1.5], xl: "angle θ (rad)", yl: "f(θ) = sin θ", xt: [0, 1, 2, 3], yt: [0, 1] };
  const curve = { pts: sample(Math.sin, 0, 3.1), s: "ink", label: "sin θ", lx: 2.5 }, tan = { pts: sample(lin, 0, 3.1), s: "on", label: "tangent", lx: 1.7 };
  return pscene("Linearisation", ax, [
    { say: "A nonlinear model: a pendulum's restoring torque goes as sin θ.", curves: [curve] },
    { say: "Linearise at an operating point θ₀ = 0.6: keep only the tangent line, f(θ₀) + f′(θ₀)(θ − θ₀).", curves: [curve, tan], dots: [{ x: th0, y: Math.sin(th0), s: "hot", label: "θ₀" }] },
    { say: `Near θ₀ the line is almost exact (error under 0.05 from ${lo.toFixed(2)} to ${hi.toFixed(2)} rad); far away it drifts. Linear tools (LQR, the EKF) live in that window.`, curves: [curve, tan], dots: [{ x: th0, y: Math.sin(th0), s: "hot" }], bands: [{ hi: [[lo, 1.5], [hi, 1.5]], lo: [[lo, -0.3], [hi, -0.3]], a: 0.1 }], vlines: [{ v: lo }, { v: hi }] },
  ]);
}

function integrationScene() {
  const h = 0.15, n = 40;
  let x = 1, v = 0; const eu = [[x, v]];
  for (let i = 0; i < n; i++) { [x, v] = [x + h * v, v - h * x]; eu.push([x, v]); }
  const F = ([a, b]) => [b, -a], add = (p, q, s) => [p[0] + s * q[0], p[1] + s * q[1]];
  let p = [1, 0]; const rk = [p];
  for (let i = 0; i < n; i++) { const k1 = F(p), k2 = F(add(p, k1, h / 2)), k3 = F(add(p, k2, h / 2)), k4 = F(add(p, k3, h)); p = [p[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])]; rk.push(p); }
  const ax = { x: [-2.9, 2.9], y: [-1.7, 1.7], xl: "position x", yl: "velocity v", xt: [-2, 0, 2], yt: [-1, 0, 1] };
  const exact = { pts: ellipsePts(0, 0, 1, 1, 0, 80), s: "dim", w: 2, dash: true };
  return pscene("Numerical integration", ax, [
    { say: "A spring: x′ = v, v′ = −x. The exact motion circles round forever (dashed).", curves: [exact], dots: [{ x: 1, y: 0, s: "ink" }] },
    { say: `Euler's method steps along the current slope (step h = ${h}). Each step lands slightly outside the circle, so it spirals out: energy appears from nowhere.`, curves: [exact, { pts: eu, s: "hot", label: "Euler", lx: -1.2 }], dots: eu.map(([a, b]) => ({ x: a, y: b, s: "hot", r: 2 })) },
    { say: `RK4 samples the slope four times per step. Same step size, and after ${n} steps it is still on the circle (radius ${Math.hypot(p[0], p[1]).toFixed(4)}).`, curves: [exact, { pts: eu, s: "dim" }, { pts: rk, s: "on", label: "RK4", lx: 0.4 }], dots: rk.map(([a, b]) => ({ x: a, y: b, s: "on", r: 2 })) },
  ]);
}

function odeScene() {
  const ax = { x: [0, 8], y: [-0.1, 1.6], xl: "time t", yl: "y", xt: [0, 4, 8], yt: [0, 1] };
  const sx = 334 / 8, sy = 194 / 1.7, field = [];
  for (let t = 0.4; t < 8; t += 0.8) for (let y = 0; y <= 1.5; y += 0.25) {
    const ang = Math.atan(y * (1 - y) * sy / sx), dx = 8 * Math.cos(ang) / sx, dy = 8 * Math.sin(ang) / sy;
    field.push({ pts: [[t - dx, y - dy], [t + dx, y + dy]], s: "grey", w: 1.6 });
  }
  const sol = y0 => sample(t => 1 / (1 + (1 / y0 - 1) * Math.exp(-t)), 0, 8);
  return pscene("Ordinary differential equations", ax, [
    { say: "An ODE gives the slope at every point. Here y′ = y(1 − y), drawn as little dashes.", curves: field },
    { say: "A solution follows the dashes. From y = 0.05 it grows slowly, then fast, then levels off at 1 (the logistic curve).", curves: field.concat([{ pts: sol(0.05), s: "on" }]), dots: [{ x: 0, y: 0.05, s: "on" }] },
    { say: "Different starts, different solutions, but they all settle at y = 1, a stable equilibrium. (y = 0 is an unstable one.)", curves: field.concat([{ pts: sol(0.05), s: "on" }, { pts: sol(0.3), s: "on" }, { pts: sol(1.5), s: "hot" }]), hlines: [{ v: 1, label: "equilibrium" }] },
  ]);
}

function probabilityScene() {
  const g = gauss(0, 1), ax = { x: [-3.5, 3.5], y: [0, 0.45], xl: "value (in standard deviations)", yl: "probability density", xt: [-3, -2, -1, 0, 1, 2, 3], yt: [0, 0.4] };
  const band = (a, b) => ({ hi: sample(g, a, b, 40), lo: sample(() => 0, a, b, 40), a: 0.2 });
  return pscene("Probability", ax, [
    { say: "A probability distribution spreads total chance 1 over the possible values. The bell curve (normal distribution) is the most common.", curves: [{ pts: sample(g, -3.5, 3.5), s: "on" }] },
    { say: "Probability = area under the curve. Within one standard deviation of the mean: 68%.", curves: [{ pts: sample(g, -3.5, 3.5), s: "on" }], bands: [band(-1, 1)], texts: [{ x: 0, y: 0.15, t: "68%" }] },
    { say: "Within two: 95%. Sensor noise, measurement error and averages of many small effects all tend to look like this.", curves: [{ pts: sample(g, -3.5, 3.5), s: "on" }], bands: [band(-2, 2)], texts: [{ x: 0, y: 0.15, t: "95%" }] },
  ]);
}

function beamModelScene() {
  const zh = 0.7, zs = 0.12, zm = 0.05, zr = 0.13, lam = 0.6, zt = 5;
  const hit = z => zh * gauss(zt, 0.5)(z), short = z => (z < zt ? zs * lam * Math.exp(-lam * z) / (1 - Math.exp(-lam * zt)) : 0);
  const mx = z => (z >= 9.85 ? zm / 0.15 : 0), rnd = () => zr / 10;
  const S = f => sample(f, 0, 10, 400);
  const ax = { x: [0, 10], y: [0, 0.65], xl: "measured range z (m)", yl: "p(z)", xt: [0, 5, 10], yt: [0, 0.5] };
  return pscene("Sensor noise model", ax, [
    { say: "A range sensor aimed at a wall 5 m away. Usually it reads about 5 m, with Gaussian noise.", curves: [{ pts: S(hit), s: "on", label: "hit", lx: 5.5 }] },
    { say: "Sometimes something closer gets in the way, like a person walking by: shorter readings are more likely than longer ones.", curves: [{ pts: S(hit), s: "dim" }, { pts: S(short), s: "visit", label: "short", lx: 1 }] },
    { say: "Sometimes it misses and returns its maximum (10 m), or junk anywhere.", curves: [{ pts: S(hit), s: "dim" }, { pts: S(short), s: "dim" }, { pts: S(mx), s: "hot", label: "max", lx: 9.3 }, { pts: S(rnd), s: "grey", label: "random", lx: 7 }] },
    { say: "The sensor model mixes all four. A filter using it won't panic over one odd reading, as a pure Gaussian would.", curves: [{ pts: S(z => hit(z) + short(z) + mx(z) + rnd(z)), s: "on", label: "mixture", lx: 6 }] },
  ]);
}

function motionModelScene() {
  const R = rng(3), N = 160, x0 = 1, y0 = 2.9;
  const leg1 = Array.from({ length: N }, () => { const th = 0.22 * randn(R), d = 3 + 0.05 * randn(R); return { th, x: x0 + d * Math.cos(th), y: y0 + d * Math.sin(th) }; });
  const leg2 = leg1.map(p => { const th = p.th + 0.22 * randn(R), d = 3 + 0.05 * randn(R); return { x: p.x + d * Math.cos(th), y: p.y + d * Math.sin(th) }; });
  const start = { x0, y0, x1: x0 + 0.8, y1: y0, s: "ink", w: 3 };
  return Object.assign({ kind: "plot", title: "Probabilistic motion model", frames: [
    { say: "A robot at a known pose is told to drive 3 m straight ahead.", arrows: [start], dots: [{ x: x0, y: y0, s: "ink", r: 6 }] },
    { say: "Motion is noisy, so sample where it might end up. Small heading errors bend the cloud into a banana, not a round blob.", arrows: [start], dots: [{ x: x0, y: y0, s: "ink", r: 6 }].concat(leg1.map(p => ({ x: p.x, y: p.y, s: "on", r: 2 }))) },
    { say: "Another 3 m: the cloud spreads further. Without sensors, uncertainty only grows; a filter's update step is what pulls it back in.", arrows: [start], dots: [{ x: x0, y: y0, s: "ink", r: 6 }].concat(leg1.map(p => ({ x: p.x, y: p.y, s: "dim", r: 2 })), leg2.map(p => ({ x: p.x, y: p.y, s: "on", r: 2 }))) },
  ] }, BOX);
}

function astarScene() {
  const ROWS = 7, COLS = 12, S = [5, 1], G = [1, 10];
  const wall = (r, c) => (c === 4 && r >= 1) || (c === 8 && r <= 4);
  const search = useH => {
    const key = (r, c) => r * COLS + c, h = (r, c) => (useH ? Math.abs(r - G[0]) + Math.abs(c - G[1]) : 0);
    const g = { [key(...S)]: 0 }, par = {}, closed = new Set(), open = [[h(...S), 0, S[0], S[1], 0]]; let tick = 0;
    while (open.length) {
      open.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[4] - b[4]);
      const [, gc, r, c] = open.shift(), k = key(r, c);
      if (closed.has(k)) continue;
      closed.add(k);
      if (r === G[0] && c === G[1]) break;
      [[-1, 0], [0, 1], [1, 0], [0, -1]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc, nk = key(nr, nc);
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS || wall(nr, nc) || closed.has(nk)) return;
        if (g[nk] === undefined || gc + 1 < g[nk]) { g[nk] = gc + 1; par[nk] = k; open.push([gc + 1 + h(nr, nc), gc + 1, nr, nc, ++tick]); }
      });
    }
    const path = new Set(); let k = key(...G); while (k !== undefined) { path.add(k); k = par[k]; }
    return { closed, path, len: g[key(...G)] };
  };
  const dj = search(false), as = search(true);
  const grid = (res, showPath) => Array.from({ length: ROWS }, (_, r) => ({ cells: Array.from({ length: COLS }, (_, c) => {
    const k = r * COLS + c;
    if (r === S[0] && c === S[1]) return { v: "S", s: "ink" };
    if (r === G[0] && c === G[1]) return { v: "G", s: "good" };
    if (wall(r, c)) return { v: "", s: "wall" };
    if (showPath && res && res.path.has(k)) return { v: "", s: "on" };
    if (res && res.closed.has(k)) return { v: "", s: "soft" };
    return { v: "", s: "base" };
  }) }));
  return { kind: "array", grid: true, title: "A* search", frames: [
    { say: "Find a shortest path from S to G, moving up, down, left or right. Dark cells are walls.", rows: grid(null) },
    { say: `Dijkstra's algorithm, with no sense of direction, expands cells in rings of equal distance: ${dj.closed.size} cells explored before it reaches G.`, rows: grid(dj) },
    { say: `A* adds a guess h = distance to G ignoring walls, and always expands the cell with the smallest g + h. It heads for the goal: ${as.closed.size} cells explored.`, rows: grid(as) },
    { say: `Both find a shortest path (${as.len} moves). A* stays exact as long as h never overestimates the true remaining distance.`, rows: grid(as, true) },
  ] };
}

function potentialScene() {
  const G = [9, 2.9], O = [5, 2.9], rho0 = 1.5, kr = 2.5;
  const force = ([x, y]) => {
    let fx = -(x - G[0]), fy = -(y - G[1]);
    const dx = x - O[0], dy = y - O[1], d = Math.hypot(dx, dy);
    if (d < rho0) { const m = kr * (1 / d - 1 / rho0) / (d * d); fx += m * dx / d; fy += m * dy / d; }
    return [fx, fy];
  };
  const run = p => { const pts = [p.slice()]; for (let i = 0; i < 600; i++) { const [fx, fy] = force(p), n = Math.hypot(fx, fy); if (n < 1e-3 || Math.hypot(p[0] - G[0], p[1] - G[1]) < 0.06) break; const st = Math.min(0.06, 0.03 * n); p = [p[0] + fx / n * st, p[1] + fy / n * st]; pts.push(p.slice()); } return pts; };
  const field = [];
  for (let x = 0.7; x < 10; x += 1.1) for (let y = 0.6; y < 5.6; y += 1.0) {
    if (Math.hypot(x - O[0], y - O[1]) < 0.6) continue;
    const [fx, fy] = force([x, y]), n = Math.hypot(fx, fy) || 1;
    field.push({ x0: x, y0: y, x1: x + fx / n * 0.42, y1: y + fy / n * 0.42, s: "dim", w: 1.6, head: 6 });
  }
  const obs = [{ pts: ellipsePts(O[0], O[1], 0.45, 0.45), s: "ink", fill: 0.85, w: 1 }, { pts: ellipsePts(O[0], O[1], rho0, rho0), s: "grey", w: 1.5, dash: true }];
  const a = run([1, 1.6]), b = run([1, 2.9]), end = b[b.length - 1];
  const goal = { x: G[0], y: G[1], s: "good", r: 7, label: "goal" };
  return Object.assign({ kind: "plot", title: "Potential fields", frames: [
    { say: "The goal pulls the robot towards it; the obstacle pushes it away, but only within a set range (dashed). Arrows show the net push everywhere.", curves: obs, arrows: field, dots: [goal] },
    { say: "The robot just follows the arrows downhill. From here it slides round the obstacle and reaches the goal.", curves: obs.concat([{ pts: a, s: "on" }]), arrows: field, dots: [goal, { x: 1, y: 1.6, s: "on", r: 5 }] },
    { say: `Start dead in line with the obstacle and the pull and push cancel: the robot stops at a local minimum, ${(G[0] - end[0]).toFixed(1)} m short of the goal. Cheap to compute, but it can get stuck.`, curves: obs.concat([{ pts: a, s: "dim" }, { pts: b, s: "hot" }]), arrows: field, dots: [goal, { x: end[0], y: end[1], s: "hot", r: 6, label: "stuck" }] },
  ] }, BOX);
}

function rrtScene() {
  const R = rng(11), obs = [[3, 0, 4, 3.8], [6, 2, 7, 5.8]], start = [1, 1], goal = [9, 4.8];
  const free = (x, y) => x > 0 && x < 10 && y > 0 && y < 5.8 && obs.every(([x0, y0, x1, y1]) => x < x0 - 0.12 || x > x1 + 0.12 || y < y0 - 0.12 || y > y1 + 0.12);
  const segFree = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05); for (let i = 1; i <= n; i++) { const t = i / n; if (!free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; } return true; };
  const nodes = [{ p: start, parent: -1 }]; let found = -1;
  for (let it = 0; it < 4000 && found < 0; it++) {
    const q = R() < 0.08 ? goal : [R() * 10, R() * 5.8];
    let bi = 0, bd = Infinity; nodes.forEach((n, i) => { const d = Math.hypot(n.p[0] - q[0], n.p[1] - q[1]); if (d < bd) { bd = d; bi = i; } });
    if (bd < 1e-6) continue;
    const st = Math.min(0.7, bd), near = nodes[bi].p, np = [near[0] + (q[0] - near[0]) / bd * st, near[1] + (q[1] - near[1]) / bd * st];
    if (!segFree(near, np)) continue;
    nodes.push({ p: np, parent: bi });
    if (Math.hypot(np[0] - goal[0], np[1] - goal[1]) < 0.5) found = nodes.length - 1;
  }
  const tree = k => nodes.slice(1, k).map(n => seg(nodes[n.parent].p, n.p, "grey", 1.6));
  const path = []; for (let i = found; i >= 0; i = nodes[i].parent) path.push(nodes[i].p);
  const walls = obs.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, s: "wall" }));
  const ends = [{ x: start[0], y: start[1], s: "ink", r: 6, label: "start" }, { x: goal[0], y: goal[1], s: "good", r: 7, label: "goal" }];
  const k1 = 14, k2 = Math.min(60, nodes.length);
  return Object.assign({ kind: "plot", title: "Rapidly-exploring random tree", frames: [
    { say: "Plan a path from start to goal around the walls. No grid: RRT samples random points instead.", rects: walls, dots: ends },
    { say: "Pick a random point, find the nearest node of the tree, and grow one short step towards it, if that step doesn't hit a wall.", rects: walls, curves: tree(k1), dots: ends.concat(nodes.slice(1, k1).map(n => ({ x: n.p[0], y: n.p[1], s: "grey", r: 2 }))) },
    { say: "Repeat. Big empty regions attract more samples, so the tree rushes into unexplored space.", rects: walls, curves: tree(k2), dots: ends },
    found >= 0
      ? { say: `After ${nodes.length} nodes a branch reaches the goal. Follow the parents back for a path. (PRM instead scatters samples first and links neighbours into a reusable roadmap.)`, rects: walls, curves: tree(nodes.length).concat([{ pts: path, s: "on", w: 4 }]), dots: ends }
      : { say: "Keep growing until a branch reaches the goal.", rects: walls, curves: tree(nodes.length), dots: ends },
  ] }, BOX);
}

function roundRect(x0, y0, x1, y1, r) {
  const pts = [], arc = (cx, cy, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + i / 8 * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  arc(x1, y0, -Math.PI / 2); arc(x1, y1, 0); arc(x0, y1, Math.PI / 2); arc(x0, y0, Math.PI); pts.push(pts[0]);
  return pts;
}
function cspaceScene() {
  const r = 0.6, O = [4, 1.6, 6.2, 3.6], robots = [[2, 1.3], [3.7, 2.6], [7.6, 4.6]];
  const inGrown = ([x, y]) => { const dx = Math.max(O[0] - x, 0, x - O[2]), dy = Math.max(O[1] - y, 0, y - O[3]); return Math.hypot(dx, dy) < r; };
  const wall = [{ x0: O[0], y0: O[1], x1: O[2], y1: O[3], s: "wall" }];
  const grown = { pts: roundRect(O[0], O[1], O[2], O[3], r), s: "hot", w: 2, dash: true, fill: 0.08 };
  const path = [[1.4, 0.6], [6.9, 0.6], [8.6, 4.6]];
  return Object.assign({ kind: "plot", title: "Configuration space", frames: [
    { say: "A round robot (radius 0.6 m) among obstacles. Checking a pose means checking its whole body against every obstacle.", rects: wall, curves: robots.map(p => ({ pts: ellipsePts(p[0], p[1], r, r), s: inGrown(p) ? "hot" : "on", fill: 0.2, w: 2 })) },
    { say: "Trick: shrink the robot to a point and grow each obstacle by the robot's radius. The grown shape is the obstacle in configuration space.", rects: wall, curves: [grown], dots: robots.map(p => ({ x: p[0], y: p[1], s: inGrown(p) ? "hot" : "on", r: 5 })) },
    { say: "A point is in collision exactly when the real robot is. So plan for a point: any path that avoids the grown shapes keeps the real robot clear.", rects: wall, curves: [grown, { pts: path, s: "on", w: 3 }].concat(path.map(p => ({ pts: ellipsePts(p[0], p[1], r, r), s: "dim", w: 1.5 }))) },
  ] }, BOX);
}

function nonholonomicScene() {
  const pose = [6.2, 3.9, 0], poses = [pose.slice()], dt = 0.02;
  [[+0.9, 1.2], [-0.9, 1.2]].forEach(([w, T]) => { for (let t = 0; t < T - 1e-9; t += dt) { pose[2] += w * dt; pose[0] -= Math.cos(pose[2]) * dt; pose[1] -= Math.sin(pose[2]) * dt; poses.push(pose.slice()); } });
  const car = (p, s) => ({ x0: p[0] - 0.45 * Math.cos(p[2]), y0: p[1] - 0.45 * Math.sin(p[2]), x1: p[0] + 0.45 * Math.cos(p[2]), y1: p[1] + 0.45 * Math.sin(p[2]), s, w: 7, head: 12 });
  const a = poses[0], m = poses[Math.round(poses.length / 2)], z = poses[poses.length - 1];
  const kerb = [{ x0: 2.2, y0: 2.05, x1: 7.8, y1: 2.2, s: "grey" }];
  return Object.assign({ kind: "plot", title: "Nonholonomic constraints", x: [2, 8], y: [1.5, 5], frame: "box", frames: [
    { say: `A car can roll forwards or back and steer, but it can't slide sideways (ẏ cos θ − ẋ sin θ = 0). It wants to move ${(a[1] - z[1]).toFixed(1)} m to the side.`, rects: kerb, arrows: [car(a, "on"), car(z, "dim"), { x0: a[0], y0: a[1] - 0.3, x1: a[0], y1: z[1] + 0.2, s: "hot", dash: true, label: "can't slide" }] },
    { say: "So it combines the motions it does have: reverse while steering one way…", rects: kerb, curves: [{ pts: poses.slice(0, poses.length / 2 + 1), s: "on", w: 2.5 }], arrows: [car(a, "dim"), car(m, "on")] },
    { say: "…then reverse while steering the other way. Same pose, shifted sideways, after a longer path: that's what a nonholonomic constraint costs.", rects: kerb, curves: [{ pts: poses, s: "on", w: 2.5 }], arrows: [car(a, "dim"), car(m, "dim"), car(z, "on")] },
  ] });
}

function trackingScene() {
  const C = [5.6, 2.9], Rad = 2.2; let x = 0.8, y = 5.1, th = -0.3; const pts = [[x, y]];
  for (let i = 0; i < 900; i++) {
    const ang = Math.atan2(y - C[1], x - C[0]) + 0.6, tx = C[0] + Rad * Math.cos(ang), ty = C[1] + Rad * Math.sin(ang);
    let e = Math.atan2(ty - y, tx - x) - th; e = Math.atan2(Math.sin(e), Math.cos(e));
    th += 3 * e * 0.02; x += Math.cos(th) * 0.024; y += Math.sin(th) * 0.024;
    if (i % 3 === 0) pts.push([x, y]);
  }
  const ref = { pts: ellipsePts(C[0], C[1], Rad, Rad, 0, 90), s: "grey", w: 2, dash: true };
  const err = p => Math.abs(Math.hypot(p[0] - C[0], p[1] - C[1]) - Rad);
  return Object.assign({ kind: "plot", title: "Trajectory tracking", frames: [
    { say: "The reference: drive round this circle. The robot starts off it, pointing the wrong way.", curves: [ref], arrows: [{ x0: 0.8, y0: 5.1, x1: 0.8 + 0.7 * Math.cos(-0.3), y1: 5.1 + 0.7 * Math.sin(-0.3), s: "ink", w: 6 }] },
    { say: "Feedback: steer towards a point a little ahead on the path, turning harder the bigger the heading error.", curves: [ref, { pts: pts.slice(0, 70), s: "on" }] },
    { say: `The gap to the path shrinks and stays small: ${err(pts[0]).toFixed(1)} m at the start, ${err(pts[pts.length - 1]).toFixed(2)} m after one lap. Tracking is feedback on the gap between where you are and where you should be.`, curves: [ref, { pts, s: "on" }] },
  ] }, BOX);
}

function kinDynScene() {
  const cmd = t => (t >= 0.5 && t < 3.5 ? 1 : 0), tau = 0.6; let v = 0; const dyn = [[0, 0]];
  for (let i = 1; i <= 700; i++) { const t = i * 0.01; v += (cmd(t) - v) / tau * 0.01; if (i % 5 === 0) dyn.push([t, v]); }
  const ax = { x: [0, 7], y: [-0.1, 1.25], xl: "time (s)", yl: "speed (m/s)", xt: [0, 3.5, 7], yt: [0, 1] };
  const c = { pts: sample(cmd, 0, 7, 700), s: "ink", label: "command", lx: 2 };
  return pscene("Kinematic vs dynamic models", ax, [
    { say: "Command: go at 1 m/s from t = 0.5 s, stop at t = 3.5 s.", curves: [c] },
    { say: "A kinematic model says the robot's speed is whatever you command, instantly. Simple, and fine when moving slowly.", curves: [c, { pts: sample(cmd, 0, 7, 700), s: "visit", w: 5, label: "kinematic", lx: 4.2 }] },
    { say: "A dynamic model adds mass and forces: speed lags the command (time constant 0.6 s) and the robot needs time and room to stop. At speed, that difference is a crash.", curves: [c, { pts: dyn, s: "on", label: "dynamic", lx: 4.5 }] },
  ]);
}

function pinholeScene() {
  const f = 1.2, O = [2, 0], imgX = O[0] - f, proj = ([X, Y]) => [imgX, -f * Y / (X - O[0])];
  const P1 = [5, 1.2], P2 = [8, 1.2], P3 = [8, 2.4];
  const geo = { x: [0, 10], y: [-2.9, 2.9], frame: "box" };
  const base = [{ pts: [[imgX, -1.3], [imgX, 1.3]], s: "ink", w: 3 }, { pts: [[O[0], -1.5], [O[0], -0.08]], s: "ink", w: 4 }, { pts: [[O[0], 0.08], [O[0], 1.5]], s: "ink", w: 4 }, { pts: [[0, 0], [10, 0]], s: "dim", w: 1.5, dash: true }];
  const ray = (P, s) => ({ pts: [P, proj(P)], s, w: 2 });
  const lbl = [{ x: imgX, y: 1.55, t: "image" }, { x: O[0], y: 1.75, t: "pinhole" }];
  return Object.assign({ kind: "plot", title: "Pinhole camera", frames: [
    { say: "A pinhole camera, side view. Light from a point passes through one tiny hole and lands on the image plane behind it.", curves: base.concat([ray(P1, "on")]), dots: [{ x: P1[0], y: P1[1], s: "on", r: 6, label: "Y = 1.2, Z = 3" }, { x: imgX, y: proj(P1)[1], s: "on", r: 4 }], texts: lbl },
    { say: `Similar triangles: image height y = f·Y/Z = ${f}·1.2/3 = ${Math.abs(proj(P1)[1]).toFixed(2)}, upside down. f is the focal length, the hole-to-image distance.`, curves: base.concat([ray(P1, "on")]), dots: [{ x: P1[0], y: P1[1], s: "on", r: 6 }, { x: imgX, y: proj(P1)[1], s: "on", r: 4, label: "y" }], texts: lbl.concat([{ x: (imgX + O[0]) / 2, y: -0.25, t: "f", size: 13 }]) },
    { say: "Twice as far, half as big in the image. And every point on one ray lands on the same pixel: a single image loses depth.", curves: base.concat([ray(P3, "on"), ray(P2, "hot")]), dots: [{ x: P1[0], y: P1[1], s: "on", r: 6 }, { x: P3[0], y: P3[1], s: "on", r: 6 }, { x: P2[0], y: P2[1], s: "hot", r: 6, label: "Z = 6" }, { x: imgX, y: proj(P1)[1], s: "on", r: 4 }, { x: imgX, y: proj(P2)[1], s: "hot", r: 4 }], texts: lbl },
  ] }, geo);
}

function stereoScene() {
  const f = 0.9, cams = [-2.2, 2.2], y0 = 0.6, yi = y0 + f, b = 4.4;
  const geo = { x: [-5, 5], y: [0, 5.8], frame: "box" };
  const hit = (P, c) => [c + (P[0] - c) * f / (P[1] - y0), yi];
  const scene = (P, s) => cams.map(c => ({ pts: [P, [c, y0]], s, w: 2 }));
  const base = cams.map(c => ({ pts: [[c - 1.3, yi], [c + 1.3, yi]], s: "ink", w: 3 }));
  const disp = P => (hit(P, cams[0])[0] - cams[0]) - (hit(P, cams[1])[0] - cams[1]);
  const P = [0.8, 3.0], Q = [0.8, 5.4];
  const camDots = cams.map(c => ({ x: c, y: y0, s: "ink", r: 6 }));
  return Object.assign({ kind: "plot", title: "Stereo depth", frames: [
    { say: `Two cameras side by side, a baseline b = ${b} apart (top view), both see the same point.`, curves: base.concat(scene(P, "on")), dots: camDots.concat([{ x: P[0], y: P[1], s: "on", r: 6, label: "Z = " + (P[1] - y0).toFixed(1) }], cams.map(c => ({ x: hit(P, c)[0], y: yi, s: "on", r: 4 }))) },
    { say: `It lands at different spots in the two images. The shift is the disparity: d = f·b/Z = ${disp(P).toFixed(2)}. Find it by matching pixels between the images.`, curves: base.concat(scene(P, "on")), dots: camDots.concat([{ x: P[0], y: P[1], s: "on", r: 6 }], cams.map(c => ({ x: hit(P, c)[0], y: yi, s: "hot", r: 5 }))), texts: [{ x: 0, y: 0.2, t: "d = " + disp(P).toFixed(2) }] },
    { say: `Depth is Z = f·b/d. A point twice as far has half the disparity (${disp(Q).toFixed(2)}), so a one-pixel matching error costs far more depth accuracy at range.`, curves: base.concat(scene(P, "dim"), scene(Q, "hot")), dots: camDots.concat([{ x: Q[0], y: Q[1], s: "hot", r: 6, label: "Z = " + (Q[1] - y0).toFixed(1) }], cams.map(c => ({ x: hit(Q, c)[0], y: yi, s: "hot", r: 4 }))), texts: [{ x: 0, y: 0.2, t: "d = " + disp(Q).toFixed(2) }] },
  ] }, geo);
}

function loopClosureScene({ slam = false } = {}) {
  const legs = [[6, 9, 0], [3.8, 6, Math.PI / 2], [6, 9, Math.PI], [3.8, 6, 3 * Math.PI / 2]];
  const steps = []; legs.forEach(([len, n, head]) => { for (let i = 0; i < n; i++) steps.push([len / n, head]); });
  const Bias = 0.008, Scale = 1.03, N = steps.length, E = Bias * N; // gyro drift per step; wheel scale error
  const truth = [[2, 1]], odo = [[2, 1]], rot = [[2, 1]];
  let tx = 2, ty = 1, eth = 0, ex = 2, ey = 1, fx = 2, fy = 1;
  steps.forEach(([d, h], k) => {
    tx += d * Math.cos(h); ty += d * Math.sin(h); truth.push([tx, ty]);
    eth += h - (k ? steps[k - 1][1] : 0) + Bias; ex += d * Scale * Math.cos(eth); ey += d * Scale * Math.sin(eth); odo.push([ex, ey]);
    const fh = eth - E * (k + 1) / N; fx += d * Scale * Math.cos(fh); fy += d * Scale * Math.sin(fh); rot.push([fx, fy]); // heading error spread evenly
  });
  const gx = truth[0][0] - fx, gy = truth[0][1] - fy;
  const fixed = rot.map(([x, y], k) => [x + gx * k / N, y + gy * k / N]); // then the position error
  const miss = Math.hypot(truth[0][0] - ex, truth[0][1] - ey);
  const T = { pts: truth, s: "dim", w: 2, dash: true }, start = { x: 2, y: 1, s: "ink", r: 5, label: "start" };
  return Object.assign({ kind: "plot", title: slam ? "Pose-graph SLAM" : "Odometry drift and loop closure", frames: [
    { say: "The true route: once round a block, back to the start (dashed).", curves: [T], dots: [start] },
    { say: `${slam ? "Each node is a pose; each odometry step is an edge saying how far it moved." : "Visual odometry chains small motion estimates."} Tiny errors add up: after one lap it thinks it's ${miss.toFixed(1)} m from where it began.`, curves: [T, { pts: odo, s: "hot" }], dots: [start].concat(odo.map(([x, y]) => ({ x, y, s: "hot", r: 2.2 }))) },
    { say: "Loop closure: the camera recognises the start. That adds one more edge to the graph: the last pose equals the first.", curves: [T, { pts: odo, s: "hot" }, { pts: [odo[N], truth[0]], s: "on", w: 3, dash: true }], dots: [start] },
    { say: "Optimising the graph spreads the error along every edge, and the whole path snaps back into shape.", curves: [T, { pts: odo, s: "dim" }, { pts: fixed, s: "on" }], dots: [start].concat(fixed.map(([x, y]) => ({ x, y, s: "on", r: 2.2 }))) },
  ] }, BOX);
}

function icpScene() {
  const R = rng(9), tgt = [];
  for (let x = 3; x <= 7.01; x += 0.4) tgt.push([x, 1.2]);
  for (let y = 1.6; y <= 4.81; y += 0.4) tgt.push([7, y]);
  const cx0 = 5.5, cy0 = 2.4, a0 = -0.3;
  let src = tgt.map(([x, y]) => { const dx = x - cx0, dy = y - cy0; return [cx0 + dx * Math.cos(a0) - dy * Math.sin(a0) - 1.6 + 0.03 * randn(R), cy0 + dx * Math.sin(a0) + dy * Math.cos(a0) + 0.5 + 0.03 * randn(R)]; });
  const nearest = p => tgt.reduce((b, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(b[0] - p[0], b[1] - p[1]) ? q : b), tgt[0]);
  const stepICP = s => {
    const pairs = s.map(p => [p, nearest(p)]), n = pairs.length;
    const ms = [0, 1].map(i => pairs.reduce((a, [p]) => a + p[i], 0) / n), mt = [0, 1].map(i => pairs.reduce((a, [, q]) => a + q[i], 0) / n);
    let sxx = 0, sxy = 0, syx = 0, syy = 0;
    pairs.forEach(([p, q]) => { const px = p[0] - ms[0], py = p[1] - ms[1], qx = q[0] - mt[0], qy = q[1] - mt[1]; sxx += px * qx; sxy += px * qy; syx += py * qx; syy += py * qy; });
    const a = Math.atan2(sxy - syx, sxx + syy), c = Math.cos(a), sn = Math.sin(a);
    return { pairs, next: s.map(([x, y]) => [c * (x - ms[0]) - sn * (y - ms[1]) + mt[0], sn * (x - ms[0]) + c * (y - ms[1]) + mt[1]]) };
  };
  const snaps = [src]; let first = null;
  for (let i = 0; i < 25; i++) { const r = stepICP(src); if (!i) first = r.pairs; src = r.next; snaps.push(src); }
  const rms = s => Math.sqrt(s.reduce((a, p) => { const q = nearest(p); return a + (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; }, 0) / s.length);
  const T = tgt.map(([x, y]) => ({ x, y, s: "ink", r: 3.2 })), S = s => s.map(([x, y]) => ({ x, y, s: "on", r: 3.2 }));
  return Object.assign({ kind: "plot", title: "Iterative closest point", frames: [
    { say: "Two laser scans of the same corner (black: the first scan, coloured: the second), offset and turned because the robot moved between them.", dots: T.concat(S(snaps[0])) },
    { say: "Step 1: pair every point with its nearest neighbour in the other scan. Many pairs are wrong at first, but they point the right way.", dots: T.concat(S(snaps[0])), curves: first.map(([p, q]) => seg(p, q, "grey", 1.4)) },
    { say: `Step 2: find the rotation and shift that best fit those pairs (a closed-form least-squares solution) and apply it. Error: ${rms(snaps[0]).toFixed(2)} → ${rms(snaps[1]).toFixed(2)} m.`, dots: T.concat(S(snaps[1])) },
    { say: `Repeat: better pairs, better fit. After a few rounds the scans line up (error ${rms(snaps[snaps.length - 1]).toFixed(3)} m), and the total transform is how far the robot moved.`, dots: T.concat(S(snaps[snaps.length - 1])) },
  ] }, BOX);
}

function convolutionScene({ cnn = false } = {}) {
  const x = cnn ? [1, 1, 7, 7, 7, 1, 1, 1] : [2, 2, 2, 3, 8, 8, 8, 8], k = [-1, 0, 1], n = x.length;
  const conv = x.map((_, i) => (i === 0 || i === n - 1 ? null : k[0] * x[i - 1] + k[1] * x[i] + k[2] * x[i + 1]));
  const px = (hl) => ({ label: "pixels", cells: x.map((v, i) => ({ v, s: hl && hl.includes(i) ? "visit" : "base" })) });
  const kern = at => ({ label: "kernel", cells: x.map((_, i) => (i >= at - 1 && i <= at + 1 ? { v: k[i - at + 1], s: "ink" } : { v: "", s: "blank" })) });
  const out = (upto, label = "output", vals = conv, hot = []) => ({ label, cells: vals.map((v, i) => (v === null || i > upto ? { v: "", s: i > upto && v !== null ? "dim" : "blank" } : { v, s: hot.includes(i) ? "hot" : "on" })) });
  if (!cnn) {
    const big = conv.map((v, i) => (v !== null && Math.abs(v) >= 3 ? i : -1)).filter(i => i >= 0);
    return { kind: "array", title: "Convolution", frames: [
      { say: "A row of pixel brightnesses, dark on the left and bright on the right.", rows: [px()] },
      { say: "Slide a small kernel along it, here [−1, 0, 1]: each output is the sum of kernel × pixel for the pixels under it.", rows: [px([0, 1, 2]), kern(1), out(1)] },
      { say: `At position 4: −1·${x[2]} + 0·${x[3]} + 1·${x[4]} = ${conv[3]}.`, rows: [px([2, 3, 4]), kern(3), out(3)] },
      { say: "The output is big only where brightness jumps: this kernel is an edge detector. A blur kernel like [1, 2, 1]/4 would smooth instead. Images do the same in 2-D.", rows: [px(), out(n - 2, "output", conv, big)] },
    ] };
  }
  const relu = conv.map(v => (v === null ? null : Math.max(0, v)));
  const pool = x.map((_, i) => (i % 2 === 1 && i < n - 1 ? Math.max(relu[i], relu[i + 1] === null ? 0 : relu[i + 1]) : null));
  return { kind: "array", title: "Convolutional layers", frames: [
    { say: "One row of an image: dark, a bright band, dark again.", rows: [px()] },
    { say: "A convolution layer slides a kernel over it. This one, [−1, 0, 1], fires positive at rising edges and negative at falling ones.", rows: [px(), out(n - 2, "conv")] },
    { say: "ReLU keeps the positives and sets negatives to 0.", rows: [px(), out(n - 2, "conv"), out(n - 2, "ReLU", relu)] },
    { say: "Max-pooling keeps the strongest response in each pair: smaller, and tolerant to small shifts.", rows: [px(), out(n - 2, "ReLU", relu), out(n - 2, "pool", pool)] },
    { say: "A CNN learns its kernel values from examples, and stacks layers: edges, then parts, then whole objects.", rows: [px(), out(n - 2, "conv"), out(n - 2, "ReLU", relu), out(n - 2, "pool", pool)] },
  ] };
}

function neuralNetScene() {
  const xin = [1, 0.5], W1 = [[0.8, -0.4], [0.3, 0.9], [-0.5, 0.6]], b1 = [0, -0.2, 0.1], W2 = [1.2, -0.7, 0.9], b2 = 0.1;
  const z = W1.map((w, i) => w[0] * xin[0] + w[1] * xin[1] + b1[i]), h = z.map(v => Math.max(0, v)), y = W2.reduce((a, w, i) => a + w * h[i], b2);
  const nodes = { x1: [55, 75], x2: [55, 165], h1: [200, 40], h2: [200, 120], h3: [200, 200], y: [345, 120] };
  const edges = [];
  ["x1", "x2"].forEach((a, j) => ["h1", "h2", "h3"].forEach((b, i) => edges.push([a, b, W1[i][j]])));
  ["h1", "h2", "h3"].forEach((a, i) => edges.push([a, "y", W2[i]]));
  const r2 = v => String(Math.round(v * 100) / 100);
  const all = Object.keys(nodes);
  return { kind: "graph", title: "A neural network", nodes, edges, directed: true, showW: true, elT: 0.3, frames: [
    { say: "A tiny neural network: 2 inputs, 3 hidden units, 1 output. Every arrow carries a weight.", e: styleAll(edges.map(([a, b]) => ekey(a, b, true)), "base") },
    { say: `Feed in x = (${xin.join(", ")}).`, n: { x1: "on", x2: "on" }, nl: { x1: "x₁ = " + xin[0], x2: "x₂ = " + xin[1] } },
    { say: `Each hidden unit adds up weight × input plus a bias, then applies ReLU (negatives become 0): h = (${h.map(r2).join(", ")}).`, n: { x1: "on", x2: "on", h1: "on", h2: "on", h3: "visit" }, nl: { x1: "x₁ = " + xin[0], x2: "x₂ = " + xin[1], h1: r2(h[0]), h2: r2(h[1]), h3: "0 (was " + r2(z[2]) + ")" }, e: styleAll(edges.slice(0, 6).map(([a, b]) => ekey(a, b, true)), "on") },
    { say: `The output does the same with the hidden values: ${r2(y)}. Training nudges every weight to shrink the error on examples; backpropagation computes those nudges.`, n: styleAll(all, "on"), nl: { h1: r2(h[0]), h2: r2(h[1]), h3: "0", y: "y = " + r2(y) }, e: styleAll(edges.slice(6).map(([a, b]) => ekey(a, b, true)), "on") },
  ] };
}

function attentionScene() {
  const words = ["the", "red", "door", "is", "open"], K = [[0.1, 0.2], [1.6, 0.9], [1.2, 1.4], [0.2, -0.3], [0.9, 0.4]], q = [1.0, 1.2];
  const sc = K.map(k => (k[0] * q[0] + k[1] * q[1]) / Math.SQRT2), ex = sc.map(Math.exp), tot = ex.reduce((a, c) => a + c, 0), w = ex.map(e => e / tot);
  const wr = { label: "words", cells: words.map(t => ({ v: t, s: t === "door" ? "visit" : "base" })) };
  const sr = { label: "score", cells: sc.map(v => ({ v: v.toFixed(1), s: "base" })) };
  const pr = { label: "weight %", cells: w.map(v => ({ v: Math.round(v * 100), a: v / Math.max(...w) * 0.9 })) };
  const top = words.map((t, i) => [t, w[i]]).sort((a, b) => b[1] - a[1]);
  return { kind: "array", title: "Attention", frames: [
    { say: "A sentence, as a row of word vectors. How should the word 'door' update its meaning from its context?", rows: [wr] },
    { say: "'door' sends a query; every word offers a key. Score = query · key / √d: high when they match.", rows: [wr, sr] },
    { say: "Softmax turns the scores into weights that add up to 100%.", rows: [wr, sr, pr] },
    { say: `The new 'door' is the weighted mix of every word's value vector: mostly ${top[0][0]} (${Math.round(top[0][1] * 100)}%) and ${top[1][0]} (${Math.round(top[1][1] * 100)}%). Vision transformers do this with image patches as words.`, rows: [wr, pr] },
  ] };
}

function linAlgScene() {
  const A = ([x, y]) => [2 * x + y, x + 2 * y];
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const ax = { x: [-2.5, 5.8], y: [-1.3, 3.5], frame: "box" };
  const axes = [{ pts: [[-2.5, 0], [5.8, 0]], s: "dim", w: 1.5 }, { pts: [[0, -1.3], [0, 3.5]], s: "dim", w: 1.5 }];
  return Object.assign({ kind: "plot", title: "Matrices as maps", frames: [
    { say: "A matrix is a map of the plane. Take A = [[2, 1], [1, 2]] and watch what it does to the unit square.", curves: axes.concat([{ pts: sq, s: "ink", fill: 0.1, w: 2 }]) },
    { say: "A sends (1, 0) to (2, 1) and (0, 1) to (1, 2): the square becomes a parallelogram. Its area, 3, is det A.", curves: axes.concat([{ pts: sq, s: "dim", w: 2 }, { pts: sq.map(A), s: "on", fill: 0.15, w: 2.5 }]), arrows: [{ x0: 0, y0: 0, x1: 2, y1: 1, s: "on" }, { x0: 0, y0: 0, x1: 1, y1: 2, s: "on" }] },
    { say: "Along (1, 1) and (1, −1) it only stretches, by 3 and by 1. Those directions are its eigenvectors; the stretches are its eigenvalues.", curves: axes.concat([{ pts: sq.map(A), s: "dim", w: 2 }, { pts: [[-1.2, -1.2], [3.4, 3.4]], s: "grey", w: 1.2, dash: true }, { pts: [[-1.3, 1.3], [1.3, -1.3]], s: "grey", w: 1.2, dash: true }]), arrows: [{ x0: 0, y0: 0, x1: 3, y1: 3, s: "hot", label: "A(1,1) = 3·(1,1)" }, { x0: 0, y0: 0, x1: 1, y1: -1, s: "visit", label: "A(1,−1) = (1,−1)" }] },
  ] }, ax);
}

function gdScene() {
  const f = (x, y) => 0.5 * (x * x + 8 * y * y), a = 0.22;
  let p = [-4.2, 1.2]; const gd = [p];
  for (let i = 0; i < 16; i++) { p = [p[0] - a * p[0], p[1] - a * 8 * p[1]]; gd.push(p); }
  const contours = [10, 4.5, 1.6, 0.4].map(c => ({ pts: ellipsePts(0, 0, Math.sqrt(2 * c), Math.sqrt(2 * c / 8), 0, 72), s: "grey", w: 1.2 }));
  const ax = { x: [-4.9, 4.9], y: [-2.85, 2.85], frame: "box" };
  const mn = { x: 0, y: 0, s: "good", r: 5, label: "minimum" };
  return Object.assign({ kind: "plot", title: "Gradient descent", frames: [
    { say: "Minimise f(x, y) = ½(x² + 8y²): a long, narrow valley (contour lines of equal height).", curves: contours, dots: [mn, { x: gd[0][0], y: gd[0][1], s: "ink", r: 5, label: "start" }] },
    { say: `Gradient descent steps straight downhill. It's steep across the valley and gentle along it, so it zigzags: f = ${f(...gd[6]).toFixed(2)} after 6 steps.`, curves: contours.concat([{ pts: gd.slice(0, 7), s: "hot", w: 2 }]), dots: [mn].concat(gd.slice(0, 7).map(([x, y]) => ({ x, y, s: "hot", r: 3 }))) },
    { say: "Newton's method also uses the curvature (the Hessian). On a quadratic it lands on the minimum in one step; many optimisers sit somewhere between the two.", curves: contours.concat([{ pts: gd, s: "dim", w: 2 }]), arrows: [{ x0: gd[0][0], y0: gd[0][1], x1: 0, y1: 0, s: "on", w: 3 }], dots: [mn] },
  ] }, ax);
}

function valueIterScene({ dp = false } = {}) {
  const ROWS = 5, COLS = 7, G = [0, 6], walls = new Set(["1,1", "1,2", "1,3", "3,3", "3,4", "3,5"]);
  const isWall = (r, c) => walls.has(r + "," + c), moves = [[-1, 0, "↑"], [1, 0, "↓"], [0, -1, "←"], [0, 1, "→"]];
  const nb = (r, c, [dr, dc]) => { const nr = r + dr, nc = c + dc; return nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS || isWall(nr, nc) ? [r, c] : [nr, nc]; };
  let V = Array.from({ length: ROWS }, () => Array(COLS).fill(0)); V[G[0]][G[1]] = 10;
  const hist = [V.map(r => r.slice())];
  for (let k = 0; k < 40; k++) {
    const nV = V.map((row, r) => row.map((v, c) => (isWall(r, c) || (r === G[0] && c === G[1]) ? v : Math.max(...moves.map(m => { const [nr, nc] = nb(r, c, m); return -1 + V[nr][nc]; })))));
    const same = nV.every((row, r) => row.every((v, c) => v === V[r][c]));
    V = nV; hist.push(V.map(r => r.slice()));
    if (same) break;
  }
  const done = hist.length - 2;
  const grid = (Vk, k, arrows) => Vk.map((row, r) => ({ cells: row.map((v, c) => {
    if (isWall(r, c)) return { v: "", s: "wall" };
    if (r === G[0] && c === G[1]) return { v: "+10", s: "good" };
    if (arrows) { const best = moves.reduce((b, m) => { const [nr, nc] = nb(r, c, m); return V[nr][nc] > b[0] ? [V[nr][nc], m[2]] : b; }, [-Infinity, ""]); return { v: best[1], a: (v + 2) / 12 }; }
    const informed = k > 0 && v > -k;
    return informed ? { v, a: Math.max(0.08, (v + 2) / 12) } : { v, s: "dim" };
  }) }));
  return { kind: "array", grid: true, title: dp ? "Dynamic programming" : "Value iteration", frames: [
    { say: "Reach the +10 square; every move costs 1. A cell's value = the best total reward you can still get from there.", rows: grid(hist[0], 0) },
    { say: `Sweep: each cell's value = −1 + its best neighbour's value. After one sweep, only the goal's neighbours know anything (9).`, rows: grid(hist[1], 1) },
    { say: "Each sweep spreads the information one step further.", rows: grid(hist[3], 3) },
    { say: `After ${done} sweeps nothing changes: the values are exact. ${dp ? "Each answer reused its neighbour's solved answer: that's dynamic programming." : "That's value iteration."}`, rows: grid(hist[done], done) },
    { say: dp ? "Read off the decision in each cell: step to the best neighbour. Shortest paths from every cell, at once." : "The optimal policy: in each cell, move to the best neighbour. Policy iteration reaches the same answer by alternating 'evaluate a policy' and 'improve it'.", rows: grid(hist[done], done, true) },
  ] };
}

function mdpScene() {
  const ROWS = 3, COLS = 4, wall = "1,1", term = { "0,3": 1, "1,3": -1 }, step = -0.04;
  const dirs = { "↑": [-1, 0], "↓": [1, 0], "←": [0, -1], "→": [0, 1] }, side = { "↑": ["←", "→"], "↓": ["→", "←"], "←": ["↓", "↑"], "→": ["↑", "↓"] };
  const go = (r, c, d) => { const [dr, dc] = dirs[d], nr = r + dr, nc = c + dc; return nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS || nr + "," + nc === wall ? [r, c] : [nr, nc]; };
  let V = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  Object.entries(term).forEach(([k, v]) => { const [r, c] = k.split(",").map(Number); V[r][c] = v; });
  const Q = (r, c, d) => { let s = 0; [[d, 0.8], [side[d][0], 0.1], [side[d][1], 0.1]].forEach(([dd, p]) => { const [nr, nc] = go(r, c, dd); s += p * V[nr][nc]; }); return step + s; };
  for (let k = 0; k < 200; k++) V = V.map((row, r) => row.map((v, c) => (r + "," + c === wall || term[r + "," + c] !== undefined ? v : Math.max(...Object.keys(dirs).map(d => Q(r, c, d))))));
  const pol = (r, c) => Object.keys(dirs).reduce((b, d) => (Q(r, c, d) > Q(r, c, b) ? d : b), "↑");
  const cellOf = (r, c, mode) => {
    const k = r + "," + c;
    if (k === wall) return { v: "", s: "wall" };
    if (term[k] !== undefined) return { v: term[k] > 0 ? "+1" : "−1", s: term[k] > 0 ? "good" : "c0" };
    if (mode === "slip") { if (k === "2,2") return { v: "↑", s: "ink" }; if (k === "1,2") return { v: "80%", s: "visit" }; if (k === "2,1" || k === "2,3") return { v: "10%", s: "visit" }; return { v: "", s: "base" }; }
    if (mode === "values") return { v: V[r][c].toFixed(2), a: (V[r][c] + 0.2) / 1.4 };
    if (mode === "policy") return { v: pol(r, c), a: (V[r][c] + 0.2) / 1.4 };
    return { v: k === "2,0" ? "start" : "", s: "base" };
  };
  const grid = mode => Array.from({ length: ROWS }, (_, r) => ({ cells: Array.from({ length: COLS }, (_, c) => cellOf(r, c, mode)) }));
  return { kind: "array", grid: true, title: "Markov decision process", frames: [
    { say: "An MDP: states (squares), actions (moves), rewards (+1 and −1 end the game; every move costs 0.04).", rows: grid() },
    { say: "Actions are unreliable. Try to go up and you do, 80% of the time; 10% you slip left, 10% right. What happens next depends only on where you are and what you do.", rows: grid("slip") },
    { say: "Solve it (value iteration with those probabilities): each square's value is the best expected total reward from there.", rows: grid("values") },
    { say: "The optimal policy. Next to the −1 it goes the long way round: a 10% slip into −1 isn't worth the shortcut.", rows: grid("policy") },
  ] };
}

function rlLoopScene() {
  const nodes = { agent: [95, 120], world: [305, 120] };
  const sc = { kind: "graph", title: "Reinforcement learning", nodes, edges: [["agent", "world"], ["world", "agent"]], directed: true, boxNodes: true, labels: { agent: "agent", world: "environment" }, curves: { "agent>world": 62, "world>agent": 62 } };
  sc.frames = [
    { say: "An agent acts in an environment it doesn't fully understand.", n: { agent: "on" } },
    { say: "It picks an action…", n: { agent: "on" }, e: { "agent>world": "hot" }, el: { "agent>world": "action" } },
    { say: "…and gets back the new state and a reward: a number saying how good that was.", n: { world: "on" }, e: { "world>agent": "hot" }, el: { "agent>world": "action", "world>agent": "state, reward" } },
    { say: "Repeat, many thousands of times. Learning means finding a policy, state → action, that collects the most reward over time, from experience alone.", n: { agent: "on", world: "on" }, e: { "agent>world": "on", "world>agent": "on" }, el: { "agent>world": "action", "world>agent": "state, reward" } },
  ];
  return sc;
}

function corridorRows(label, vals, extra) {
  const states = { label: "state", cells: vals.map((_, i) => ({ v: i === vals.length - 1 ? "goal" : "s" + i, s: i === vals.length - 1 ? "good" : "base" })) };
  return [states, { label, cells: vals.map((v, i) => (i === vals.length - 1 ? { v: "", s: "blank" } : { v: v.toFixed(2), a: v * 0.9 })) }].concat(extra || []);
}
function qLearningScene() {
  const N = 5, al = 0.5, ga = 0.9, Q = Array(N).fill(0), snaps = [Q.slice()];
  for (let ep = 1; ep <= 30; ep++) { for (let s = 0; s < N - 1; s++) { const r = s + 1 === N - 1 ? 1 : 0, nxt = s + 1 === N - 1 ? 0 : Q[s + 1]; Q[s] += al * (r + ga * nxt - Q[s]); } snaps.push(Q.slice()); }
  return { kind: "array", title: "Q-learning", frames: [
    { say: "A corridor: walk right to reach the goal (reward 1). Q(s, →) estimates the total future reward of stepping right from s. It starts at 0.", rows: corridorRows("Q(s, →)", snaps[0]) },
    { say: "Episode 1. After each step: Q ← Q + α(r + γ·max Q(next) − Q), with α = 0.5, γ = 0.9. Only the last step saw a reward.", rows: corridorRows("Q(s, →)", snaps[1]) },
    { say: "Episode 2: the value leaks one step back, because s2 now sees s3's estimate.", rows: corridorRows("Q(s, →)", snaps[2]) },
    { say: "Episode 3: one more step back.", rows: corridorRows("Q(s, →)", snaps[3]) },
    { say: "After 30 episodes Q(s, →) ≈ 0.9^(steps left − 1): reward is worth less the further away it is. Act greedily on Q and you head straight for the goal.", rows: corridorRows("Q(s, →)", snaps[30]) },
  ] };
}
function mcTdScene() {
  const N = 5, al = 0.5, ga = 0.9, mc = Array(N).fill(0), td = Array(N).fill(0), snaps = [[mc.slice(), td.slice()]];
  for (let ep = 1; ep <= 3; ep++) {
    for (let s = 0; s < N - 1; s++) mc[s] += al * (Math.pow(ga, N - 2 - s) - mc[s]); // full return G = γ^(steps − 1)
    for (let s = 0; s < N - 1; s++) { const r = s + 1 === N - 1 ? 1 : 0, nxt = s + 1 === N - 1 ? 0 : td[s + 1]; td[s] += al * (r + ga * nxt - td[s]); }
    snaps.push([mc.slice(), td.slice()]);
  }
  const rows = k => corridorRows("Monte Carlo", snaps[k][0], [{ label: "TD(0)", cells: snaps[k][1].map((v, i) => (i === N - 1 ? { v: "", s: "blank" } : { v: v.toFixed(2), a: v * 0.9 })) }]);
  return { kind: "array", title: "Monte Carlo vs TD learning", frames: [
    { say: "Learn the value of each state from experience: walk the corridor to the goal (reward 1, discount 0.9).", rows: rows(0) },
    { say: "After episode 1. Monte Carlo waits for the end, then moves every state towards the return it actually got. TD updates each step from the next state's estimate: only s3 had one to use.", rows: rows(1) },
    { say: "Episode 2: Monte Carlo moves halfway again; TD's information creeps back one state.", rows: rows(2) },
    { say: "Episode 3. Monte Carlo: unbiased but noisy, and needs whole episodes. TD: learns online by bootstrapping from its own guesses. Both converge to the same values.", rows: rows(3) },
  ] };
}

function policyGradScene() {
  const rA = 1, rB = 0.3, soft = t => { const ea = Math.exp(t[0]), eb = Math.exp(t[1]); return ea / (ea + eb); };
  let th = [0, 0]; const exp = [[0, 0.5]];
  for (let i = 1; i <= 80; i++) { const p = soft(th), J = p * rA + (1 - p) * rB; th = [th[0] + 0.5 * p * (rA - J), th[1] + 0.5 * (1 - p) * (rB - J)]; exp.push([i, soft(th)]); }
  const run = seed => { // REINFORCE on sampled, noisy rewards
    const R = rng(seed); let t = [0, 0]; const pts = [[0, 0.5]];
    for (let i = 1; i <= 80; i++) {
      const p = soft(t), a = R() < p ? 0 : 1, r = (a === 0 ? rA : rB) + 1.2 * randn(R), g = [(a === 0 ? 1 : 0) - p, (a === 1 ? 1 : 0) - (1 - p)];
      t = [t[0] + 0.15 * r * g[0], t[1] + 0.15 * r * g[1]]; pts.push([i, soft(t)]);
    }
    return pts;
  };
  const ax = { x: [0, 80], y: [0, 1], xl: "policy updates", yl: "P(choose A)", xt: [0, 40, 80], yt: [0, 0.5, 1] };
  return pscene("Policy gradients", ax, [
    { say: "A policy picks arm A or B at random, 50/50 at first. A pays 1 on average, B pays 0.3.", curves: [], hlines: [{ v: 0.5 }] },
    { say: "Policy gradient: raise the log-probability of each action in proportion to the reward it brought. P(A) climbs (expected update shown).", curves: [{ pts: exp, s: "on", label: "expected", lx: 30 }] },
    { say: "With real, noisy rewards each update is a random nudge, so every run climbs differently (REINFORCE, three runs). Actor–critic subtracts a learned baseline, the critic's estimate, from each reward: same direction on average, less noise.", curves: [{ pts: exp, s: "on", label: "expected", lx: 30 }].concat([21, 22, 23].map(sd => ({ pts: run(sd), s: "grey", w: 1.5 }))) },
  ]);
}

function bcScene({ shift = false } = {}) {
  let e = 0, out = 0; const bc = [[0, 0]], dg = [[0, 0]]; const R = rng(4); let d = 0;
  for (let t = 1; t <= 50; t++) {
    if (Math.abs(e) > 0.3) out++;
    e += 0.02 + 0.0025 * out; bc.push([t, e]);
    d = 0.75 * d + 0.06 * randn(R) + 0.02; dg.push([t, d]);
  }
  const ax = { x: [0, 50], y: [-0.6, 3.4], xl: "time step", yl: "distance from lane centre (m)", xt: [0, 25, 50], yt: [0, 1, 2, 3] };
  const band = { hi: [[0, 0.3], [50, 0.3]], lo: [[0, -0.3], [50, -0.3]], a: 0.18 };
  return pscene(shift ? "Covariate shift" : "Behaviour cloning", ax, [
    { say: "Behaviour cloning: learn to drive by copying an expert's recorded actions. The expert stays near the lane centre, so the data (shaded) only covers states near it.", curves: [{ pts: [[0, 0], [50, 0]], s: "ink", label: "expert", lx: 40 }], bands: [band] },
    { say: "The copy makes small mistakes. Each one takes it to states a little off the data, where it has never seen what to do, so it errs more: errors compound (about T²ε over T steps).", curves: [{ pts: [[0, 0], [50, 0]], s: "ink" }, { pts: bc, s: "hot", label: "clone", lx: 38 }], bands: [band] },
    { say: shift ? "That's covariate shift: the states seen in testing differ from those in training. DAgger fixes it by asking the expert what to do in the states the learner actually reaches." : "DAgger fixes it: run the learner, ask the expert what it should have done in the states it reached, add that to the data, retrain.", curves: [{ pts: [[0, 0], [50, 0]], s: "ink" }, { pts: bc, s: "dim" }, { pts: dg, s: "on", label: "DAgger", lx: 30 }], bands: [band] },
  ]);
}

function sysIdScene() {
  const R = rng(8), us = Array.from({ length: 12 }, (_, i) => 0.6 + i * 0.5), ys = us.map(u => 0.8 * u + 1 + 0.35 * randn(R));
  const n = us.length, mu = us.reduce((a, c) => a + c, 0) / n, my = ys.reduce((a, c) => a + c, 0) / n;
  const a = us.reduce((s, u, i) => s + (u - mu) * (ys[i] - my), 0) / us.reduce((s, u) => s + (u - mu) ** 2, 0), b = my - a * mu;
  const ax = { x: [0, 10], y: [0, 10], xl: "input u (e.g. motor command)", yl: "output y (e.g. speed)", xt: [0, 5, 10], yt: [0, 5, 10] };
  const data = us.map((u, i) => ({ x: u, y: ys[i], s: "base" }));
  return pscene("System identification", ax, [
    { say: "Drive the real system with different inputs and record what comes out.", dots: data },
    { say: `Fit a model to the data, here y = a·u + b by least squares: a = ${a.toFixed(2)}, b = ${b.toFixed(2)}.`, dots: data, curves: [{ pts: [[0, b], [6.2, a * 6.2 + b]], s: "on" }] },
    { say: "Model-based RL then plans or practises inside the model instead of on the robot, saving real trials. Trust it less where it has no data.", dots: data, curves: [{ pts: [[0, b], [6.2, a * 6.2 + b]], s: "on" }, { pts: [[6.2, a * 6.2 + b], [10, a * 10 + b]], s: "on", dash: true, label: "extrapolation", lx: 7.2 }] },
  ]);
}

function assocScene() {
  const A = [[1, 1], [2, 1.5], [3, 2]], B = [[1.5, 4.8], [2.6, 4.4], [3.7, 4]], pa = [4, 2.5], pb = [4.8, 3.6], gate = 0.8;
  const det = [[4.2, 2.3], [4.6, 3.85], [8, 1.2]];
  const trail = (T, s) => ({ pts: T, s, w: 2.5 });
  const dots = [...A, ...B].map(([x, y]) => ({ x, y, s: "ink", r: 4 }));
  const preds = [pa, pb].map(([x, y]) => ({ x, y, s: "on", r: 5, hollow: true }));
  const D = det.map(([x, y]) => ({ x, y, s: "hot", r: 5 }));
  const gates = [pa, pb].map(p => ({ pts: ellipsePts(p[0], p[1], gate, gate), s: "on", w: 1.5, dash: true }));
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const m1 = det.findIndex(d => dist(d, pa) < gate), m2 = det.findIndex(d => dist(d, pb) < gate);
  return Object.assign({ kind: "plot", title: "Data association", frames: [
    { say: "Two objects being tracked. From their past positions, each track predicts where its object will be next (hollow).", curves: [trail(A, "ink"), trail(B, "ink")], dots: dots.concat(preds) },
    { say: "New detections arrive, without names. Which is which?", curves: [trail(A, "ink"), trail(B, "ink")], dots: dots.concat(preds, D) },
    { say: "Gate: only detections close to a prediction can belong to that track.", curves: [trail(A, "ink"), trail(B, "ink")].concat(gates), dots: dots.concat(preds, D) },
    { say: "Assign to minimise the total distance (the Hungarian algorithm does this for many tracks at once). The detection outside every gate starts a new track, or is clutter.", curves: [trail(A.concat([det[m1]]), "on"), trail(B.concat([det[m2]]), "on")].concat(gates), dots: dots.concat(D, [{ x: det[2][0], y: det[2][1], s: "hot", r: 6, label: "new track?" }]) },
  ] }, BOX);
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const I = ix * iy, U = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - I;
  return I / U;
}
function detectScene({ threeD = false } = {}) {
  const truth = [[2.2, 1.0, 5.0, 4.4], [6.6, 1.4, 8.8, 3.6]];
  const preds = [{ b: [2.4, 1.2, 5.2, 4.5], s: 0.92 }, { b: [6.5, 1.3, 8.7, 3.7], s: 0.88 }, { b: [1.9, 0.8, 4.7, 4.1], s: 0.81 }, { b: [2.9, 1.6, 5.6, 4.9], s: 0.64 }];
  const keep = []; preds.slice().sort((a, b) => b.s - a.s).forEach(p => { if (keep.every(k => iou(k.b, p.b) <= 0.5)) keep.push(p); });
  const R = (p, s, extra) => Object.assign({ x0: p.b[0], y0: p.b[1], x1: p.b[2], y1: p.b[3], s, label: p.s.toFixed(2), w: 2.5 }, extra || {});
  const T = truth.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, s: "ink", dash: true, w: 2 }));
  const sup = preds.filter(p => !keep.includes(p));
  return Object.assign({ kind: "plot", title: threeD ? "3-D object detection" : "Object detection", frames: [
    { say: threeD ? "A 3-D detector proposes boxes around objects (seen here from above, bird's-eye view), each with a confidence score." : "A detector proposes boxes, each with a confidence score.", rects: preds.map(p => R(p, "on")) },
    { say: `IoU = overlap area ÷ combined area measures how well two boxes agree. Best box vs the true outline (dashed): IoU = ${iou(preds[0].b, truth[0]).toFixed(2)}.`, rects: T.concat(preds.map(p => R(p, p === preds[0] ? "on" : "dim"))) },
    { say: `Non-maximum suppression: keep the highest-scoring box, drop any box overlapping a kept one by IoU > 0.5 (here ${sup.map(p => iou(p.b, preds[0].b).toFixed(2)).join(" and ")}).`, rects: keep.map(p => R(p, "on")).concat(sup.map(p => R(p, "hot", { dash: true }))) },
    { say: threeD ? "One box per object. In 3-D the boxes also carry height and heading, and IoU is computed on volumes or bird's-eye footprints." : "One box per object. A detection counts as correct when its IoU with a true box passes a threshold, often 0.5.", rects: keep.map(p => R(p, "on")).concat(T) },
  ] }, BOX);
}

function segmentationScene() {
  const ROWS = 6, COLS = 10;
  const cls = (r, c) => {
    if (r >= 4) return "road";
    if ((r === 2 || r === 3) && c >= 1 && c <= 3) return "car1";
    if ((r === 2 || r === 3) && c >= 5 && c <= 7) return "car2";
    if (c >= 8 && r >= 1) return "tree";
    return "sky";
  };
  const style = {
    raw: k => ({ v: "", s: k === "road" ? "wall" : k === "sky" ? "dim" : "soft" }),
    sem: k => ({ v: k[0] === "c" ? "car" : k, s: { road: "wall", sky: "c1", tree: "c2", car1: "c0", car2: "c0" }[k] }),
    inst: k => (k === "car1" ? { v: "1", s: "c0" } : k === "car2" ? { v: "2", s: "c3" } : { v: "", s: "dim" }),
    pan: k => (k === "car1" ? { v: "car 1", s: "c0" } : k === "car2" ? { v: "car 2", s: "c3" } : { v: k, s: { road: "wall", sky: "c1", tree: "c2" }[k] }),
  };
  const grid = m => Array.from({ length: ROWS }, (_, r) => ({ cells: Array.from({ length: COLS }, (_, c) => style[m](cls(r, c))) }));
  return { kind: "array", grid: true, title: "Segmentation", frames: [
    { say: "An image is a grid of pixels (very coarse here): sky, a tree, two cars, road.", rows: grid("raw") },
    { say: "Semantic segmentation labels every pixel with a class. Both cars are just 'car'.", rows: grid("sem") },
    { say: "Instance segmentation separates the objects: car 1 and car 2, each its own mask.", rows: grid("inst") },
    { say: "Panoptic segmentation does both: a class for every pixel, and an identity for every object.", rows: grid("pan") },
  ] };
}

function voxelScene() {
  const R = rng(13), pts = [];
  for (let i = 0; i < 70; i++) { const t = R(); const side = Math.floor(R() * 3); const p = side === 0 ? [2.6 + 2.6 * t, 1.6] : side === 1 ? [2.6, 1.6 + 1.2 * t] : [5.2, 1.6 + 1.2 * t]; pts.push([p[0] + 0.05 * randn(R), p[1] + 0.05 * randn(R)]); }
  for (let i = 0; i < 18; i++) pts.push([7.6 + 0.12 * randn(R), 4.2 + 0.12 * randn(R)]);
  for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, r = 3.8 + R() * 1.3; const p = [5 + r * Math.cos(a), 2.9 + 0.55 * r * Math.sin(a)]; if (p[0] > 0.2 && p[0] < 9.8 && p[1] > 0.2 && p[1] < 5.6) pts.push(p); }
  const cs = 0.6, count = {};
  pts.forEach(([x, y]) => { const k = Math.floor(x / cs) + "," + Math.floor(y / cs); count[k] = (count[k] || 0) + 1; });
  const cells = Object.entries(count).map(([k, n]) => { const [i, j] = k.split(",").map(Number); return { x0: i * cs, y0: j * cs, x1: (i + 1) * cs, y1: (j + 1) * cs, s: "on", a: Math.min(0.9, 0.18 + n * 0.1) }; });
  const dots = (s, r) => pts.map(([x, y]) => ({ x, y, s, r }));
  return Object.assign({ kind: "plot", title: "Point clouds and voxels", frames: [
    { say: `A lidar scan seen from above: ${pts.length} points, in no particular order. A car's outline, a pole, scattered ground returns.`, dots: dots("ink", 1.8) },
    { say: `Voxelise: cut space into cells and summarise the points in each (here, a count). ${cells.length} cells are occupied.`, rects: cells, dots: dots("ink", 1.3) },
    { say: "Now it's a regular grid, so convolutions apply (VoxelNet, PointPillars). PointNet instead learns on the raw points, using a max over them so their order doesn't matter.", rects: cells },
  ] }, BOX);
}

function stackScene() {
  const nodes = { sensors: [62, 58], perception: [190, 58], localisation: [325, 58], planning: [325, 185], control: [190, 185], actuators: [62, 185] };
  const order = Object.keys(nodes), edges = [];
  for (let i = 0; i < order.length - 1; i++) edges.push([order[i], order[i + 1]]);
  edges.push(["actuators", "sensors"]);
  const e = ids => styleAll(ids.map(([a, b]) => ekey(a, b, true)), "on");
  return { kind: "graph", title: "The autonomy stack", nodes, edges, directed: true, boxNodes: true, frames: [
    { say: "An autonomous robot runs a loop of modules. It starts with raw sensor data: camera images, lidar points, IMU, wheel encoders.", n: { sensors: "on" } },
    { say: "Perception turns data into things (cars, lanes, people); localisation works out where the robot is on its map.", n: { sensors: "on", perception: "on", localisation: "on" }, e: e(edges.slice(0, 2)) },
    { say: "Planning decides what to do: a route, then a safe, smooth trajectory.", n: { perception: "on", localisation: "on", planning: "on" }, e: e(edges.slice(1, 3)) },
    { say: "Control turns the trajectory into motor commands; actuators move. The world changes, and the loop runs again, 10 to 100 times a second.", n: styleAll(order, "on"), e: e(edges) },
  ] };
}

function fsmScene() {
  const nodes = { idle: [62, 120], drive: [205, 120], avoid: [335, 45], charge: [335, 195] };
  const edges = [["idle", "drive"], ["drive", "idle"], ["drive", "avoid"], ["avoid", "drive"], ["drive", "charge"], ["charge", "idle"]];
  const sc = { kind: "graph", title: "Finite state machine", nodes, edges, directed: true, boxNodes: true, curves: { "idle>drive": -28, "drive>idle": -28, "drive>avoid": -18, "avoid>drive": -18, "drive>charge": 18, "charge>idle": -95 } };
  const el = { "idle>drive": "goal", "drive>idle": "arrived", "drive>avoid": "obstacle", "avoid>drive": "clear", "drive>charge": "low battery", "charge>idle": "full" };
  const at = (state, via, say) => ({ say, n: { [state]: "on" }, e: via ? { [via]: "hot" } : {}, el });
  sc.frames = [
    at("idle", null, "A finite state machine: the robot is in exactly one state at a time, and events move it along the arrows."),
    at("drive", "idle>drive", "Event 'goal': idle → drive."),
    at("avoid", "drive>avoid", "Event 'obstacle': drive → avoid."),
    at("drive", "avoid>drive", "Event 'clear': back to drive."),
    at("charge", "drive>charge", "Event 'low battery': drive → charge. Small, predictable and easy to test: many robots sequence their behaviours this way."),
  ];
  return sc;
}

function npReductionScene() {
  const g = G8, ids = Object.keys(g.nodes), I = subsetsMax(ids, indepOk(g)), C = ids.filter(v => !I.includes(v));
  return gscene(g, [
    { say: "To show a problem is hard, reduce a known hard problem to it: turn any instance of the old one into an instance of the new one." },
    { say: `Known hard problem: independent set. Here a largest one is {${I.join(", ")}}: no edge joins two of them.`, n: styleAll(I, "good") },
    { say: `Take everything else, {${C.join(", ")}}: every edge has an end in it, so it's a vertex cover. In any graph, S is independent exactly when the rest is a cover.`, n: Object.assign(styleAll(I, "dim"), styleAll(C, "on")), e: styleAll(g.edges.map(x => ekey(x[0], x[1])), "on") },
    { say: "So a fast vertex-cover algorithm would give a fast independent-set algorithm (cover size k ⇔ independent set n − k). Vertex cover is at least as hard: NP-hard.", n: Object.assign(styleAll(I, "good"), styleAll(C, "on")) },
  ], { title: "NP-hardness by reduction" });
}

function optControlScene({ mode = "problem" } = {}) {
  const energy = t => 3 * (t / 2) ** 2 - 2 * (t / 2) ** 3, uE = t => 1.5 * (1 - t);
  const bang = t => (t < 1 ? t * t / 2 : 1 - (2 - t) ** 2 / 2), uB = t => (t < 1 ? 1 : -1);
  const ax = { x: [0, 2], y: [-1.7, 1.7], xl: "time (s)", yl: "position x  /  push u", xt: [0, 1, 2], yt: [-1, 0, 1] };
  const ends = [{ x: 0, y: 0, s: "ink", r: 5 }, { x: 2, y: 1, s: "good", r: 6, label: "x = 1", left: true }];
  const xE = { pts: sample(energy, 0, 2), s: "on", label: "position", lx: 1.2 }, cE = { pts: sample(uE, 0, 2), s: "visit", dash: true, label: "push u", lx: 0.25 };
  const xB = { pts: sample(bang, 0, 2), s: "on", label: "position", lx: 1.2 }, cB = { pts: sample(uB, 0, 2, 400), s: "hot", label: "push u", lx: 0.3 };
  if (mode === "transcription") {
    const ts = Array.from({ length: 9 }, (_, i) => i * 0.25);
    return pscene("Direct transcription", ax, [
      { say: "Direct methods turn the problem into numbers: the position at 9 time points (knots). Start from a guess, a straight line.", dots: ts.map(t => ({ x: t, y: t / 2, s: "hot", r: 4.5 })), curves: [{ pts: ts.map(t => [t, t / 2]), s: "hot", w: 1.5, dash: true }] },
      { say: "The dynamics become constraints between neighbouring knots (here: start and end at rest), and the cost becomes a sum. The straight line breaks the rest constraints.", dots: ts.map(t => ({ x: t, y: t / 2, s: "hot", r: 4.5 })).concat(ends) },
      { say: "A nonlinear-program solver moves the knots until every constraint holds and the cost ∑u² is least: the smooth minimum-effort path appears.", dots: ts.map(t => ({ x: t, y: energy(t), s: "on", r: 4.5 })).concat(ends), curves: [{ pts: sample(energy, 0, 2), s: "on", w: 1.5 }] },
    ]);
  }
  if (mode === "pontryagin") {
    return pscene("Pontryagin's principle", ax, [
      { say: "Move a cart (x″ = u) from rest at 0 to rest at 1 as fast as possible, with |u| ≤ 1.", dots: ends },
      { say: "Pontryagin: the best u minimises the Hamiltonian H = λ₁v + λ₂u at every instant, so u = −sign(λ₂). The costate λ₂ turns out to be a straight line.", curves: [{ pts: sample(t => t - 1, 0, 2, 20), s: "grey", label: "λ₂", lx: 1.55 }], dots: ends },
      { say: "A straight line changes sign at most once, so there's exactly one switch, at t = 1: full push, then full brake (bang–bang), arriving at t = 2.", curves: [{ pts: sample(t => t - 1, 0, 2, 20), s: "grey", label: "λ₂", lx: 1.55 }, xB, cB], dots: ends },
    ]);
  }
  return pscene("Optimal control", ax, [
    { say: "Move a cart (x″ = u) from rest at 0 to rest at 1 in 2 seconds. Many pushes u(t) do it. Which is best depends on the cost.", dots: ends },
    { say: "Least effort, ∫u² dt: a push that tapers smoothly into a brake (u falls in a straight line from 1.5 to −1.5).", curves: [xE, cE], dots: ends },
    { say: "But if the motor can give at most |u| ≤ 1, then 2 s is the fastest possible, and the only way is full push, then full brake (bang–bang).", curves: [{ pts: sample(energy, 0, 2), s: "dim" }, xB, cB], dots: ends },
  ]);
}

function mpcScene() {
  const ax = { x: [0, 7], y: [0, 3.6], xl: "time (s)", yl: "position y", xt: [0, 2, 4, 6], yt: [0, 1, 2, 3] };
  const H = 1.5, umax = 0.8, ref = 3, dt = 0.05;
  const plan = (t0, y0) => sample(t => Math.min(ref, y0 + umax * (t - t0)), t0, t0 + H, 30);
  let y = 0; const hist = [[0, 0]], snaps = {};
  for (let i = 1; i <= 140; i++) {
    const t = i * dt;
    if (i === 40) y -= 0.7; // a push from outside, at t = 2
    y = Math.min(ref, y + Math.max(-umax, Math.min(umax, (ref - y) / dt)) * dt);
    hist.push([t, y]);
    if (i === 20 || i === 40) snaps[i / 20] = { y, h: hist.slice() };
  }
  const win = t0 => ({ hi: [[t0, 3.6], [t0 + H, 3.6]], lo: [[t0, 0], [t0 + H, 0]], a: 0.08, s: "grey" });
  const tgt = [{ v: ref, label: "target" }];
  return pscene("Model predictive control", ax, [
    { say: `At t = 0, MPC uses the model to plan the best moves over the next ${H} s (shaded), within the limit |speed| ≤ ${umax}.`, curves: [{ pts: plan(0, 0), s: "on", dash: true, label: "plan", lx: 1 }], bands: [win(0)], hlines: tgt },
    { say: "It applies only the first move, then re-plans from where it actually is. The window slides forward: a receding horizon.", curves: [{ pts: snaps[1].h, s: "ink" }, { pts: plan(1, snaps[1].y), s: "on", dash: true }], bands: [win(1)], hlines: tgt },
    { say: "At t = 2 something pushes it back. No special handling: the next plan just starts from the new state.", curves: [{ pts: snaps[2].h, s: "ink" }, { pts: plan(2, snaps[2].y), s: "on", dash: true }], bands: [win(2)], hlines: tgt },
    { say: "Planning repeatedly with constraints built in is MPC's strength. Its cost: solving an optimisation every time step.", curves: [{ pts: hist, s: "ink" }], hlines: tgt },
  ]);
}

function flatnessScene() {
  const T = 8, X = t => 1 + 8 * t / T, Yf = t => 2.9 + 1.5 * Math.sin(2 * Math.PI * t / T);
  const dX = () => 8 / T, dY = t => 1.5 * (2 * Math.PI / T) * Math.cos(2 * Math.PI * t / T), ddY = t => -1.5 * (2 * Math.PI / T) ** 2 * Math.sin(2 * Math.PI * t / T);
  const path = Array.from({ length: 101 }, (_, i) => [X(i / 100 * T), Yf(i / 100 * T)]);
  const ts = Array.from({ length: 9 }, (_, i) => i * T / 8);
  const v = t => Math.hypot(dX(t), dY(t)), w = t => (dX(t) * ddY(t)) / (v(t) ** 2); // ẍ = 0 here
  const head = (t, len) => { const th = Math.atan2(dY(t), dX(t)); return { x0: X(t), y0: Yf(t), x1: X(t) + len * Math.cos(th), y1: Yf(t) + len * Math.sin(th), s: "hot", w: 3 }; };
  const vmax = Math.max(...ts.map(v)), wmax = Math.max(...ts.map(t => Math.abs(w(t))));
  return Object.assign({ kind: "plot", title: "Differential flatness", frames: [
    { say: "A car-like robot has 3 states (x, y, heading) and 2 inputs (speed, turn rate). Pick any smooth path for just x(t) and y(t), over 8 seconds.", curves: [{ pts: path, s: "on" }] },
    { say: "The heading must point along the path, so it follows from the derivatives: θ = atan2(ẏ, ẋ).", curves: [{ pts: path, s: "dim" }], arrows: ts.map(t => head(t, 0.7)) },
    { say: `So do the inputs: speed v = √(ẋ² + ẏ²) (arrow length, up to ${vmax.toFixed(2)} m/s) and turn rate ω = (ẋÿ − ẏẍ)/v² (up to ${wmax.toFixed(2)} rad/s). No simulation needed: x and y are flat outputs.`, curves: [{ pts: path, s: "dim" }], arrows: ts.map(t => head(t, 0.6 * v(t))),
      texts: [[2, 0.55, "start"], [4, -0.75, "middle"]].map(([t, dy]) => ({ x: X(t), y: Yf(t) + dy, t: `v ${v(t).toFixed(2)}, ω ${(Math.abs(w(t)) < 0.005 ? 0 : w(t)).toFixed(2)}`, size: 11.5 })) },
  ] }, BOX);
}

function latticeScene() {
  const obs = [[4.2, 0, 5.2, 3.1], [6.6, 3.0, 7.6, 5.8]], goal = [9, 4.8], start = [0.8, 1.0, 0.5];
  const kap = [-0.7, -0.35, 0, 0.35, 0.7];
  const free = ([x, y]) => x > 0.1 && x < 9.9 && y > 0.1 && y < 5.7 && obs.every(([a, b, c, d]) => x < a - 0.18 || x > c + 0.18 || y < b - 0.18 || y > d + 0.18);
  const prim = (p, k) => { const pts = [[p[0], p[1]]]; let [x, y, th] = p; for (let i = 0; i < 15; i++) { th += k * 0.1; x += Math.cos(th) * 0.1; y += Math.sin(th) * 0.1; pts.push([x, y]); } return { pts, end: [x, y, th] }; };
  const keyOf = ([x, y, th]) => [Math.round(x / 0.45), Math.round(y / 0.45), Math.round((((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 8)) % 16].join(",");
  const open = [{ p: start, g: 0, f: Math.hypot(goal[0] - start[0], goal[1] - start[1]), arcs: [] }], seen = new Set([keyOf(start)]), tried = [];
  let best = null;
  for (let it = 0; it < 4000 && open.length && !best; it++) {
    open.sort((a, b) => a.f - b.f);
    const n = open.shift();
    for (const k of kap) {
      const pr = prim(n.p, k);
      if (!pr.pts.every(free)) continue;
      tried.push(pr.pts);
      const kk = keyOf(pr.end); if (seen.has(kk)) continue; seen.add(kk);
      const m = { p: pr.end, g: n.g + 1.5, arcs: n.arcs.concat([pr.pts]) };
      m.f = m.g + Math.hypot(goal[0] - m.p[0], goal[1] - m.p[1]);
      if (Math.hypot(goal[0] - m.p[0], goal[1] - m.p[1]) < 0.6) { best = m; break; }
      open.push(m);
    }
  }
  const walls = obs.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, s: "wall" }));
  const ends = [{ x: start[0], y: start[1], s: "ink", r: 6, label: "start" }, { x: goal[0], y: goal[1], s: "good", r: 7, label: "goal", left: true }];
  const first = kap.map(k => ({ pts: prim(start, k).pts, s: "on", w: 2.5 }));
  return Object.assign({ kind: "plot", title: "Planning with dynamics", frames: [
    { say: "A car can't turn on the spot, so a path with sharp corners is useless to it. Plan with motions it can really make: from any pose, 5 short arcs of different curvature.", rects: walls, curves: first, dots: ends },
    { say: `Chain arcs end to end into a tree (a state lattice) and search it with A*, dropping any arc that would hit an obstacle. ${tried.length} arcs tried here.`, rects: walls, curves: tried.slice(0, 400).map(pts => ({ pts, s: "grey", w: 1.2 })), dots: ends },
    best
      ? { say: `The plan: ${best.arcs.length} arcs, smooth curvature, no corners. Drivable by construction, because it's built only from drivable pieces.`, rects: walls, curves: tried.slice(0, 400).map(pts => ({ pts, s: "dim", w: 1 })).concat(best.arcs.map(pts => ({ pts, s: "on", w: 3.5 }))), dots: ends }
      : { say: "Keep searching until an arc reaches the goal.", rects: walls, curves: tried.map(pts => ({ pts, s: "grey", w: 1.2 })), dots: ends },
  ] }, BOX);
}

function ilqrScene() {
  const N = 40, dt = 0.1, xt = 2.5, q = 1, r = 0.05, qf = 10, x0 = 0.3;
  const f = (x, u) => x + dt * (-2 * Math.sin(x) + u), fx = x => 1 - 2 * dt * Math.cos(x), fu = dt;
  const cost = (X, U) => U.reduce((a, u, k) => a + q * (X[k] - xt) ** 2 + r * u * u, 0) + qf * (X[N] - xt) ** 2;
  let U = Array(N).fill(0), X = [x0]; for (let k = 0; k < N; k++) X.push(f(X[k], U[k]));
  const hist = [{ X, c: cost(X, U) }];
  for (let it = 0; it < 10; it++) {
    let Vx = 2 * qf * (X[N] - xt), Vxx = 2 * qf; const kk = [], KK = [];
    for (let k = N - 1; k >= 0; k--) { // backward pass: a local LQR problem around the current trajectory
      const A = fx(X[k]), Qx = 2 * q * (X[k] - xt) + A * Vx, Qu = 2 * r * U[k] + fu * Vx, Qxx = 2 * q + A * A * Vxx, Quu = 2 * r + fu * fu * Vxx, Qux = fu * A * Vxx;
      kk[k] = -Qu / Quu; KK[k] = -Qux / Quu;
      Vx = Qx + KK[k] * Quu * kk[k] + KK[k] * Qu + Qux * kk[k];
      Vxx = Qxx + KK[k] * Quu * KK[k] + 2 * KK[k] * Qux;
    }
    let alpha = 1, nX = null, nU = null, nc = Infinity;
    for (let ls = 0; ls < 12; ls++) { // forward pass with a line search
      nX = [x0]; nU = [];
      for (let k = 0; k < N; k++) { const u = U[k] + alpha * kk[k] + KK[k] * (nX[k] - X[k]); nU.push(u); nX.push(f(nX[k], u)); }
      nc = cost(nX, nU); if (nc < hist[hist.length - 1].c) break; alpha /= 2;
    }
    if (!(nc < hist[hist.length - 1].c - 1e-6)) break;
    X = nX; U = nU; hist.push({ X, c: nc });
  }
  const tr = (h, s, label, lx) => ({ pts: h.X.map((x, k) => [k * dt, x]), s, label, lx });
  const ax = { x: [0, 4], y: [0, 3], xl: "time (s)", yl: "state x", xt: [0, 2, 4], yt: [0, 1, 2, 3] };
  const H = hist, L = H.length - 1, tgt = [{ v: xt, label: "target" }];
  return pscene("iLQR", ax, [
    { say: `Drive a nonlinear system (x′ = −2 sin x + u) to 2.5 and hold it there, cheaply. First guess: no control. It sags back towards 0 (cost ${H[0].c.toFixed(0)}).`, curves: [tr(H[0], "grey", "guess", 2)], hlines: tgt },
    { say: `iLQR linearises the dynamics and fits a quadratic cost around that trajectory, solves the resulting LQR problem backwards in time, then rolls the new controls forward on the real system. Cost ${H[0].c.toFixed(0)} → ${H[1].c.toFixed(1)}.`, curves: [tr(H[0], "dim"), tr(H[1], "visit", "iteration 1", 0.35)], hlines: tgt },
    { say: `Repeat around each new trajectory. After ${L} iterations it has converged (cost ${H[L].c.toFixed(2)}). DDP is the same idea but also keeps the dynamics' second derivatives.`, curves: [tr(H[0], "dim"), tr(H[1], "dim"), tr(H[L], "on", "converged", 0.9)], hlines: tgt },
  ]);
}

function ransacScene({ frontEnd = false } = {}) {
  const R = rng(17), shift = [5.0, -0.25], n = 12;
  const L = Array.from({ length: n }, () => [0.7 + R() * 3.5, 0.9 + R() * 4.2]);
  const Rt = L.map(([x, y]) => [x + shift[0] + 0.05 * randn(R), y + shift[1] + 0.05 * randn(R)]);
  const bad = new Set([2, 6, 9]);
  const match = L.map((p, i) => [p, bad.has(i) ? Rt[(i + 4) % n] : Rt[i]]);
  const agrees = (m, t) => Math.hypot(m[1][0] - m[0][0] - t[0], m[1][1] - m[0][1] - t[1]) < 0.3;
  let best = null, it = 0;
  for (; it < 20; it++) {
    const m = match[Math.floor(R() * n)], t = [m[1][0] - m[0][0], m[1][1] - m[0][1]], inl = match.filter(x => agrees(x, t)).length;
    if (!best || inl > best.inl) best = { t, inl };
  }
  const badHyp = (() => { const m = match[2]; const t = [m[1][0] - m[0][0], m[1][1] - m[0][1]]; return { m, inl: match.filter(x => agrees(x, t)) }; })();
  const panels = [{ x0: 0.3, y0: 0.4, x1: 4.6, y1: 5.4, s: "grey", label: "image 1" }, { x0: 5.4, y0: 0.4, x1: 9.7, y1: 5.4, s: "grey", label: "image 2" }];
  const kp = L.concat(Rt).map(([x, y]) => ({ x, y, s: "ink", r: 4 }));
  const lines = (pred, sIn, sOut) => match.map(m => ({ pts: m, s: pred(m) ? sIn : sOut, w: pred(m) ? 2 : 1.6, dash: !pred(m) && sOut === "hot" }));
  return Object.assign({ kind: "plot", title: frontEnd ? "The SLAM front end" : "Feature matching", frames: [
    { say: "A detector finds distinctive points (corners, blobs) in two images of the same scene, and describes the patch around each one.", rects: panels, dots: kp },
    { say: `Match points whose descriptors look most alike. Most matches are right; ${bad.size} are wrong, and one bad match can ruin an estimate.`, rects: panels, dots: kp, curves: lines(() => true, "grey", "grey") },
    { say: `RANSAC: pick a match at random and assume it's right. Here, a bad one: only ${badHyp.inl.length} ${badHyp.inl.length === 1 ? "match agrees" : "matches agree"} with the shift it implies.`, rects: panels, dots: kp, curves: lines(m => badHyp.inl.includes(m), "hot", "dim") },
    { say: `Try again, many times, and keep the hypothesis most matches agree with: ${best.inl} of ${n} after ${it} tries. The rest are outliers and are thrown away.${frontEnd ? " The front end hands these clean matches to the back end as constraints." : ""}`, rects: panels, dots: kp, curves: lines(m => agrees(m, best.t), "on", "hot") },
  ] }, BOX);
}

function calibrationScene() {
  const k1 = -0.18, C = [5, 2.9], S = 2.7;
  const distort = ([x, y]) => { const r2 = x * x + y * y, m = 1 + k1 * r2; return [x * m, y * m]; };
  const map = ([x, y]) => [C[0] + S * x, C[1] + S * y];
  const xs = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1], ys = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
  const line = (pts, fn, s, w = 2) => ({ pts: pts.map(p => map(fn(p))), s, w });
  const grid = (fn, s, w) => xs.map(x => line(sample(y => y, -0.75, 0.75, 30).map(([y]) => [x, y]), fn, s, w)).concat(ys.map(y => line(sample(x => x, -1, 1, 40).map(([x]) => [x, y]), fn, s, w)));
  const id = p => p, corners = []; xs.forEach(x => ys.forEach(y => corners.push([x, y])));
  return Object.assign({ kind: "plot", title: "Camera calibration", frames: [
    { say: "A flat checkerboard, as seen through a wide-angle lens: straight lines bow outwards (barrel distortion). Measurements off this image would be wrong.", curves: grid(distort, "ink") },
    { say: `Calibration: photograph a known checkerboard from many angles, find its corners, and solve for the intrinsics (focal length, image centre, distortion, here k₁ = ${k1} in x_d = x(1 + k₁r²)) that best explain where they appear.`, curves: grid(id, "dim", 1.5).concat(grid(distort, "ink")), dots: corners.map(p => { const [x, y] = map(distort(p)); return { x, y, s: "hot", r: 3 }; }) },
    { say: "Undo the distortion and straight lines are straight again. The extrinsics, the camera's position and rotation, then place it in the robot's frame.", curves: grid(id, "on") },
  ] }, BOX);
}

// "Where it connects": the stop and its real links on the map.
function egoScene(nodeId) {
  const D = window.BU_DATA, net = window.BU_METRO && BU_METRO.network();
  const byId = {}; D.NODES.forEach(n => { byId[n.id] = n; });
  const me = byId[nodeId]; if (!me) return null;
  const nbr = D.adjacencyOf(nodeId).filter(n => !n.kind).slice(0, 8);
  const lineOf = id => (net && byId[id] && net.lineOfCluster[byId[id].cluster]) || null;
  const nodes = { [nodeId]: [200, 120] }, labels = { [nodeId]: me.name }, colors = { [nodeId]: (lineOf(nodeId) || {}).color };
  nbr.forEach((n, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, nbr.length)) * Math.PI * 2;
    nodes[n.id] = [200 + Math.cos(a) * 150, 120 + Math.sin(a) * 72]; labels[n.id] = n.name; colors[n.id] = (lineOf(n.id) || {}).color;
  });
  const edges = nbr.map(n => [nodeId, n.id]);
  const same = nbr.filter(n => n.cluster === me.cluster), other = nbr.filter(n => n.cluster !== me.cluster);
  const L = lineOf(nodeId);
  const frames = [{ say: `${me.name}${L ? ", on the " + L.name + " line" : ""}. On the map it links to ${nbr.length === 1 ? "one other idea" : nbr.length + " other ideas"}.`, n: Object.assign(styleAll(nbr.map(n => n.id), "dim"), { [nodeId]: "line" }), e: styleAll(nbr.map(n => ekey(nodeId, n.id)), "dim") }];
  if (same.length) frames.push({ say: `It builds on ${same.length === 1 ? "an idea" : same.length + " ideas"} on its own line: ${same.map(n => n.name).join(", ")}.`, n: Object.assign({ [nodeId]: "line" }, styleAll(same.map(n => n.id), "line")), hide: other.map(n => n.id), e: styleAll(same.map(n => ekey(nodeId, n.id)), "on") });
  if (other.length) frames.push({ say: `And it links across to other topics: ${other.map(n => n.name).join(", ")}. Each is a place to change lines.`, n: styleAll(Object.keys(nodes), "line"), e: Object.assign(styleAll(same.map(n => ekey(nodeId, n.id)), "on"), styleAll(other.map(n => ekey(nodeId, n.id)), "hot")) });
  if (!nbr.length) frames[0].say = `${me.name}${L ? ", on the " + L.name + " line" : ""}. It has no recorded links yet: a frontier of the map.`;
  return { kind: "graph", title: "Where it connects", nodes, edges, labels, colors, outerLabels: true, frames };
}

const SCENES = {
  spanning_tree: () => spanningTreeScene(),
  Minimum_Spanning_Tree_MST: mstScene, Minimum_Spanning_Tree: mstScene,
  "breadth-first_search_BFS": () => bfsScene(), BFS_tree: () => bfsScene({ treeOnly: true, g: T7, root: "r", title: "A BFS tree" }),
  distributed_graph_algorithms: () => roundsScene({ mode: "tree" }), Distributed_algorithms: () => roundsScene({ mode: "flood" }),
  CONGEST_model: () => roundsScene({ mode: "congest" }),
  Rooted_tree_structure: rootedTreeScene, convergecast: convergecastScene,
  interval_allocation_procedure: intervalScene, "Thorup-Zwicks_tree_routing_scheme": treeRoutingScene,
  fundamental_cycle: fundamentalCycleScene, graph_diameter: diameterScene, planar_graph: planarScene,
  tree_decomposition: () => treeDecompScene(), Treewidth: () => treeDecompScene({ width: true }),
  graph_coloring: coloringScene, Vertex_Cover: () => vertexCoverScene(), Approximation_algorithms: () => vertexCoverScene({ approx: true }),
  independent_set: () => independentSetScene(), independent_sets: () => independentSetScene(), conflict_graph: () => independentSetScene({ conflict: true }),
  Directed_acyclic_graph_DAG: dagScene, arborescence: arborescenceScene, ultrabubble: bubbleScene, biedged_graph: biedgedScene,
  power_graph: powerGraphScene, spanner: spannerScene, "twin-width": twinWidthScene, "Bellman-Ford_algorithm": bellmanFordScene,
  Four_Color_Theorem: fourColorScene, Kempe_chains: kempeScene, degree_range: degreeScene,
  "flow-cut_gap": () => flowCutScene({ mode: "gap" }), fractional_cut: () => flowCutScene({ mode: "fractional" }),
  "edge-capacitated_setting": () => flowCutScene({ mode: "edge" }), "vertex-capacitated_setting": vertexCapScene, "vertex-weighted_distance": vertexWeightedScene,
  Scan: scanScene, Reduce: reduceScene, Filter: filterScene, Partition: partitionScene, Comparison_sort: sortScene,
  occurrence_list: occurrenceScene, direct_access_queries: directAccessScene, constant_delay_enumeration: constantDelayScene, Streaming_algorithms: streamingScene,
  randomized_rounding: roundingScene, concentration_inequalities: concentrationScene, PAC_learning: pacScene, Halfspace_approximation: halfspaceScene,
  parameterized_complexity: paramScene,
  State_space_model: stateSpaceScene, Kalman_filter: kalmanScene, Lyapunov_stability: lyapunovScene, Sensor_fusion: fusionScene, Observability: observabilityScene,
  "NP-hardness_reduction": npReductionScene,
  Probability: probabilityScene, Measurement_noise_models: beamModelScene, Probabilistic_motion_and_sensor_models: motionModelScene,
  Recursive_Bayes_filter: () => histogramScene({ title: "Recursive Bayes filter", bayes: true }), Discrete_histogram_filter: () => histogramScene(),
  Particle_filter: () => particleScene(), Monte_Carlo_localization: () => particleScene({ mcl: true }),
  EKF_localization: () => ekfLocScene(), EKF_SLAM: () => ekfLocScene({ slam: true }), EKF_and_UKF: ekfUkfScene, Linearization: linearizationScene,
  LQR: lqrScene, PID_control: pidScene, Model_predictive_control: mpcScene, Optimal_control_problems: () => optControlScene(),
  Indirect_methods_and_Pontryagin: () => optControlScene({ mode: "pontryagin" }), Direct_methods_and_transcription: () => optControlScene({ mode: "transcription" }),
  Numerical_integration_and_simulation: integrationScene, Ordinary_differential_equation: odeScene, Kinematic_vs_dynamic_models: kinDynScene,
  "Graph_search_and_A-star": astarScene, Potential_field_methods: potentialScene, "Sampling-based_planning_PRM_RRT": rrtScene, Configuration_space: cspaceScene,
  Nonholonomic_wheeled_robots: nonholonomicScene, Trajectory_tracking: trackingScene,
  Pinhole_camera_model: pinholeScene, Stereo_depth_and_triangulation: stereoScene, Point_cloud_registration_ICP: icpScene,
  Visual_odometry_and_loop_closure: () => loopClosureScene(), "Graph_and_factor-graph_SLAM": () => loopClosureScene({ slam: true }),
  Image_filtering_and_convolution: () => convolutionScene(), Convolutional_neural_networks: () => convolutionScene({ cnn: true }),
  Object_detection_and_recognition: () => detectScene(), "3D_object_detection": () => detectScene({ threeD: true }),
  Object_tracking_and_data_association: assocScene, Semantic_and_instance_segmentation: segmentationScene, Point_cloud_and_voxel_networks: voxelScene,
  Neural_network: neuralNetScene, Attention_and_vision_transformers: attentionScene, Linear_algebra: linAlgScene, Numerical_optimization: gdScene,
  dynamic_programming: () => valueIterScene({ dp: true }), Value_and_policy_iteration: () => valueIterScene(), Markov_decision_processes: mdpScene,
  reinforcement_learning: rlLoopScene, "Value-based_RL_Q-learning": qLearningScene, Monte_Carlo_and_TD_learning: mcTdScene,
  "Policy_gradients_and_actor-critic": policyGradScene, "Model-based_RL_and_system_ID": sysIdScene,
  Behavior_cloning: () => bcScene(), Covariate_shift: () => bcScene({ shift: true }),
  Autonomy_software_stack: stackScene, Finite_state_machines: fsmScene,
  Robot_sensors: beamModelScene, Differential_flatness: flatnessScene, Planning_with_dynamics: latticeScene, ILQR_and_DDP: ilqrScene,
  Feature_detection_and_matching: () => ransacScene(), SLAM_front_end: () => ransacScene({ frontEnd: true }), Intrinsics_extrinsics_and_calibration: calibrationScene,
  Boundary_layer: boundaryLayerScene, Compressible_flow: compressibleScene, Reynolds_number: reynoldsScene, Lift_coefficient: liftScene, Drag_polar: dragPolarScene,
};
const _sceneCache = {};
function sceneFor(nodeId) {
  if (!(nodeId in _sceneCache)) {
    let s = null;
    try { s = SCENES[nodeId] ? SCENES[nodeId]() : egoScene(nodeId); } catch (e) { console.warn("[visuals]", nodeId, e); s = null; }
    _sceneCache[nodeId] = s;
  }
  return _sceneCache[nodeId];
}

// ─── rendering a frame to SVG ─────────────────────────────────────
// Text on a filled accent: white on dark line colours, ink on light ones.
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#ffffff";
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(m[1], 16), L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? "#14171a" : "#ffffff";
}
// Highlights are red, except on red-ish lines, where they turn blue so they still stand out.
function hotFor(accent) {
  const m = /^#?([0-9a-f]{6})$/i.exec(accent || ""); if (!m) return "#d4351c";
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return r > 150 && g < 130 && b < 130 ? "#1d70b8" : "#d4351c";
}
function mixHex(a, b, t) { // t = 0 → a, 1 → b
  const p = h => { const n = parseInt(h.replace("#", ""), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function nodeColors(s, accent, sceneColor) {
  if (s && s[0] === "c" && PAL[+s.slice(1)]) return [PAL[+s.slice(1)], PAL[+s.slice(1)], PAL_INK[+s.slice(1)]];
  const hot = hotFor(accent);
  switch (s) {
    case "on": return [accent, accent, inkOn(accent)];
    case "line": return [sceneColor || accent, sceneColor || accent, inkOn(sceneColor || accent)];
    case "dim": return ["#ffffff", "#cfd3cc", "#9aa0a6"];
    case "visit": return ["#fff1cc", "#c8801a", "#14171a"];
    case "hot": return [hot, hot, "#ffffff"];
    case "good": return ["#00703c", "#00703c", "#ffffff"];
    case "ink": return ["#14171a", "#14171a", "#ffffff"];
    default: return ["#ffffff", "#14171a", "#14171a"];
  }
}
function edgeStyle(s, accent) {
  const hot = hotFor(accent);
  switch (s) {
    case "on": return [accent, 6];
    case "dim": return ["#e3e5e1", 2.5];
    case "hot": return [hot, 6];
    case "good": return ["#00703c", 6];
    case "red": return ["#d4351c", 4]; // twin-width's red edges are red by definition
    case "new": return [accent, 3, "6 5"];
    case "cut": return [hot, 4, "7 5"];
    case "flow": return ["#1d70b8", 5];
    case "ink": return ["#14171a", 6];
    case "grey": return ["#9aa0a6", 4];
    default: return ["#9aa0a6", 3];
  }
}
function wrap2(text, max = 16) {
  const t = String(text);
  if (t.length <= max) return [t];
  const cut = t.lastIndexOf(" ", max);
  const a = cut > 4 ? t.slice(0, cut) : t.slice(0, max), b = t.slice(a.length).trim();
  return [a, b.length > max ? b.slice(0, max - 1) + "…" : b];
}
function arrowHead(x, y, tx, ty, col, size = 11) {
  const hx = -ty * size * 0.55, hy = tx * size * 0.55, bx = x - tx * size, by = y - ty * size;
  return `<polygon points="${x.toFixed(1)},${y.toFixed(1)} ${(bx + hx).toFixed(1)},${(by + hy).toFixed(1)} ${(bx - hx).toFixed(1)},${(by - hy).toFixed(1)}" fill="${col}"/>`;
}
function graphSVG(sc, f, accent, posOverride) {
  const pos = posOverride || Object.assign({}, sc.nodes, f.pos || {});
  const hidden = new Set(f.hide || []);
  const labelOf = id => (sc.labels || {})[id] || id;
  const r = sc.smallNodes || sc.outerLabels ? 9 : NODE_R, BH = 30;
  const bw = id => Math.max(46, labelOf(id).length * 7.6 + 20);
  const extent = (id, ux, uy) => {
    if (!sc.boxNodes) return r;
    const hw = bw(id) / 2 + 1, hh = BH / 2 + 1;
    return Math.min(Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : Infinity);
  };
  const out = [];
  (f.box || []).forEach(b => {
    const pad = b.pad || 24, ps = b.ids.map(id => pos[id]), xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad, w = Math.max(...xs) - x + pad, h = Math.max(...ys) - y + pad;
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${accent}" fill-opacity="0.1" stroke="${accent}" stroke-width="2" stroke-dasharray="5 4"/>`);
    if (b.label) out.push(`<text x="${x + 8}" y="${y - 6}" font-size="12" font-weight="700" fill="${accent}">${esc(b.label)}</text>`);
  });
  (f.items || []).forEach(it => {
    if (it.kind === "bag") {
      const on = it.s === "on";
      out.push(`<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="10" fill="${on ? accent : "#ffffff"}" fill-opacity="${on ? 0.14 : 1}" stroke="${on ? accent : "#14171a"}" stroke-width="2.5"/>`);
      out.push(`<text x="${it.x + it.w / 2}" y="${it.y + it.h / 2 + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#14171a">${esc(it.label)}</text>`);
    } else if (it.kind === "vline") out.push(`<line x1="${it.x}" y1="${it.y1}" x2="${it.x}" y2="${it.y2}" stroke="#14171a" stroke-width="2.5"/>`);
  });
  const allEdges = sc.edges.map(([a, b, w]) => ({ a, b, w, key: ekey(a, b, sc.directed), s: (f.e || {})[ekey(a, b, sc.directed)], dir: sc.directed, curve: (sc.curves || {})[ekey(a, b, sc.directed)] }))
    .concat((f.add || []).map(x => ({ a: x.a, b: x.b, key: ekey(x.a, x.b, x.dir), s: x.s, dir: x.dir, curve: x.curve })));
  const labels = [];
  allEdges.forEach(ed => {
    if (hidden.has(ed.a) || hidden.has(ed.b)) return;
    const [x1, y1] = pos[ed.a], [x2, y2] = pos[ed.b];
    if (Math.hypot(x2 - x1, y2 - y1) < 1) return;
    const [col, wid, dash] = edgeStyle(ed.s, accent);
    const da = dash ? ` stroke-dasharray="${dash}"` : "";
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    // control point (straight edges: the midpoint)
    const qx = (x1 + x2) / 2 - uy * (ed.curve || 0), qy = (y1 + y2) / 2 + ux * (ed.curve || 0);
    let tx = ux, ty = uy;
    if (ed.curve) { const tl = Math.hypot(x2 - qx, y2 - qy); tx = (x2 - qx) / tl; ty = (y2 - qy) / tl; }
    const ext = ed.dir ? extent(ed.b, tx, ty) + 3 : 0, ex = x2 - tx * ext, ey = y2 - ty * ext;
    const lx = ed.dir ? ex - tx * 8 : ex, ly = ed.dir ? ey - ty * 8 : ey;
    if (ed.curve) out.push(`<path d="M${x1} ${y1} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${wid}"${da} stroke-linecap="round"/>`);
    else out.push(`<line x1="${x1}" y1="${y1}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${col}" stroke-width="${wid}"${da} stroke-linecap="round"/>`);
    if (ed.dir) out.push(arrowHead(ex, ey, tx, ty, col === "#e3e5e1" ? "#cfd3cc" : col));
    const lab = (f.el || {})[ed.key] || ((f.showW || sc.showW) && ed.w != null ? String(ed.w) : "");
    if (lab) {
      const t = sc.elT || 0.5;
      let mx, my;
      if (ed.curve) { mx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * qx + t * t * x2; my = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * qy + t * t * y2; }
      else { mx = x1 + dx * t - uy * 11; my = y1 + dy * t + ux * 11; }
      labels.push([mx, my, lab]);
    }
  });
  labels.forEach(([mx, my, lab]) => {
    const tw = String(lab).length * 6.8 + 8;
    out.push(`<rect x="${(mx - tw / 2).toFixed(1)}" y="${(my - 10).toFixed(1)}" width="${tw.toFixed(1)}" height="19" rx="5" fill="#ffffff" stroke="#e3e5e1"/>`);
    out.push(`<text x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#14171a">${esc(lab)}</text>`);
  });
  (f.pk || []).forEach(([a, b, lab, at]) => {
    const t = at == null ? 0.55 : at;
    const [x1, y1] = pos[a], [x2, y2] = pos[b], x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t, tw = Math.max(20, String(lab).length * 7 + 10);
    out.push(`<rect x="${x - tw / 2}" y="${y - 10}" width="${tw}" height="20" rx="10" fill="#14171a"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#ffffff">${esc(lab)}</text>`);
  });
  const first = Object.keys(sc.nodes)[0];
  Object.keys(sc.nodes).forEach(id => {
    if (hidden.has(id)) return;
    const [x, y] = pos[id], s = (f.n || {})[id];
    const [fill, stroke, ink] = nodeColors(s, accent, sc.colors && sc.colors[id]);
    if (sc.boxNodes) {
      const w = bw(id);
      out.push(`<rect x="${(x - w / 2).toFixed(1)}" y="${y - BH / 2}" width="${w.toFixed(1)}" height="${BH}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`);
      out.push(`<text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${ink}">${esc(labelOf(id))}</text>`);
    } else {
      out.push(`<circle cx="${x}" cy="${y}" r="${sc.outerLabels && id === first ? 13 : r}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`);
      if (!sc.smallNodes && !sc.outerLabels) out.push(`<text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${ink}">${esc(id)}</text>`);
      if (sc.smallNodes) out.push(`<text x="${x}" y="${y + 26}" text-anchor="middle" font-size="12" font-weight="700" fill="#14171a">${esc(id)}</text>`);
      if (sc.outerLabels) {
        const lines = wrap2(labelOf(id), 18), below = y >= 120 || id === first;
        lines.forEach((ln, i) => out.push(`<text x="${x}" y="${below ? y + 23 + i * 13 : y - 15 - (lines.length - 1 - i) * 13}" text-anchor="middle" font-size="12" font-weight="${id === first ? 700 : 600}" fill="#14171a" paint-order="stroke" stroke="#ffffff" stroke-width="4">${esc(ln)}</text>`));
      }
    }
    const sub = (f.nl || {})[id];
    if (sub) {
      const half = sc.boxNodes ? BH / 2 : r, below = y < 205, ty = below ? y + half + 15 : y - half - 7;
      out.push(`<text x="${x}" y="${ty}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#51575e" paint-order="stroke" stroke="#ffffff" stroke-width="4">${esc(sub)}</text>`);
    }
  });
  return out.join("");
}
function cellColors(s, accent) {
  if (s && s[0] === "c" && PAL[+s.slice(1)]) return [PAL[+s.slice(1)], PAL[+s.slice(1)], PAL_INK[+s.slice(1)]];
  const hot = hotFor(accent);
  switch (s) {
    case "on": return [accent, accent, inkOn(accent)];
    case "soft": return [mixHex(accent, "#ffffff", 0.8), mixHex(accent, "#ffffff", 0.45), "#14171a"];
    case "dim": return ["#f4f5f2", "#e3e5e1", "#9aa0a6"];
    case "visit": return ["#fff1cc", "#c8801a", "#14171a"];
    case "hot": return [hot, hot, "#ffffff"];
    case "good": return ["#00703c", "#00703c", "#ffffff"];
    case "wall": case "ink": return ["#14171a", "#14171a", "#ffffff"];
    default: return ["#ffffff", "#14171a", "#14171a"];
  }
}
function arraySVG(sc, f, accent) {
  const rows = f.rows || [], n = Math.max(1, ...rows.map(r => r.cells.length)), out = [];
  const cell = (x, y, w, h, c) => {
    if (c.s === "blank") return;
    let [fill, stroke, ink] = cellColors(c.s, accent);
    if (c.a != null) { fill = mixHex("#ffffff", accent, Math.max(0, Math.min(1, c.a))); stroke = c.a > 0.04 ? accent : "#e3e5e1"; ink = inkOn(fill); }
    out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${sc.grid ? 3 : 5}" fill="${fill}" stroke="${stroke}" stroke-width="${sc.grid ? 1.5 : 2.5}"/>`);
    const t = c.v == null ? "" : String(c.v);
    if (t) {
      const fs = Math.max(7.5, Math.min(sc.grid ? h * 0.42 : 14, (w - 5) / (0.6 * t.length)));
      out.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + fs * 0.36).toFixed(1)}" text-anchor="middle" font-size="${fs.toFixed(1)}" font-weight="700" fill="${ink}">${esc(t)}</text>`);
    }
  };
  if (sc.grid) {
    const cs = Math.floor(Math.min((VW - 12) / n, (VH - 12) / rows.length)), x0 = (VW - cs * n) / 2, y0 = (VH - cs * rows.length) / 2;
    rows.forEach((r, ri) => r.cells.forEach((c, ci) => cell(x0 + ci * cs + 1.5, y0 + ri * cs + 1.5, cs - 3, cs - 3, c)));
    return out.join("");
  }
  const gap = 4, lw = rows.some(r => r.label) ? 70 : 0, rh = 46;
  const wide = rows.some(r => r.cells.some(c => String(c.v).length > 3));
  const w = Math.min(wide ? 44 : 36, Math.floor((VW - lw - 12) / n) - gap);
  const total = lw + n * (w + gap) - gap, x0 = Math.max(4, (VW - total) / 2), y0 = Math.max(10, (VH - rows.length * rh) / 2);
  rows.forEach((r, ri) => {
    const y = y0 + ri * rh;
    if (r.label) out.push(`<text x="${x0 + lw - 10}" y="${y + 21}" text-anchor="end" font-size="12" font-weight="700" fill="#51575e">${esc(r.label)}</text>`);
    r.cells.forEach((c, ci) => cell(x0 + lw + ci * (w + gap), y, w, 34, c));
  });
  return out.join("");
}
function plotSVG(sc, f, accent) {
  const hot = hotFor(accent), box = sc.frame === "box";
  const L = box ? 10 : 52, R = box ? 10 : 14, T = box ? 10 : 12, B = box ? 10 : 34, w = VW - L - R, h = VH - T - B;
  const X = x => L + (x - sc.x[0]) / (sc.x[1] - sc.x[0]) * w, Y = y => T + h - (y - sc.y[0]) / (sc.y[1] - sc.y[0]) * h;
  const cy = y => Math.max(sc.y[0], Math.min(sc.y[1], y)), cx = x => Math.max(sc.x[0], Math.min(sc.x[1], x));
  const P = (x, y) => `${X(cx(x)).toFixed(1)},${Y(cy(y)).toFixed(1)}`;
  const colOf = s => (s === "on" ? accent : s === "hot" ? hot : s === "visit" ? "#c8801a" : s === "dim" ? "#cfd3cc" : s === "good" ? "#00703c" : s === "grey" ? "#9aa0a6" : "#14171a");
  const fmt = v => String(Math.round(v * 100) / 100).replace("-", "−");
  const out = [];
  if (box) out.push(`<rect x="${L}" y="${T}" width="${w}" height="${h}" rx="6" fill="#fafaf8" stroke="#e3e5e1" stroke-width="1.5"/>`);
  else {
    out.push(`<line x1="${L}" y1="${T + h}" x2="${L + w}" y2="${T + h}" stroke="#14171a" stroke-width="2"/>`, `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + h}" stroke="#14171a" stroke-width="2"/>`);
    out.push(`<text x="${L + w / 2}" y="${VH - 5}" text-anchor="middle" font-size="12" fill="#51575e">${esc(sc.xl || "")}</text>`);
    out.push(`<text x="12" y="${T + h / 2}" text-anchor="middle" font-size="12" fill="#51575e" transform="rotate(-90 12 ${T + h / 2})">${esc(sc.yl || "")}</text>`);
    if (!sc.noTicks) {
      (sc.xt || [sc.x[0], (sc.x[0] + sc.x[1]) / 2, sc.x[1]]).forEach(v => out.push(`<line x1="${X(v)}" y1="${T + h}" x2="${X(v)}" y2="${T + h + 4}" stroke="#14171a" stroke-width="1.5"/><text x="${X(v)}" y="${T + h + 15}" text-anchor="middle" font-size="10.5" fill="#51575e">${esc(fmt(v))}</text>`));
      (sc.yt || [sc.y[0], sc.y[1]]).forEach(v => out.push(`<line x1="${L - 4}" y1="${Y(v)}" x2="${L}" y2="${Y(v)}" stroke="#14171a" stroke-width="1.5"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end" font-size="10.5" fill="#51575e">${esc(fmt(v))}</text>`));
    }
  }
  (f.rects || []).forEach(r => {
    const x0 = X(cx(Math.min(r.x0, r.x1))), x1 = X(cx(Math.max(r.x0, r.x1))), y0 = Y(cy(Math.max(r.y0, r.y1))), y1 = Y(cy(Math.min(r.y0, r.y1)));
    const col = r.s === "wall" ? "#14171a" : colOf(r.s);
    const fo = r.a != null ? r.a : r.s === "wall" ? 0.85 : r.s === "grey" ? 0.25 : r.fill ? 0.14 : 0;
    out.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}" rx="${r.rx || 2}" fill="${col}" fill-opacity="${fo}" stroke="${r.a != null ? "none" : col}" stroke-width="${r.w || 2.5}"${r.dash ? ' stroke-dasharray="6 4"' : ""}/>`);
    if (r.label) out.push(`<text x="${(x0 + 5).toFixed(1)}" y="${(y0 - 5).toFixed(1)}" font-size="11.5" font-weight="700" fill="${col}" paint-order="stroke" stroke="#ffffff" stroke-width="4">${esc(r.label)}</text>`);
  });
  (f.bands || []).forEach(b => {
    const pts = b.hi.map(([x, y]) => P(x, y)).concat(b.lo.slice().reverse().map(([x, y]) => P(x, y)));
    out.push(`<polygon points="${pts.join(" ")}" fill="${b.s ? colOf(b.s) : accent}" fill-opacity="${b.a || 0.16}"/>`);
  });
  (f.hlines || []).forEach(l => { out.push(`<line x1="${L}" y1="${Y(l.v)}" x2="${L + w}" y2="${Y(l.v)}" stroke="#9aa0a6" stroke-width="1.5" stroke-dasharray="5 4"/>`); if (l.label) out.push(`<text x="${L + w - 4}" y="${Y(l.v) - 5}" text-anchor="end" font-size="11.5" font-weight="700" fill="#51575e">${esc(l.label)}</text>`); });
  (f.vlines || []).forEach(l => { out.push(`<line x1="${X(l.v)}" y1="${T}" x2="${X(l.v)}" y2="${T + h}" stroke="#9aa0a6" stroke-width="1.5" stroke-dasharray="5 4"/>`); if (l.label) out.push(`<text x="${X(l.v) + 4}" y="${T + 12}" font-size="11.5" font-weight="700" fill="#51575e">${esc(l.label)}</text>`); });
  const [y0, y1] = sc.y, inside = p => p[1] >= y0 - 1e-9 && p[1] <= y1 + 1e-9;
  const clipRuns = pts => { // split a polyline where it leaves the y range, ending each piece on the edge
    const runs = []; let run = [];
    const at = (q, p, y) => { const t = (y - q[1]) / (p[1] - q[1]); return [q[0] + (p[0] - q[0]) * t, y]; };
    const edge = p => (p[1] > y1 ? y1 : y0);
    pts.forEach((p, i) => {
      if (!i) { if (inside(p)) run.push(p); return; }
      const q = pts[i - 1], a = inside(q), b = inside(p);
      if (a && b) run.push(p);
      else if (a) { run.push(at(q, p, edge(p))); runs.push(run); run = []; }
      else if (b) run = [at(q, p, edge(q)), p];
      else if (edge(p) !== edge(q)) runs.push([at(q, p, edge(q)), at(q, p, edge(p))]);
    });
    if (run.length) runs.push(run);
    return runs.filter(r => r.length > 1);
  };
  (f.curves || []).forEach(c => {
    const pts = c.pts.filter(p => isFinite(p[1]));
    if (!pts.length) return;
    const col = colOf(c.s), wd = c.w || (c.s === "dim" ? 2 : 3), da = c.dash ? ' stroke-dasharray="6 4"' : "";
    if (c.fill) out.push(`<polygon points="${pts.map(([x, y]) => P(x, y)).join(" ")}" fill="${col}" fill-opacity="${c.fill}" stroke="${col}" stroke-width="${wd}"${da} stroke-linejoin="round"/>`);
    else clipRuns(pts).forEach(run => out.push(`<polyline points="${run.map(([x, y]) => P(x, y)).join(" ")}" fill="none" stroke="${col}" stroke-width="${wd}"${da} stroke-linejoin="round" stroke-linecap="round"/>`));
    if (c.label) {
      let k = Math.floor(pts.length * 0.62);
      if (c.lx != null) { let bd = Infinity; pts.forEach((p, i) => { const d = Math.abs(p[0] - c.lx) + (inside(p) ? 0 : 1e6); if (d < bd) { bd = d; k = i; } }); }
      const [lx, ly] = pts[k];
      out.push(`<text x="${(X(cx(lx)) + 6).toFixed(1)}" y="${(Y(cy(ly)) - 7).toFixed(1)}" font-size="11.5" font-weight="700" fill="${col}" paint-order="stroke" stroke="#ffffff" stroke-width="4">${esc(c.label)}</text>`);
    }
  });
  (f.arrows || []).forEach(a => {
    const col = colOf(a.s), x1 = X(a.x0), y1 = Y(a.y0), x2 = X(a.x1), y2 = Y(a.y1), d = Math.hypot(x2 - x1, y2 - y1);
    if (d < 2) return;
    const tx = (x2 - x1) / d, ty = (y2 - y1) / d, hs = a.head || 9;
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x2 - tx * hs * 0.8).toFixed(1)}" y2="${(y2 - ty * hs * 0.8).toFixed(1)}" stroke="${col}" stroke-width="${a.w || 2.5}"${a.dash ? ' stroke-dasharray="5 4"' : ""} stroke-linecap="round"/>`);
    out.push(arrowHead(x2, y2, tx, ty, col, hs));
    if (a.label) out.push(`<text x="${(x2 + 6).toFixed(1)}" y="${(y2 - 6).toFixed(1)}" font-size="11.5" font-weight="700" fill="${col}" paint-order="stroke" stroke="#ffffff" stroke-width="4">${esc(a.label)}</text>`);
  });
  (f.dots || []).forEach(d => {
    const col = colOf(d.s), r = d.r || (d.s === "hot" ? 6 : 4.5);
    out.push(`<circle cx="${X(d.x).toFixed(1)}" cy="${Y(cy(d.y)).toFixed(1)}" r="${r}" fill="${d.s === "base" || d.hollow ? "#ffffff" : col}" stroke="${col}" stroke-width="${r < 3 ? 1 : 2}"/>`);
    if (d.label) out.push(`<text x="${(X(d.x) + (d.left ? -r - 4 : r + 4)).toFixed(1)}" y="${(Y(cy(d.y)) - r - 2).toFixed(1)}"${d.left ? ' text-anchor="end"' : ""} font-size="11.5" font-weight="700" fill="${d.s === "base" ? "#14171a" : col}" paint-order="stroke" stroke="#ffffff" stroke-width="4">${esc(d.label)}</text>`);
  });
  (f.texts || []).forEach(t => out.push(`<text x="${X(t.x).toFixed(1)}" y="${Y(t.y).toFixed(1)}" text-anchor="${t.anchor || "middle"}" font-size="${t.size || 12}" font-weight="${t.weight || 700}" fill="${t.s ? colOf(t.s) : "#14171a"}" paint-order="stroke" stroke="#ffffff" stroke-width="4">${esc(t.t)}</text>`));
  return out.join("");
}
function svgFor(sc, i, accent = "#d4351c", posOverride, size) {
  const f = sc.frames[Math.max(0, Math.min(sc.frames.length - 1, i))] || {};
  const body = sc.kind === "graph" ? graphSVG(sc, f, accent, posOverride) : sc.kind === "array" ? arraySVG(sc, f, accent) : plotSVG(sc, f, accent);
  const dims = size ? ` width="${size[0]}" height="${size[1]}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}"${dims} font-family="${VFONT}" role="presentation">${body}</svg>`;
}
function dataUrlFor(sc, i, accent) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgFor(sc, i, accent, null, [VW * 2, VH * 2]));
}

// ─── the player ───────────────────────────────────────────────────
const { useState: useVState, useEffect: useVEffect, useRef: useVRef } = React;
function Visual({ scene, accent = "#d4351c", autoplay = true, compact = false }) {
  const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [i, setI] = useVState(0);
  const [playing, setPlaying] = useVState(autoplay && !reduce);
  const [tween, setTween] = useVState(null); // positions mid-move
  const prev = useVRef(0);
  const n = scene ? scene.frames.length : 0;
  useVEffect(() => { setI(0); prev.current = 0; setPlaying(autoplay && !reduce); }, [scene]);
  useVEffect(() => {
    if (!playing) return undefined;
    if (i >= n - 1) { setPlaying(false); return undefined; }
    const t = setTimeout(() => setI(x => x + 1), Math.max(2600, (scene.frames[i].say || "").length * 42));
    return () => clearTimeout(t);
  }, [playing, i, n]);
  // nodes that move between frames glide there
  useVEffect(() => {
    if (!scene || scene.kind !== "graph" || reduce) { prev.current = i; return undefined; }
    const from = Object.assign({}, scene.nodes, scene.frames[prev.current].pos || {}), to = Object.assign({}, scene.nodes, scene.frames[i].pos || {});
    prev.current = i;
    if (Object.keys(to).every(k => from[k][0] === to[k][0] && from[k][1] === to[k][1])) { setTween(null); return undefined; }
    let raf = 0; const t0 = performance.now();
    const tick = now => {
      const u = Math.min(1, (now - t0) / 700), e = u * u * (3 - 2 * u), p = {};
      Object.keys(to).forEach(k => { p[k] = [from[k][0] + (to[k][0] - from[k][0]) * e, from[k][1] + (to[k][1] - from[k][1]) * e]; });
      setTween(u < 1 ? p : null);
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, scene]);
  if (!scene) return null;
  const f = scene.frames[i];
  const go = d => { setPlaying(false); setI(x => Math.max(0, Math.min(n - 1, x + d))); };
  return (
    <figure className={"metro-visual" + (compact ? " compact" : "")}>
      <div className="metro-visual-fig" role="img" aria-label={`${scene.title}. Step ${i + 1} of ${n}: ${f.say}`}
           dangerouslySetInnerHTML={{ __html: svgFor(scene, i, accent, tween) }} />
      <figcaption>
        <p aria-live="polite">{f.say}</p>
        <div className="metro-visual-ctl">
          <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous step">‹</button>
          <button type="button" className="play" onClick={() => { if (i >= n - 1) { setI(0); setPlaying(true); } else setPlaying(p => !p); }}
                  aria-label={playing ? "Pause" : i >= n - 1 ? "Play again" : "Play"}>{playing ? "❚❚" : i >= n - 1 ? "↻" : "▶"}</button>
          <button type="button" onClick={() => go(1)} disabled={i >= n - 1} aria-label="Next step">›</button>
          <span className="metro-visual-dots" aria-hidden="true">{scene.frames.map((_, j) => <i key={j} className={j === i ? "on" : j < i ? "done" : ""} />)}</span>
          <span className="metro-note">{i + 1} / {n}</span>
        </div>
      </figcaption>
    </figure>
  );
}

window.BU_VISUALS = { sceneFor, Visual, svgFor, dataUrlFor, VW, VH };
