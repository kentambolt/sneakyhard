'use strict';
// Banegenerator til "I takt" (to brikker, én styring).
//   node gen-twins.js exhaustive 4          (alle brætter x alle startpar)
//   node gen-twins.js anneal 5 [sekunder]   (simulated annealing på alle kerner)
// Resultat flettes ind i twins_WxH.json.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { data } = require('./paths');
const os = require('os');
const fs = require('fs');
const T = require('./twins');

const TOPK = 300;

// Samme mål som det første spil: sum af gætte-bits for lookahead 0..LMAX.
function score(a) {
  let s = 0;
  for (let L = 0; L <= T.LMAX; L++) s += a.bits[L];
  return s;
}

function spansBox(W, H, mask) {
  let r0 = 0, r1 = 0, c0 = 0, c1 = 0;
  for (let x = 0; x < W; x++) { r0 |= mask[x]; r1 |= mask[(H - 1) * W + x]; }
  for (let y = 0; y < H; y++) { c0 |= mask[y * W]; c1 |= mask[y * W + W - 1]; }
  return r0 && r1 && c0 && c1;
}

// Ø-nummer for hvert felt (kompakt indeks)
function compLabels(g) {
  const lab = new Int32Array(g.n).fill(-1);
  let c = 0;
  for (let s = 0; s < g.n; s++) {
    if (lab[s] >= 0) continue;
    const st = [s];
    lab[s] = c;
    while (st.length) {
      const u = st.pop();
      for (let d = 0; d < 4; d++) { const v = g.nb[u * 4 + d]; if (v >= 0 && lab[v] < 0) { lab[v] = c; st.push(v); } }
    }
    c++;
  }
  return { lab, count: c };
}

function itemFor(W, H, mask, a, b, an, sc, n) {
  return {
    score: sc, n, rows: T.levelToRows(W, H, mask, a, b),
    bits: an.bits.map(x => +x.toFixed(3)), maxTrap: an.maxTrap, choices: an.choices,
    solo: an.solo, moves: an.moves, states: an.states, turns: an.turns, lens: an.lens,
  };
}

class TopK {
  constructor(k) { this.k = k; this.items = []; this.keys = new Map(); }
  add(W, H, item) {
    if (this.items.length >= this.k && item.score <= this.items[this.items.length - 1].score) return;
    const lv = T.parseLevel(item.rows);
    const key = T.canonical(W, H, lv.mask, lv.a, lv.b);
    if (this.keys.has(key)) return;
    this.keys.set(key, item);
    this.items.push(item);
    this.items.sort((x, y) => y.score - x.score);
    if (this.items.length > this.k) {
      const out = this.items.pop();
      const o = T.parseLevel(out.rows);
      this.keys.delete(T.canonical(W, H, o.mask, o.a, o.b));
    }
  }
}

// ---------- Udtømmende ----------
function exhaustiveWorker({ W, H, from, to }) {
  const N = W * H;
  const top = new TopK(TOPK);
  let boards = 0, uniqueLevels = 0;
  const mask = new Uint8Array(N);
  for (let m = from; m < to; m++) {
    for (let i = 0; i < N; i++) mask[i] = (m >>> i) & 1;
    if (!spansBox(W, H, mask)) continue;
    const g = T.buildBoard(W, H, mask);
    if (g.n < 4) continue;
    const comp = compLabels(g);
    if (comp.count > 2) continue;
    boards++;
    const S = new T.TwinSearch(g);
    for (let a = 0; a < g.n; a++) for (let b = a + 1; b < g.n; b++) {
      if (comp.count === 2 && comp.lab[a] === comp.lab[b]) continue;
      if (T.countSolutions(g, a, b, 2, 1e6, S).count !== 1) continue;
      const an = T.analyze(g, a, b);
      if (an.solutions !== 1 || !T.shapeOK(an, g.n)) continue;
      uniqueLevels++;
      top.add(W, H, itemFor(W, H, mask, g.cells[a], g.cells[b], an, score(an), g.n));
    }
  }
  return { items: top.items, boards, uniqueLevels };
}

// ---------- Simulated annealing ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function evalState(W, H, mask, a, b) {
  if (a === b || !mask[a] || !mask[b] || !spansBox(W, H, mask)) return { fitness: -1000 };
  const g = T.buildBoard(W, H, mask);
  const comp = compLabels(g);
  const ka = g.id[a], kb = g.id[b];
  if (comp.count > 2 || (comp.count === 2 && comp.lab[ka] === comp.lab[kb])) return { fitness: -1000 };
  const c = T.countSolutions(g, ka, kb, 64, 1e6);
  if (c.count < 0) return { fitness: -40 };
  if (c.count === 0) return { fitness: -8 - c.minRem };
  if (c.count > 1) return { fitness: -1 - Math.log2(c.count) };
  const an = T.analyze(g, ka, kb, { budget: 3e6 });
  if (an.solutions !== 1) return { fitness: -40 };
  const sc = score(an);
  // Unik, men den ene brik laver for lidt: lad annealing passere, men gem den ikke
  if (!T.shapeOK(an, g.n)) return { fitness: sc * 0.3 };
  return { fitness: sc, item: itemFor(W, H, mask, a, b, an, sc, g.n) };
}
function annealWorker({ W, H, seconds, seed, fill }) {
  const N = W * H;
  const rand = rng(seed);
  const top = new TopK(TOPK);
  const deadline = Date.now() + seconds * 1000;
  let chains = 0, evals = 0;
  const pick = () => (rand() * N) | 0;
  while (Date.now() < deadline) {
    chains++;
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = rand() < fill ? 1 : 0;
    let a = pick(), b = pick();
    while (b === a) b = pick();
    mask[a] = mask[b] = 1;
    let cur = evalState(W, H, mask, a, b);
    const iters = 2000 + N * 80;
    const T0 = 3, T1 = 0.05;
    for (let it = 0; it < iters && Date.now() < deadline; it++) {
      const temp = T0 * Math.pow(T1 / T0, it / iters);
      const r = rand();
      const undo = [];
      let na = a, nb = b;
      if (r < 0.65) {
        const flips = rand() < 0.25 ? 2 : 1;
        for (let f = 0; f < flips; f++) {
          const i = pick();
          if (i === a || i === b) continue;
          undo.push(i); mask[i] ^= 1;
        }
      } else {
        const i = pick();
        if (i === a || i === b) continue;
        if (!mask[i]) { undo.push(i); mask[i] = 1; }
        if (r < 0.825) na = i; else nb = i;
      }
      const nxt = evalState(W, H, mask, na, nb);
      evals++;
      if (nxt.item) top.add(W, H, nxt.item);
      const delta = nxt.fitness - cur.fitness;
      if (delta >= 0 || rand() < Math.exp(delta / temp)) { cur = nxt; a = na; b = nb; }
      else for (const i of undo) mask[i] ^= 1;
    }
  }
  return { items: top.items, chains, evals };
}

if (!isMainThread) {
  const { mode, args } = workerData;
  parentPort.postMessage(mode === 'exhaustive' ? exhaustiveWorker(args) : annealWorker(args));
} else {
  const mode = process.argv[2] || 'anneal';
  const W = +process.argv[3] || 5, H = W;
  const seconds = +process.argv[4] || 60;
  const fill = +process.argv[5] || 0.8;
  const threads = os.cpus().length;
  const t0 = Date.now();
  const jobs = [];
  if (mode === 'exhaustive') {
    const total = 2 ** (W * H);
    const chunks = threads * 8;
    for (let c = 0; c < chunks; c++) jobs.push({ W, H, from: Math.floor(total * c / chunks) || 1, to: Math.floor(total * (c + 1) / chunks) });
  } else {
    for (let t = 0; t < threads; t++) jobs.push({ W, H, seconds, seed: (Date.now() + t * 7919) >>> 0, fill });
  }
  const all = new TopK(TOPK);
  const stats = { boards: 0, uniqueLevels: 0, chains: 0, evals: 0 };
  let next = 0;
  const runNext = () => new Promise(resolve => {
    const pump = () => {
      if (next >= jobs.length) return resolve();
      const w = new Worker(__filename, { workerData: { mode, args: jobs[next++] } });
      w.on('message', (r) => {
        for (const it of r.items) all.add(W, H, it);
        for (const k of Object.keys(stats)) stats[k] += r[k] || 0;
      });
      w.on('error', (e) => console.error(e));
      w.on('exit', pump);
    };
    pump();
  });
  Promise.all(Array.from({ length: threads }, runNext)).then(() => {
    console.log(`${mode} ${W}x${H}: ${JSON.stringify(stats)} på ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const out = data(`twins_${W}x${H}.json`);
    if (fs.existsSync(out)) for (const it of JSON.parse(fs.readFileSync(out, 'utf8'))) all.add(W, H, it);
    fs.writeFileSync(out, JSON.stringify(all.items, null, 1));
    for (const it of all.items.slice(0, 4)) {
      console.log(`score=${it.score.toFixed(1)} n=${it.n} bits=[${it.bits.map(x => x.toFixed(1)).join(' ')}] fælde=${it.maxTrap} valg=${it.choices} solo=${it.solo} træk=${it.moves.length} sving=[${it.turns}] felter=[${it.lens}]`);
      console.log('   ' + it.rows.join('\n   '));
    }
  });
}
