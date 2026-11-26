/* global React, BU_DATA, BU_METRO, BU_PROGRESS, ARXIVIS, THREE */
// ─────────────────────────────────────────────────────────────────
// SCREEN · LEARN — ride stop to stop
//
// A daytime train ride along your tour: a raised track through a quiet
// town, one platform per stop. Each platform's board carries the stop's
// idea; the card in the corner has the short version, "Change here for …"
// at stops that link to other courses, and the full lesson one click away.
//
// Takes any tour in the shared format ([{ node, cluster, kind, rationale }]),
// so routes from the Map, Courses, arXivis, open problems and Propose all
// ride the same way. App owns `idx`; the scene follows it.
// ─────────────────────────────────────────────────────────────────

const { useState, useEffect, useRef, useMemo } = React;

const RIDE_FONT = '"Geist", "Helvetica Neue", Arial, sans-serif';
const RIDE_FIRST = 40, RIDE_GAP = 75;

// Lessons are written in Markdown with LaTeX; the ride shows them as plain text.
const TEX = {
  subseteq: "⊆", subset: "⊂", supseteq: "⊇", in: "∈", notin: "∉", le: "≤", leq: "≤", ge: "≥", geq: "≥",
  neq: "≠", ne: "≠", approx: "≈", cdot: "·", times: "×", to: "→", rightarrow: "→", leftarrow: "←",
  infty: "∞", sum: "Σ", prod: "Π", log: "log", ln: "ln", min: "min", max: "max", ldots: "…", dots: "…",
  cdots: "⋯", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", varepsilon: "ε",
  lambda: "λ", mu: "μ", pi: "π", sigma: "σ", theta: "θ", phi: "φ", omega: "ω", Omega: "Ω", Theta: "Θ",
  forall: "∀", exists: "∃", cup: "∪", cap: "∩", emptyset: "∅", mid: "|", lvert: "|", rvert: "|",
  langle: "⟨", rangle: "⟩", pm: "±", sqrt: "√", partial: "∂", nabla: "∇", mathcal: "", mathbb: "", mathrm: "",
  text: "", operatorname: "", left: "", right: "", quad: " ", qquad: " ",
};
function rideTex(s) {
  return s
    .replace(/\\([a-zA-Z]+)/g, (m, w) => (w in TEX ? TEX[w] : w))
    .replace(/\\[{}|,;! ]/g, m => (m[1] === "{" || m[1] === "}" || m[1] === "|" ? m[1] : " "))
    .replace(/\^\{([^}]*)\}/g, "^$1").replace(/_\{([^}]*)\}/g, "_$1")
    .replace(/[{}]/g, "").replace(/-/g, "−");
}
function ridePlain(md) {
  if (!md) return "";
  return String(md)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, t) => rideTex(t))
    .replace(/\$([^$\n]+)\$/g, (_, t) => rideTex(t))
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\n\s*(?:[-*]|\d+[.)])\s+/g, "; ")
    .replace(/:\s*;\s*/g, ": ")
    .replace(/\s+/g, " ")
    .trim();
}
function rideClip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const dot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (dot > max * 0.5 ? cut.slice(0, dot + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…").replace(/;$/, ".");
}

// "How well did that land?" — SM-2 qualities (see agents/spaced_repetition.py):
// below 3 comes back in 10 minutes; 4 and 5 come back in a day, then later.
const RIDE_RATINGS = [{ q: 2, label: "Not yet" }, { q: 4, label: "Mostly" }, { q: 5, label: "Got it" }];
function rideWhen(card) {
  const s = (card && card.due_ts ? card.due_ts : 0) - Date.now() / 1000;
  if (s < 3600) return "in " + Math.max(1, Math.round(s / 60)) + " minutes";
  if (s < 36 * 3600) return "tomorrow";
  return "in " + Math.round(s / 86400) + " days";
}

// Papers in the arXivis library that mention a concept, strongest mention first.
let _papersByConcept = null;
function papersFor(id) {
  if (!_papersByConcept) {
    _papersByConcept = {};
    ((window.ARXIVIS && window.ARXIVIS.papers) || []).forEach(p => (p.concepts || []).forEach(c => {
      const key = String(c.id || "").replace(/^wiki:/, "").toLowerCase();
      if (!key || !p.url) return;
      (_papersByConcept[key] = _papersByConcept[key] || []).push({ title: p.title, url: p.url, year: p.year, w: c.weight || 0 });
    }));
    // a paper can name the same concept twice (e.g. two spellings): keep its strongest mention
    Object.keys(_papersByConcept).forEach(key => {
      const seen = new Set();
      _papersByConcept[key] = _papersByConcept[key].sort((a, b) => b.w - a.w)
        .filter(p => { const t = p.url + "|" + p.title; if (seen.has(p.url) || seen.has(p.title)) return false; seen.add(p.url); seen.add(p.title); return !!t; });
    });
  }
  return _papersByConcept[String(id).toLowerCase()] || [];
}

function rideStops(tour) {
  const net = BU_METRO.network();
  return tour.map(s => {
    const node = net.byId[s.node];
    const line = net.lineOfCluster[s.cluster] || (node && net.lineOfCluster[node.cluster]);
    const lesson = BU_DATA.lessonFor(s.node) || {};
    const name = (node && node.name) || s.node.replace(/_/g, " ");
    const summary = rideClip(ridePlain(lesson.summary), 260);
    // key ideas that only repeat the summary's own bullet points are skipped
    const flat = t => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ideas = (lesson.key_ideas || [])
      .map(k => {
        const h = ridePlain(k.h).replace(/[.:]$/, ""), b = ridePlain(k.b);
        return rideClip([h, b].filter(Boolean).join(": "), 120);
      })
      .filter(t => t && flat(summary).indexOf(flat(t)) < 0)
      .slice(0, 3);
    const papers = papersFor(s.node);
    return {
      id: s.node, name, summary, ideas,
      papers: papers.slice(0, 2), paperCount: papers.length,
      color: line ? line.color : "#d4351c",
      lineName: line ? line.name : "",
      changes: net.changesAt(s.node).filter(c => !line || c.cid !== line.cid),
    };
  });
}

// ─── the 3D ride (Three.js r150, already loaded by the app shell) ───
function buildRideScene(THREE, wrap, canvas, STOPS, startAt, hooks) {
  const reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
  let W = 1, H = 1, now = 0, dead = false, raf = 0, last = 0, visible = true;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const UP = V(0, 1, 0), NS = STOPS.length;
  const STOP = STOPS.map((_, k) => RIDE_FIRST + RIDE_GAP * k);

  // daylight
  scene.background = new THREE.Color("#dfeaf1");
  scene.fog = new THREE.Fog("#e6eef2", 70, 340);
  scene.add(new THREE.HemisphereLight("#ffffff", "#cfd4cc", 0.85));
  const sun = new THREE.DirectionalLight("#fff6e8", 0.75);
  sun.position.set(-60, 120, 40); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
  sun.shadow.bias = -0.0004;
  scene.add(sun); scene.add(sun.target);
  {
    const g = new THREE.SphereGeometry(800, 32, 16), p = g.attributes.position, col = new Float32Array(p.count * 3);
    const top = new THREE.Color("#a9cbe3"), hor = new THREE.Color("#eef3f2"), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { c.copy(hor).lerp(top, clamp(p.getY(i) / 800 * 2, 0, 1)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  }

  // the track: long enough for every stop plus a little run-out
  const need = STOP[NS - 1] + 90, nCtrl = Math.max(6, Math.ceil(need / 28) + 1);
  const ctrl = [];
  for (let ci = 0; ci <= nCtrl; ci++) ctrl.push(V(22 * Math.sin(ci * 0.5), 9 + 1.6 * Math.sin(ci * 0.9), -ci * 30));
  const path = new THREE.CatmullRomCurve3(ctrl, false, "centripetal");
  const L = path.getLength();
  const N = Math.ceil(L / 0.75), P = [], T = [], S = [];
  for (let i = 0; i <= N; i++) { const u = i / N; P.push(path.getPointAt(u)); const tg = path.getTangentAt(u); T.push(tg); S.push(UP.clone().cross(tg).normalize()); }
  const idxAt = d => clamp(Math.round(d / L * N), 0, N);
  const ribbon = (i0, i1, w, yo, off, mat) => {
    const pos = [], idx = [];
    for (let i = i0; i <= i1; i++) {
      const p = P[i], s = S[i];
      pos.push(p.x + s.x * (off - w / 2), p.y + yo, p.z + s.z * (off - w / 2), p.x + s.x * (off + w / 2), p.y + yo, p.z + s.z * (off + w / 2));
      if (i > i0) { const a = (i - 1 - i0) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
  };
  const wall = (off, y0, y1, mat) => {
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = P[i], s = S[i];
      pos.push(p.x + s.x * off, p.y + y0, p.z + s.z * off, p.x + s.x * off, p.y + y1, p.z + s.z * off);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; scene.add(m);
  };
  const concrete = new THREE.MeshStandardMaterial({ color: "#cfd2cc", roughness: 0.95, side: THREE.DoubleSide });
  ribbon(0, N, 5.6, -0.3, 0, concrete);
  wall(2.8, -1.4, 0.5, concrete); wall(-2.8, -1.4, 0.5, concrete);
  // edge strips in each stretch's line colour, so a change of line shows on the track
  STOPS.forEach((st, k) => {
    const from = k === 0 ? 0 : idxAt(STOP[k - 1] + 14), to = k === NS - 1 ? N : idxAt(STOP[k] + 14);
    if (to <= from) return;
    const mat = new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.6, side: THREE.DoubleSide });
    ribbon(from, to, 0.14, 0.52, 2.8, mat); ribbon(from, to, 0.14, 0.52, -2.8, mat);
  });
  const railMat = new THREE.MeshStandardMaterial({ color: "#8d969f", metalness: 0.7, roughness: 0.35 });
  [-0.75, 0.75].forEach(o => {
    const pts = [];
    for (let i = 0; i <= N; i += 3) pts.push(P[i].clone().addScaledVector(S[i], o).add(V(0, 0.02, 0)));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.ceil(N / 2), 0.07, 5, false), railMat));
  });
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), yv = V(0, 0, 0);
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.12, 0.34), new THREE.MeshStandardMaterial({ color: "#b9aa98", roughness: 1 }), Math.floor(N / 2) + 1);
  for (let si = 0, k = 0; si <= N; si += 2, k++) { yv.crossVectors(T[si], S[si]).normalize(); m4.makeBasis(S[si], yv, T[si]); m4.setPosition(P[si].x, P[si].y - 0.12, P[si].z); sleepers.setMatrixAt(k, m4); }
  sleepers.receiveShadow = true; scene.add(sleepers);
  const pillarGeo = new THREE.CylinderGeometry(0.7, 0.9, 1, 10); pillarGeo.translate(0, 0.5, 0);
  const pil = [];
  for (let pd = 0; pd < L; pd += 16) pil.push(P[idxAt(pd)]);
  const pillars = new THREE.InstancedMesh(pillarGeo, concrete, pil.length);
  pil.forEach((p, i) => { m4.compose(V(p.x, 0, p.z), q0, V(1, p.y - 1.4, 1)); pillars.setMatrixAt(i, m4); });
  pillars.castShadow = true; scene.add(pillars);

  // a light, quiet town
  const zEnd = -(L + 140);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, -zEnd + 400), new THREE.MeshStandardMaterial({ color: "#e9ece6", roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.z = zEnd / 2 + 50; ground.receiveShadow = true; scene.add(ground);
  const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return new THREE.CanvasTexture(c); };
  const winTex = canvasTex(64, 128, (g, w, h) => { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.fillStyle = "#b9cad6"; for (let y = 6; y < h; y += 10) for (let x = 6; x < w; x += 10) g.fillRect(x, y, 5, 6); });
  const cityMat = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 });
  const cr = rng(12), blocks = [], maxBlocks = Math.round(420 * (-zEnd + 50) / 530);
  for (let a = 0; a < maxBlocks * 6 && blocks.length < maxBlocks; a++) {
    const bx = (cr() - 0.5) * 240, bz = 50 - cr() * (-zEnd + 50);
    let ok = true;
    for (let pi = 0; pi <= N; pi += 8) { const dx = P[pi].x - bx, dz = P[pi].z - bz; if (dx * dx + dz * dz < 170) { ok = false; break; } }
    if (ok) blocks.push([bx, bz, 6 + cr() * 8, 5 + Math.pow(cr(), 2) * 30, 6 + cr() * 8]);
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
  const city = new THREE.InstancedMesh(boxGeo, cityMat, Math.max(1, blocks.length)), tints = ["#ffffff", "#f3ede2", "#e8ecef", "#f1e4dc", "#e6ece3"], col = new THREE.Color();
  blocks.forEach((b, i) => { m4.compose(V(b[0], 0, b[1]), q0, V(b[2], b[3], b[4])); city.setMatrixAt(i, m4); city.setColorAt(i, col.set(tints[i % tints.length])); });
  city.count = blocks.length;
  city.castShadow = true; city.receiveShadow = true; scene.add(city);

  // stations: platforms, canopies, a name sign and a lesson board
  const signs = [];
  const wrapLines = (g, text, maxW) => {
    const words = text.split(" "), lines = [];
    let line = "";
    words.forEach(w => { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    return lines;
  };
  const paintSign = o => {
    const c = document.createElement("canvas"); c.width = Math.round(o.w * 96); c.height = Math.round(o.h * 96);
    o.draw(c.getContext("2d"), c.width, c.height);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    const old = o.mesh.material.map; o.mesh.material.map = tex; o.mesh.material.needsUpdate = true; if (old) old.dispose();
  };
  const signMesh = (w, h, draw) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const o = { mesh: m, draw, w, h }; paintSign(o); signs.push(o); return m;
  };
  const platMat = new THREE.MeshStandardMaterial({ color: "#cfd3cc", roughness: 0.85 }), edgeMat = new THREE.MeshStandardMaterial({ color: "#f2c200" });
  const roofMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }), postMat = new THREE.MeshStandardMaterial({ color: "#14171a" });
  STOPS.forEach((st, k) => {
    const ii = idxAt(STOP[k]), grp = new THREE.Group();
    grp.position.copy(P[ii]); grp.lookAt(P[ii].clone().add(T[ii])); scene.add(grp);
    [-1, 1].forEach(sd => {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.1, 28), platMat); plat.position.set(sd * 4.8, -0.2, 0); plat.receiveShadow = true; grp.add(plat);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 28), edgeMat); edge.position.set(sd * 3.05, 0.37, 0); grp.add(edge);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 22), roofMat); roof.position.set(sd * 5, 4.6, 0); roof.castShadow = true; grp.add(roof);
      [-9, 0, 9].forEach(z => { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.2, 8), postMat); post.position.set(sd * 6.4, 2.3, z); grp.add(post); });
    });
    const name = signMesh(12, 2.0, (g, w, h) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      g.fillStyle = st.color; g.fillRect(0, 0, w, h * 0.16); g.fillRect(0, h * 0.84, w, h * 0.16);
      g.fillStyle = "#14171a";
      let fs = Math.round(h * 0.42);
      g.font = "700 " + fs + "px " + RIDE_FONT; g.textAlign = "center"; g.textBaseline = "middle";
      while (g.measureText(st.name).width > w - 40 && fs > 20) { fs -= 4; g.font = "700 " + fs + "px " + RIDE_FONT; }
      g.fillText(st.name, w / 2, h / 2 + 2);
    });
    name.position.set(0, 6.0, 13); name.rotation.y = Math.PI; grp.add(name);
    if (st.summary || st.ideas.length) {
      const board = signMesh(9, 4.2, (g, w, h) => {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.strokeStyle = "#14171a"; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
        const pad = 40;
        let y = 84;
        g.fillStyle = st.color; g.font = "700 34px " + RIDE_FONT;
        g.fillText(wrapLines(g, st.name, w - pad * 2)[0], pad, y); y += 58;
        g.fillStyle = "#14171a"; g.font = "500 32px " + RIDE_FONT;
        wrapLines(g, st.summary, w - pad * 2).slice(0, 3).forEach(ln => { g.fillText(ln, pad, y); y += 42; });
        y += 8; g.font = "500 28px " + RIDE_FONT; g.fillStyle = "#2b3036";
        st.ideas.slice(0, Math.max(0, Math.floor((h - 20 - y) / 38))).forEach(t => { g.fillText("•  " + wrapLines(g, t, w - pad * 2 - 30)[0], pad, y); y += 38; });
      });
      board.position.set(-6.25, 2.4, -1); board.rotation.y = Math.PI / 2; grp.add(board);
    }
  });

  // other lines cross overhead (and under) at stops that link to them
  const trainGeo = new THREE.CapsuleGeometry(0.75, 3.6, 4, 12); trainGeo.rotateX(Math.PI / 2);
  const crossTrains = [];
  const crossing = (k, color, dy, ang) => {
    const ii = idxAt(STOP[k] + 6), c = P[ii], dir = S[ii].clone().applyAxisAngle(UP, ang).normalize(), y = c.y + dy, len = 200;
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.8, len), concrete); deck.position.set(c.x, y - 0.5, c.z); deck.quaternion.copy(q); deck.castShadow = true; scene.add(deck);
    const lipMat = new THREE.MeshStandardMaterial({ color });
    [-2, 2].forEach(o => { const lip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, len), lipMat); lip.position.set(c.x, y + 0.05, c.z).addScaledVector(V(-dir.z, 0, dir.x), o); lip.quaternion.copy(q); scene.add(lip); });
    for (let pd = -len / 2; pd <= len / 2; pd += 18) {
      const pp = c.clone().addScaledVector(dir, pd);
      if (pp.distanceTo(c) < 6 || y < 2) continue;
      const pl = new THREE.Mesh(pillarGeo, concrete); pl.position.set(pp.x, 0, pp.z); pl.scale.set(0.8, y - 0.9, 0.8); pl.castShadow = true; scene.add(pl);
    }
    const tr = new THREE.Mesh(trainGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.4 })); tr.quaternion.copy(q); tr.castShadow = true; scene.add(tr);
    crossTrains.push({ mesh: tr, c, dir, y: y + 0.9, len, u: (k * 0.31) % 1 });
  };
  STOPS.forEach((st, k) => st.changes.slice(0, 2).forEach((ch, j) => crossing(k, ch.color, j === 0 ? 9 : -5.5, j === 0 ? 0.25 : -0.35)));

  // ride
  let at = clamp(startAt, 0, NS - 1), dist = STOP[at], run = null, speed = 0;
  let yaw = 0, pitch = 0, yawGoal = 0, pitchGoal = 0, drag = null, lastUser = -1e9;
  const onDown = e => { if (e.button != null && e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* old browsers */ } canvas.style.cursor = "grabbing"; lastUser = now; };
  const onMove = e => { if (!drag || e.pointerId !== drag.id) return; yawGoal = clamp(yawGoal - (e.clientX - drag.x) * 0.004, -1.2, 1.2); pitchGoal = clamp(pitchGoal + (e.clientY - drag.y) * 0.003, -0.4, 0.35); drag.x = e.clientX; drag.y = e.clientY; lastUser = now; };
  const onUp = e => { if (drag && e.pointerId === drag.id) { drag = null; canvas.style.cursor = "grab"; lastUser = now; } };
  const onKey = e => {
    const k = e.key;
    if (k === "ArrowLeft") yawGoal = clamp(yawGoal + 0.2, -1.2, 1.2);
    else if (k === "ArrowRight") yawGoal = clamp(yawGoal - 0.2, -1.2, 1.2);
    else if (k === " " || k === "Enter") hooks.onRequestNext();
    else return;
    e.preventDefault(); lastUser = now;
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp); canvas.addEventListener("keydown", onKey);

  const goTo = i => {
    i = clamp(i, 0, NS - 1);
    if (run) { dist = run.s0 + run.D; at = run.to; run = null; speed = 0; }
    if (i === at) { hooks.onArrive(at); return; }
    if (i === at + 1 && !reduce) {
      const D = STOP[i] - STOP[at], secs = Math.max(4.5, D / 14);
      run = { s0: STOP[at], D, T: secs, t: 0, to: i };
      hooks.onDepart(i, secs);
      return;
    }
    at = i; dist = STOP[i]; hooks.onArrive(at);
  };
  hooks.onArrive(at);

  const cp = V(0, 0, 0), ahead = V(0, 0, 0), look = V(0, 0, 0);
  const update = dt => {
    if (run) {
      run.t += dt;
      const x = clamp(run.t / run.T, 0, 1);
      dist = run.s0 + run.D * (x * x * x * (x * (x * 6 - 15) + 10));
      speed = run.D * 30 * x * x * (x - 1) * (x - 1) / run.T;
      if (x >= 1) { at = run.to; run = null; speed = 0; hooks.onArrive(at); }
    }
    crossTrains.forEach(c => {
      if (!reduce) c.u = (c.u + dt * 0.05) % 1;
      const s = (c.u < 0.5 ? c.u * 2 : 2 - c.u * 2) - 0.5;
      c.mesh.position.copy(c.c).addScaledVector(c.dir, s * c.len * 0.85); c.mesh.position.y = c.y;
    });
    if (!drag && now - lastUser > 1.6) { yawGoal *= Math.exp(-dt * 1.4); pitchGoal *= Math.exp(-dt * 1.4); }
    const kk = 1 - Math.exp(-dt * 6); yaw += (yawGoal - yaw) * kk; pitch += (pitchGoal - pitch) * kk;
    path.getPointAt(clamp(dist / L, 0, 1), cp); path.getPointAt(clamp((dist + 16) / L, 0, 1), ahead);
    camera.position.set(cp.x, cp.y + 2.2, cp.z);
    look.set(ahead.x - cp.x, ahead.y + 1.9 - (cp.y + 2.2), ahead.z - cp.z).normalize().applyAxisAngle(UP, yaw); look.y += pitch;
    camera.lookAt(camera.position.x + look.x, camera.position.y + look.y, camera.position.z + look.z);
    const fov = 60 + Math.min(6, speed * 0.25);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };

  const resize = () => { W = Math.max(1, wrap.clientWidth); H = Math.max(1, wrap.clientHeight); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); };
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(wrap); else window.addEventListener("resize", resize);
  resize();
  const kick = () => { if (!raf && !dead && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const frame = ts => { raf = 0; if (dead) return; const dt = Math.min(0.12, Math.max(0, (ts - last) / 1000)); last = ts; now += dt; update(dt); renderer.render(scene, camera); kick(); };
  const io = window.IntersectionObserver ? new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }) : null;
  if (io) io.observe(wrap);
  document.addEventListener("visibilitychange", kick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!dead) signs.forEach(paintSign); });
  kick();

  return {
    goTo,
    dispose() {
      dead = true; if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
      if (io) io.disconnect();
      document.removeEventListener("visibilitychange", kick);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp); canvas.removeEventListener("keydown", onKey);
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
      renderer.dispose();
    },
  };
}

// ─── the screen ──────────────────────────────────────────────────
function MetroRide({ tour, idx, onAdvance, onBranch, onSummit, onFullLesson, onPapers, onMap }) {
  const stops = useMemo(() => rideStops(tour), [tour]);
  const n = stops.length;
  const tourKey = tour.map(s => s.node).join("|");
  const wrapRef = useRef(null), canvasRef = useRef(null), sceneRef = useRef(null);
  const [at, setAt] = useState(idx);
  const [moving, setMoving] = useState(false);
  const [runMs, setRunMs] = useState(0);
  const [noScene, setNoScene] = useState(false);
  const [rated, setRated] = useState({}); // node → { q, card } rated on this visit
  const nextRef = useRef(null);
  nextRef.current = () => { if (idx < n - 1) onAdvance(1); };

  // build the scene once per tour; it starts at the current stop
  useEffect(() => {
    let alive = true, tries = 0, timer = 0;
    setNoScene(false);
    const go = () => {
      if (!alive) return;
      if (!window.THREE) {
        if (++tries > 50) { setNoScene(true); return; }
        timer = setTimeout(go, 100);
        return;
      }
      try {
        sceneRef.current = buildRideScene(window.THREE, wrapRef.current, canvasRef.current, stops, idx, {
          onDepart: (i, secs) => { if (alive) { setMoving(true); setRunMs(Math.round(secs * 1000)); } },
          onArrive: i => { if (alive) { setAt(i); setMoving(false); setRunMs(0); } },
          onRequestNext: () => nextRef.current(),
        });
      } catch (e) {
        console.warn("[ride] 3D view unavailable:", e);
        setNoScene(true);
      }
    };
    go();
    return () => {
      alive = false; clearTimeout(timer);
      if (sceneRef.current) { sceneRef.current.dispose(); sceneRef.current = null; }
    };
  }, [tourKey]);

  // App owns idx; the train follows it
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.goTo(idx);
    else { setAt(idx); setMoving(false); }
  }, [idx, tourKey]);

  const show = moving ? idx : at, cs = stops[show] || stops[0];
  const last = at >= n - 1 && !moving;
  const lefts = stops.map((_, i) => (n === 1 ? 50 : 6 + (88 * i) / (n - 1)));
  const minsLeft = (n - 1 - at) * BU_METRO.MIN_PER_STOP;
  const lineNames = Array.from(new Set(stops.map(s => s.lineName).filter(Boolean)));

  return (
    <section className="metro metro-ride" aria-label="Train ride">
      <div ref={wrapRef} className="metro-ride-stage" style={noScene ? { display: "none" } : null}>
        <canvas ref={canvasRef} tabIndex={0} role="img"
                aria-label={`View from the front of the train on a raised track through a quiet town. ${moving ? "Riding to " + cs.name + "." : "Stopped at " + cs.name + "; the platform board shows this stop's idea."} Drag to look around; Space goes to the next stop.`} />
      </div>
      {noScene && <div className="metro-ride-flat" aria-hidden="true" />}

      <div className="metro-ride-strip">
        <div role="img" className="metro-ride-track"
             aria-label={`${lineNames.join(", ")} ${lineNames.length > 1 ? "lines" : "line"}, ${n} ${n === 1 ? "stop" : "stops"}. ${moving ? "Riding to stop " + (idx + 1) + ", " + cs.name + "." : "At stop " + (at + 1) + " of " + n + ", " + cs.name + "."}`}>
          {stops.slice(1).map((s, i) => (
            <span key={"seg" + i} aria-hidden="true" className="metro-ride-seg"
                  style={{ left: lefts[i] + "%", width: (lefts[i + 1] - lefts[i]) + "%", background: i < at ? s.color : BU_METRO.mix(s.color, 0.65) }} />
          ))}
          {stops.map((s, i) => {
            const here = i === at && !moving, done = i < at;
            return (
              <div key={s.id + i} className="metro-ride-station" style={{ left: lefts[i] + "%" }}>
                <span aria-hidden="true" style={{ width: here ? 22 : 16, height: here ? 22 : 16, background: done ? s.color : "#ffffff", borderColor: s.changes.length ? "#14171a" : s.color }} />
                <em style={{ fontWeight: here ? 700 : 500 }}>{s.name}</em>
              </div>
            );
          })}
          <span aria-hidden="true" className="metro-ride-train"
                style={{ left: lefts[show] + "%", transition: `left ${moving ? runMs : 0}ms cubic-bezier(0.45,0,0.55,1)` }} />
        </div>
      </div>

      <article className="metro-ride-card" aria-live="polite">
        <span className="metro-ride-tag">
          {moving ? "Next stop" : `Stop ${at + 1} of ${n}`}
          {cs.lineName && <> · <i style={{ background: cs.color }} />{cs.lineName} line</>}
        </span>
        <h1>{cs.name}</h1>
        {cs.summary && <p>{cs.summary}</p>}
        {cs.ideas.length > 0 && (
          <ul>
            {cs.ideas.map((t, i) => <li key={i}><span aria-hidden="true" style={{ borderColor: cs.color }} />{t}</li>)}
          </ul>
        )}
        {!moving && cs.changes.length > 0 && (
          <div className="metro-ride-change">
            <span>Change here for the {BU_METRO.listAnd(cs.changes.map(c => c.name))} {cs.changes.length > 1 ? "lines" : "line"}</span>
            {onBranch && <button type="button" className="metro-btn ghost" onClick={() => onBranch(cs.id)}>Change lines</button>}
          </div>
        )}
        {!moving && window.BU_PROGRESS && (
          <div className="metro-ride-rate">
            <span id="metro-rate-label">How well did that land?</span>
            <div role="group" aria-labelledby="metro-rate-label">
              {RIDE_RATINGS.map(r => {
                const on = rated[cs.id] && rated[cs.id].q === r.q;
                return (
                  <button key={r.q} type="button" aria-pressed={!!on} className={"metro-rate" + (on ? " on" : "")}
                          onClick={() => setRated(m => ({ ...m, [cs.id]: { q: r.q, card: BU_PROGRESS.rate(cs.id, r.q) } }))}>
                    {r.label}
                  </button>
                );
              })}
            </div>
            {rated[cs.id] && <small role="status">Saved. It comes back for review {rideWhen(rated[cs.id].card)}.</small>}
          </div>
        )}
        {!moving && cs.papers.length > 0 && (
          <div className="metro-ride-papers">
            <span>In recent papers</span>
            {cs.papers.map(p => (
              <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer">
                {p.title}{p.year ? ` (${p.year})` : ""}
              </a>
            ))}
            {onPapers && (
              <button type="button" className="metro-linkbtn" onClick={onPapers}>
                {cs.paperCount > cs.papers.length ? `${cs.paperCount} papers mention this · open Papers` : "Open Papers"}
              </button>
            )}
          </div>
        )}
        <div className="metro-ride-foot">
          <span>{moving ? "Arriving…" : last ? "That was your last stop." : `${minsLeft} min left on this ride`}</span>
          <div>
            {at > 0 && !moving && <button type="button" className="metro-btn ghost" onClick={() => onAdvance(-1)} aria-label="Back to the previous stop">‹ Back</button>}
            {onFullLesson && !moving && <button type="button" className="metro-btn ghost" onClick={onFullLesson}>Full lesson</button>}
            {!last && (
              <button type="button" className="metro-btn primary" disabled={moving} onClick={() => onAdvance(1)}>
                {moving ? "Riding…" : "Next stop ›"}
              </button>
            )}
            {last && onSummit && <button type="button" className="metro-btn primary" onClick={onSummit}>Finish the ride ★</button>}
            {last && onMap && <button type="button" className="metro-btn dark" onClick={onMap}>Back to the map</button>}
          </div>
        </div>
      </article>
    </section>
  );
}

window.MetroRide = MetroRide;
