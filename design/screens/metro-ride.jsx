/* global React, BU_DATA, BU_METRO, BU_LESSON, BU_PROGRESS, ARXIVIS, THREE */
// ─────────────────────────────────────────────────────────────────
// SCREEN · LEARN — ride stop to stop, and learn along the platform
//
// A daytime train ride along your tour: a raised track through a quiet
// town, one station per stop. A stop is taught in beats (why it matters →
// the idea → see it → how it works → watch out → check yourself, from
// lesson-kit.jsx; "see it" is an animated diagram, also drawn on its board),
// and each beat has its own board along the platform: stepping through the
// lesson rolls the train from board to board, so the lesson is somewhere
// you move through, not a card over a backdrop. The card carries the beat
// in full (typeset maths, tap-open mistakes, recall before reveal), can
// read it aloud, and ends each stop with "How well did that land?", which
// schedules its review.
//
// Takes any tour in the shared format ([{ node, cluster, kind, rationale }]),
// so routes from the Map, Courses, Research and Progress all ride the same
// way. App owns `idx`; the scene follows it.
// ─────────────────────────────────────────────────────────────────

const { useState, useEffect, useRef, useMemo } = React;

const RIDE_FONT = '"Geist", "Helvetica Neue", Arial, sans-serif';
const RIDE_FIRST = 40, RIDE_GAP = 150, BEAT_STEP = 11;

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
      (_papersByConcept[key] = _papersByConcept[key] || []).push({ id: p.id, title: p.title, url: p.url, year: p.year, w: c.weight || 0 });
    }));
    // a paper can name the same concept twice (e.g. two spellings): keep its strongest mention
    Object.keys(_papersByConcept).forEach(key => {
      const seen = new Set();
      _papersByConcept[key] = _papersByConcept[key].sort((a, b) => b.w - a.w)
        .filter(p => { if (seen.has(p.url) || seen.has(p.title)) return false; seen.add(p.url); seen.add(p.title); return true; });
    });
  }
  return _papersByConcept[String(id).toLowerCase()] || [];
}

function rideStops(tour) {
  const net = BU_METRO.network();
  return tour.map(s => {
    const node = net.byId[s.node];
    const line = net.lineOfCluster[s.cluster] || (node && net.lineOfCluster[node.cluster]);
    const kit = BU_LESSON.lessonKit(s.node);
    const papers = papersFor(s.node);
    return {
      id: s.node, name: kit.name, kit,
      teaser: BU_LESSON.clipText(BU_LESSON.mdPlain(kit.card && kit.card.why ? kit.card.why.md : kit.idea), 200),
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

  // the track: long enough for every station plus a little run-out
  const need = STOP[NS - 1] + BEAT_STEP * 6 + 60, nCtrl = Math.max(6, Math.ceil(need / 28) + 1);
  const ctrl = [];
  for (let ci = 0; ci <= nCtrl; ci++) ctrl.push(V(18 * Math.sin(ci * 0.35), 9 + 1.4 * Math.sin(ci * 0.6), -ci * 30));
  const path = new THREE.CatmullRomCurve3(ctrl, false, "centripetal");
  const L = path.getLength();
  const N = Math.ceil(L / 0.75), P = [], T = [], S = [];
  for (let i = 0; i <= N; i++) { const u = i / N; P.push(path.getPointAt(u)); const tg = path.getTangentAt(u); T.push(tg); S.push(UP.clone().cross(tg).normalize()); }
  const idxAt = d => clamp(Math.round(d / L * N), 0, N);
  // A strip that follows the track from point i0 to i1: `off` to the side, `yo` up.
  const ribbon = (i0, i1, w, yo, off, mat, shadow) => {
    const pos = [], idx = [];
    for (let i = i0; i <= i1; i++) {
      const p = P[i], s = S[i];
      pos.push(p.x + s.x * (off - w / 2), p.y + yo, p.z + s.z * (off - w / 2), p.x + s.x * (off + w / 2), p.y + yo, p.z + s.z * (off + w / 2));
      if (i > i0) { const a = (i - 1 - i0) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = !!shadow; scene.add(m); return m;
  };
  const wall = (i0, i1, off, y0, y1, mat) => {
    const pos = [], idx = [];
    for (let i = i0; i <= i1; i++) {
      const p = P[i], s = S[i];
      pos.push(p.x + s.x * off, p.y + y0, p.z + s.z * off, p.x + s.x * off, p.y + y1, p.z + s.z * off);
      if (i > i0) { const a = (i - 1 - i0) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; scene.add(m);
  };
  const concrete = new THREE.MeshStandardMaterial({ color: "#cfd2cc", roughness: 0.95, side: THREE.DoubleSide });
  ribbon(0, N, 5.6, -0.3, 0, concrete);
  wall(0, N, 2.8, -1.4, 0.5, concrete); wall(0, N, -2.8, -1.4, 0.5, concrete);
  // edge strips in each stretch's line colour, so a change of line shows on the track
  STOPS.forEach((st, k) => {
    const from = k === 0 ? 0 : idxAt(STOP[k - 1] + 60), to = k === NS - 1 ? N : idxAt(STOP[k] + 60);
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
  const cr = rng(12), blocks = [], maxBlocks = Math.min(1400, Math.round(420 * (-zEnd + 50) / 530));
  for (let a = 0; a < maxBlocks * 6 && blocks.length < maxBlocks; a++) {
    const bx = (cr() - 0.5) * 240, bz = 50 - cr() * (-zEnd + 50);
    let ok = true;
    for (let pi = 0; pi <= N; pi += 8) { const dx = P[pi].x - bx, dz = P[pi].z - bz; if (dx * dx + dz * dz < 260) { ok = false; break; } }
    if (ok) blocks.push([bx, bz, 6 + cr() * 8, 5 + Math.pow(cr(), 2) * 30, 6 + cr() * 8]);
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
  const city = new THREE.InstancedMesh(boxGeo, cityMat, Math.max(1, blocks.length)), tints = ["#ffffff", "#f3ede2", "#e8ecef", "#f1e4dc", "#e6ece3"], col = new THREE.Color();
  blocks.forEach((b, i) => { m4.compose(V(b[0], 0, b[1]), q0, V(b[2], b[3], b[4])); city.setMatrixAt(i, m4); city.setColorAt(i, col.set(tints[i % tints.length])); });
  city.count = blocks.length;
  city.castShadow = true; city.receiveShadow = true; scene.add(city);

  // signs: canvas-textured planes, repainted once the web font is in
  const signs = [];
  const wrapLines = (g, text, maxW) => {
    const words = String(text).split(" "), lines = [];
    let line = "";
    words.forEach(w => { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    return lines;
  };
  const paintSign = o => {
    const c = document.createElement("canvas"); c.width = Math.round(o.w * 96); c.height = Math.round(o.h * 96);
    o.draw(c.getContext("2d"), c.width, c.height);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8;
    const old = o.mesh.material.map; o.mesh.material.map = tex; o.mesh.material.needsUpdate = true; if (old) old.dispose();
  };
  const signMesh = (w, h, draw) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const o = { mesh: m, draw, w, h }; paintSign(o); signs.push(o); return m;
  };
  const fit = (g, text, weight, size, maxW, min = 20) => {
    let fs = size;
    g.font = weight + " " + fs + "px " + RIDE_FONT;
    while (g.measureText(text).width > maxW && fs > min) { fs -= 2; g.font = weight + " " + fs + "px " + RIDE_FONT; }
  };

  // stations: a platform long enough for the stop's boards, one board per beat.
  // The boards stand on the right of the train (the card sits on the left of
  // the screen), angled back towards where the train stops for them.
  const platMat = new THREE.MeshStandardMaterial({ color: "#cfd3cc", roughness: 0.85, side: THREE.DoubleSide }), edgeMat = new THREE.MeshStandardMaterial({ color: "#f2c200", side: THREE.DoubleSide });
  const roofMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, side: THREE.DoubleSide }), postMat = new THREE.MeshStandardMaterial({ color: "#14171a" });
  const BOARD_W = 8, BOARD_H = 4;
  STOPS.forEach((st, k) => {
    const nb = st.kit.beats.length, back = 14, len = back + BEAT_STEP * nb + 8;
    const i0 = idxAt(STOP[k] - back), i1 = idxAt(STOP[k] - back + len);
    // platforms and canopies follow the track, so they stay true on curves
    [-1, 1].forEach(sd => {
      ribbon(i0, i1, 3.8, 0.35, sd * 4.8, platMat, true);
      wall(i0, i1, sd * 2.9, -0.75, 0.35, platMat);
      ribbon(i0, i1, 0.3, 0.37, sd * 3.05, edgeMat);
      ribbon(idxAt(STOP[k] - back + 3), idxAt(STOP[k] - back + len - 3), 4.6, 4.75, sd * 5, roofMat, true);
      // canopy posts: spaced along the left; on the right they stand behind the boards
      for (let d = sd > 0 ? 6 : back + 8; d < len - 4; d += 11) {
        const ii = idxAt(STOP[k] - back + d);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.4, 8), postMat);
        post.position.copy(P[ii]).addScaledVector(S[ii], sd * 7.05); post.position.y += 2.55; scene.add(post);
      }
    });
    // the station name, overhead as you pull in
    const ia = idxAt(STOP[k] + 13), nameGrp = new THREE.Group();
    nameGrp.position.copy(P[ia]); nameGrp.lookAt(P[ia].clone().add(T[ia])); scene.add(nameGrp);
    const name = signMesh(12, 2.0, (g, w, h) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      g.fillStyle = st.color; g.fillRect(0, 0, w, h * 0.16); g.fillRect(0, h * 0.84, w, h * 0.16);
      g.fillStyle = "#14171a"; g.textAlign = "center"; g.textBaseline = "middle";
      fit(g, st.name, 700, Math.round(h * 0.42), w - 40);
      g.fillText(st.name, w / 2, h / 2 + 2);
    });
    name.position.set(0, 6.3, 0); name.rotation.y = Math.PI; nameGrp.add(name);
    // one board per beat
    st.kit.beats.forEach((beat, b) => {
      const ib = idxAt(STOP[k] + BEAT_STEP * b + 8), grp = new THREE.Group();
      grp.position.copy(P[ib]); grp.lookAt(P[ib].clone().add(T[ib])); scene.add(grp);
      // the "See it" board shows the diagram's last frame (painted once the image is in)
      const vis = beat.key === "see" && st.kit.visual && window.BU_VISUALS ? st.kit.visual : null;
      const img = vis ? new Image() : null;
      const board = signMesh(BOARD_W, BOARD_H, (g, w, h) => {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
        const band = Math.round(h * 0.24), pad = 34;
        g.fillStyle = st.color; g.fillRect(0, 0, w, band);
        g.fillStyle = "#ffffff"; g.beginPath(); g.arc(pad + 26, band / 2, 26, 0, Math.PI * 2); g.fill();
        g.fillStyle = st.color; g.textAlign = "center"; g.textBaseline = "middle"; g.font = "700 34px " + RIDE_FONT;
        g.fillText(String(b + 1), pad + 26, band / 2 + 2);
        g.fillStyle = "#ffffff"; g.textAlign = "left"; g.font = "700 40px " + RIDE_FONT;
        g.fillText(beat.title, pad + 68, band / 2 + 2);
        const titleW = g.measureText(beat.title).width;
        g.textAlign = "right"; fit(g, st.name, 500, 26, w - pad * 2 - 90 - titleW, 16);
        g.fillText(st.name, w - pad, band / 2 + 2);
        g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillStyle = "#14171a";
        if (vis) {
          const ih = h - band - 30, iw = Math.round(ih * BU_VISUALS.VW / BU_VISUALS.VH), ix = w - pad - iw + 10;
          if (img.complete && img.naturalWidth) g.drawImage(img, ix, band + 12, iw, ih);
          g.font = "600 33px " + RIDE_FONT;
          wrapLines(g, vis.title, ix - pad - 16).slice(0, 4).forEach((ln, n) => g.fillText(ln, pad, band + 62 + n * 43));
          g.strokeStyle = "#14171a"; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
          return;
        }
        let y = band + 62;
        const lines = [];
        beat.board.forEach((t, li) => { g.font = (li === 0 ? "600 " : "500 ") + "33px " + RIDE_FONT; wrapLines(g, t, w - pad * 2).forEach(ln => lines.push([ln, li === 0])); });
        lines.slice(0, 6).forEach(([ln, strong], n) => {
          g.font = (strong ? "600 " : "500 ") + "33px " + RIDE_FONT;
          g.fillText(n === 5 && lines.length > 6 ? ln.replace(/.{0,3}$/, "…") : ln, pad, y); y += 43;
        });
        g.strokeStyle = "#14171a"; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
      });
      if (img) {
        const o = signs[signs.length - 1];
        img.onload = () => { if (!dead) paintSign(o); };
        img.src = BU_VISUALS.dataUrlFor(vis, vis.frames.length - 1, st.color);
      }
      board.position.set(-6.6, 2.55, 0); board.rotation.y = Math.PI / 2 + 0.5; grp.add(board);
      [-1, 1].forEach(e => { // legs
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), postMat);
        leg.position.set(-6.6 + e * 0.48 * (BOARD_W / 2 - 0.4), 0.55, e * -0.88 * (BOARD_W / 2 - 0.4)); grp.add(leg);
      });
    });
  });

  // other lines cross overhead (and under) at stops that link to them
  const trainGeo = new THREE.CapsuleGeometry(0.75, 3.6, 4, 12); trainGeo.rotateX(Math.PI / 2);
  const crossTrains = [];
  const crossing = (k, color, dy, ang) => {
    const ii = idxAt(STOP[k] - 22), c = P[ii], dir = S[ii].clone().applyAxisAngle(UP, ang).normalize(), y = c.y + dy, len = 200;
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

  // ride: `run` is the trip between stops, `roll` the short move to a beat's board
  let at = clamp(startAt, 0, NS - 1), dist = STOP[at], run = null, roll = null, speed = 0;
  let yaw = 0, pitch = 0, yawGoal = 0, pitchGoal = 0, yawHome = 0, drag = null, lastUser = -1e9;
  const boardYaw = () => (W < 700 ? -0.68 : -0.44); // glance right, at the board
  const onDown = e => { if (e.button != null && e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* old browsers */ } canvas.style.cursor = "grabbing"; lastUser = now; };
  const onMove = e => { if (!drag || e.pointerId !== drag.id) return; yawGoal = clamp(yawGoal - (e.clientX - drag.x) * 0.004, -1.3, 1.3); pitchGoal = clamp(pitchGoal + (e.clientY - drag.y) * 0.003, -0.4, 0.35); drag.x = e.clientX; drag.y = e.clientY; lastUser = now; };
  const onUp = e => { if (drag && e.pointerId === drag.id) { drag = null; canvas.style.cursor = "grab"; lastUser = now; } };
  const onKey = e => {
    const k = e.key;
    if (k === "ArrowLeft") yawGoal = clamp(yawGoal + 0.2, -1.3, 1.3);
    else if (k === "ArrowRight") yawGoal = clamp(yawGoal - 0.2, -1.3, 1.3);
    else if (k === " " || k === "Enter") hooks.onRequestNext();
    else return;
    e.preventDefault(); lastUser = now;
  };
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp); canvas.addEventListener("keydown", onKey);

  const goTo = i => {
    i = clamp(i, 0, NS - 1);
    roll = null;
    if (run) { dist = run.s0 + run.D; at = run.to; run = null; speed = 0; }
    if (i === at) { hooks.onArrive(at); return; }
    if (i === at + 1 && !reduce) {
      const D = STOP[i] - dist, secs = Math.max(4.5, D / 14);
      run = { s0: dist, D, T: secs, t: 0, to: i };
      yawHome = 0; lastUser = -1e9;
      hooks.onDepart(i, secs);
      return;
    }
    at = i; dist = STOP[i]; yawHome = boardYaw(); lastUser = -1e9; hooks.onArrive(at);
  };
  // Roll along the platform to beat b's board.
  const setBeat = b => {
    if (run) return;
    const target = STOP[at] + BEAT_STEP * clamp(b, 0, STOPS[at].kit.beats.length - 1);
    yawHome = boardYaw(); lastUser = -1e9;
    if (Math.abs(target - dist) < 0.05) return;
    if (reduce) { dist = target; roll = null; return; }
    roll = { s0: dist, D: target - dist, T: clamp(Math.abs(target - dist) / 8, 0.9, 2.2), t: 0 };
  };
  yawHome = boardYaw(); yawGoal = yaw = yawHome;
  hooks.onArrive(at);

  const cp = V(0, 0, 0), ahead = V(0, 0, 0), look = V(0, 0, 0);
  const update = dt => {
    if (run) {
      run.t += dt;
      const x = clamp(run.t / run.T, 0, 1);
      dist = run.s0 + run.D * (x * x * x * (x * (x * 6 - 15) + 10));
      speed = run.D * 30 * x * x * (x - 1) * (x - 1) / run.T;
      if (x >= 1) { at = run.to; run = null; speed = 0; yawHome = boardYaw(); lastUser = -1e9; hooks.onArrive(at); }
    } else if (roll) {
      roll.t += dt;
      const x = clamp(roll.t / roll.T, 0, 1);
      dist = roll.s0 + roll.D * (x * x * (3 - 2 * x));
      if (x >= 1) roll = null;
    }
    crossTrains.forEach(c => {
      if (!reduce) c.u = (c.u + dt * 0.05) % 1;
      const s = (c.u < 0.5 ? c.u * 2 : 2 - c.u * 2) - 0.5;
      c.mesh.position.copy(c.c).addScaledVector(c.dir, s * c.len * 0.85); c.mesh.position.y = c.y;
    });
    if (!drag && now - lastUser > 1.6) { const e = 1 - Math.exp(-dt * 1.8); yawGoal += (yawHome - yawGoal) * e; pitchGoal += (0 - pitchGoal) * e; }
    const kk = 1 - Math.exp(-dt * 6); yaw += (yawGoal - yaw) * kk; pitch += (pitchGoal - pitch) * kk;
    path.getPointAt(clamp(dist / L, 0, 1), cp); path.getPointAt(clamp((dist + 16) / L, 0, 1), ahead);
    camera.position.set(cp.x, cp.y + 2.2, cp.z);
    look.set(ahead.x - cp.x, ahead.y + 1.9 - (cp.y + 2.2), ahead.z - cp.z).normalize().applyAxisAngle(UP, yaw); look.y += pitch;
    camera.lookAt(camera.position.x + look.x, camera.position.y + look.y, camera.position.z + look.z);
    const fov = 60 + Math.min(6, speed * 0.25);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };

  const resize = () => { W = Math.max(1, wrap.clientWidth); H = Math.max(1, wrap.clientHeight); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix(); if (!run) yawHome = boardYaw(); };
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(wrap); else window.addEventListener("resize", resize);
  resize();
  yawGoal = yaw = yawHome;
  const kick = () => { if (!raf && !dead && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const frame = ts => { raf = 0; if (dead) return; const dt = Math.min(0.12, Math.max(0, (ts - last) / 1000)); last = ts; now += dt; update(dt); renderer.render(scene, camera); kick(); };
  const io = window.IntersectionObserver ? new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }) : null;
  if (io) io.observe(wrap);
  document.addEventListener("visibilitychange", kick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!dead) signs.forEach(paintSign); });
  kick();

  return {
    goTo, setBeat,
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

// ─── read aloud (the browser's own speech; nothing is sent anywhere) ───
function useReadAloud() {
  const can = typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  const [on, setOn] = useState(() => can && BU_METRO.readPref("bu_listen", false) === true);
  const say = text => {
    if (!can) return;
    try {
      window.speechSynthesis.cancel();
      if (!text) return;
      const u = new window.SpeechSynthesisUtterance(String(text).slice(0, 1400));
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch (_) { /* speech not available after all */ }
  };
  const toggle = () => setOn(v => { const n = !v; BU_METRO.writePref("bu_listen", n); if (!n) say(""); return n; });
  useEffect(() => () => say(""), []);
  return { can, on, toggle, say };
}

// ─── the screen ──────────────────────────────────────────────────
function MetroRide({ tour, idx, onAdvance, onBranch, onSummit, onFullLesson, onPapers, onMap }) {
  const stops = useMemo(() => rideStops(tour), [tour]);
  const n = stops.length;
  const tourKey = tour.map(s => s.node).join("|");
  const wrapRef = useRef(null), canvasRef = useRef(null), sceneRef = useRef(null), bodyRef = useRef(null);
  const [at, setAt] = useState(idx);
  const [moving, setMoving] = useState(false);
  const [runMs, setRunMs] = useState(0);
  const [noScene, setNoScene] = useState(false);
  const [beat, setBeat] = useState(0);
  const [rated, setRated] = useState({}); // node → { q, card } rated on this visit
  const voice = useReadAloud();

  const show = moving ? idx : at, cs = stops[show] || stops[0];
  const beats = cs.kit.beats, nb = beats.length;
  const b = Math.min(beat, nb - 1), cur = beats[b];
  const lastBeat = b >= nb - 1, lastStop = at >= n - 1 && !moving;

  const nextRef = useRef(null);
  const stepNext = () => {
    if (moving) return;
    if (!lastBeat) setBeat(b + 1);
    else if (idx < n - 1) onAdvance(1);
  };
  nextRef.current = stepNext;

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

  // App owns idx; the train follows it. A new stop starts at its first beat.
  useEffect(() => {
    setBeat(0);
    if (sceneRef.current) sceneRef.current.goTo(idx);
    else { setAt(idx); setMoving(false); }
  }, [idx, tourKey]);
  // stepping through the lesson rolls the train to that beat's board
  useEffect(() => {
    if (!moving && sceneRef.current) sceneRef.current.setBeat(b);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [b, at, moving]);
  // read aloud: the station on arrival, then each beat
  useEffect(() => {
    if (!voice.on || moving) return;
    voice.say((b === 0 ? "This is " + cs.name + ". " : "") + cur.title + ". " + cur.speech);
  }, [voice.on, b, at, moving]);
  useEffect(() => { if (moving && voice.on) voice.say("Next stop: " + cs.name + "."); }, [moving]);

  const lefts = stops.map((_, i) => (n === 1 ? 50 : 6 + (88 * i) / (n - 1)));
  const lineNames = Array.from(new Set(stops.map(s => s.lineName).filter(Boolean)));
  const minsLeft = (n - 1 - at) * BU_METRO.MIN_PER_STOP;
  const back = () => { if (b > 0) setBeat(b - 1); else if (at > 0) onAdvance(-1); };

  return (
    <section className="metro metro-ride" aria-label="Train ride">
      <div ref={wrapRef} className="metro-ride-stage" style={noScene ? { display: "none" } : null}>
        <canvas ref={canvasRef} tabIndex={0} role="img"
                aria-label={`View from the train. ${moving ? "Riding to " + cs.name + "." : `Stopped at ${cs.name}, beside the board for part ${b + 1} of ${nb}: ${cur.title}.`} Drag to look around; Space moves on.`} />
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

        {moving ? (
          <p className="metro-ride-teaser">{cs.teaser}</p>
        ) : (
          <>
            <ol className="metro-beats" aria-label="Parts of this stop">
              {beats.map((bt, i) => (
                <li key={bt.key}>
                  <button type="button" aria-current={i === b ? "step" : undefined} className={i === b ? "on" : i < b ? "done" : ""}
                          onClick={() => setBeat(i)} style={i <= b ? { borderColor: cs.color, background: i === b ? cs.color : "#ffffff" } : null}>
                    <span>{i + 1}</span>{i === b && bt.title}
                    {i !== b && <span className="metro-sr">{bt.title}</span>}
                  </button>
                </li>
              ))}
            </ol>

            <div className="metro-ride-body" ref={bodyRef} tabIndex={0} role="group" aria-label={cur.title}>
              <BU_LESSON.BeatBody kit={cs.kit} beat={cur.key} compact />

              {lastBeat && window.BU_PROGRESS && (
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
              {lastBeat && cs.changes.length > 0 && (
                <div className="metro-ride-change">
                  <span>Change here for the {BU_METRO.listAnd(cs.changes.map(c => c.name))} {cs.changes.length > 1 ? "lines" : "line"}</span>
                  {onBranch && <button type="button" className="metro-btn ghost" onClick={() => onBranch(cs.id)}>Change lines</button>}
                </div>
              )}
              {lastBeat && cs.papers.length > 0 && (
                <div className="metro-ride-papers">
                  <span>In recent papers</span>
                  {cs.papers.map(p => (
                    <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer">{p.title}{p.year ? ` (${p.year})` : ""}</a>
                  ))}
                  {onPapers && (
                    <button type="button" className="metro-linkbtn" onClick={() => onPapers(cs.id)}>
                      {cs.paperCount > cs.papers.length ? `${cs.paperCount} papers mention this · open Research` : "Open Research"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        <div className="metro-ride-foot">
          <span>
            {moving ? "Arriving…" : `Part ${b + 1} of ${nb}`}
            {!moving && !lastStop && <> · {minsLeft} min left</>}
          </span>
          <div>
            {voice.can && !moving && (
              <button type="button" className={"metro-btn ghost" + (voice.on ? " on" : "")} aria-pressed={voice.on} onClick={voice.toggle}>
                {voice.on ? "Listening" : "Listen"}
              </button>
            )}
            {onFullLesson && !moving && <button type="button" className="metro-btn ghost" onClick={onFullLesson}>Full lesson</button>}
            {!moving && (b > 0 || at > 0) && <button type="button" className="metro-btn ghost" onClick={back} aria-label={b > 0 ? "Back to the previous part" : "Back to the previous stop"}>‹ Back</button>}
            {!lastBeat && !moving && <button type="button" className="metro-btn primary" onClick={() => setBeat(b + 1)}>{beats[b + 1].title} ›</button>}
            {(lastBeat || moving) && !lastStop && (
              <button type="button" className="metro-btn primary" disabled={moving} onClick={() => onAdvance(1)}>
                {moving ? "Riding…" : "Next stop ›"}
              </button>
            )}
            {lastBeat && lastStop && onSummit && <button type="button" className="metro-btn primary" onClick={onSummit}>Finish the ride ★</button>}
          </div>
        </div>
        {!moving && !lastBeat && !lastStop && (
          <button type="button" className="metro-linkbtn metro-skip" onClick={() => onAdvance(1)}>Skip to the next stop</button>
        )}
        {!moving && lastBeat && lastStop && onMap && (
          <button type="button" className="metro-linkbtn metro-skip" onClick={onMap}>Back to the map</button>
        )}
      </article>
    </section>
  );
}

window.MetroRide = MetroRide;
// Shared with the lesson page and Research.
window.BU_METRO_TEXT = { papersFor, ratings: RIDE_RATINGS, when: rideWhen };
