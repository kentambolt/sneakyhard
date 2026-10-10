'use strict';
// Level generator for "Black Ice" (one piece, normal tiles + ice).
//   node gen-ice.js exhaustive 3            (all 3^9 boards x all starts)
//   node gen-ice.js anneal 5 [seconds]      (simulated annealing on all cores)
// Result is merged into ice_WxH.json.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { data } = require('./paths');
const os = require('os');
const fs = require('fs');
const I = require('./ice');

const TOPK = 300;

function score(a) {
  let s = 0;
  for (let L = 0; L <= I.LMAX; L++) s += a.bits[L];
  return s;
}
// The ice must be used in the solution, otherwise it's just "One Path" with decoration
const iceOK = (an, n) => n < 8 || an.iceMoves >= 2;

function spansBox(W, H, types) {
  let r0 = 0, r1 = 0, c0 = 0, c1 = 0;
  for (let x = 0; x < W; x++) { r0 |= types[x] ? 1 : 0; r1 |= types[(H - 1) * W + x] ? 1 : 0; }
  for (let y = 0; y < H; y++) { c0 |= types[y * W] ? 1 : 0; c1 |= types[y * W + W - 1] ? 1 : 0; }
  return r0 && r1 && c0 && c1;
}

function itemFor(W, H, types, start, an, sc, g) {
  return {
    score: sc, n: g.n, ice: g.ice, rows: I.levelToRows(W, H, types, start),
    bits: an.bits.map(x => +x.toFixed(3)), maxTrap: an.maxTrap, choices: an.choices,
    iceMoves: an.iceMoves, dirs: an.dirs, states: an.states,
  };
}

class TopK {
  constructor(k) { this.k = k; this.items = []; this.keys = new Set(); }
  add(W, H, item) {
    if (this.items.length >= this.k && item.score <= this.items[this.items.length - 1].score) return;
    const lv = I.parseLevel(item.rows);
    const key = I.canonical(W, H, lv.types, lv.start);
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.items.push(item);
    this.items.sort((x, y) => y.score - x.score);
    if (this.items.length > this.k) {
      const o = I.parseLevel(this.items.pop().rows);
      this.keys.delete(I.canonical(W, H, o.types, o.start));
    }
  }
}

function evalStart(W, H, types, g, s, cap) {
  const c = I.countSolutions(g, s, cap, 1e6);
  if (c.count < 0) return { fitness: -40 };
  if (c.count === 0) return { fitness: -8 - c.minRem };
  if (c.count > 1) return { fitness: -1 - Math.log2(c.count) };
  const an = I.analyze(g, s, { budget: 3e6 });
  if (an.solutions !== 1) return { fitness: -40 };
  const sc = score(an);
  if (!iceOK(an, g.n)) return { fitness: sc * 0.3 };
  return { fitness: sc, item: itemFor(W, H, types, s, an, sc, g) };
}

// ---------- Exhaustive (3x3 only) ----------
function exhaustiveWorker({ W, H, from, to }) {
  const N = W * H;
  const top = new TopK(TOPK);
  let boards = 0, uniqueLevels = 0;
  const types = new Uint8Array(N);
  for (let m = from; m < to; m++) {
    let x = m;
    for (let i = 0; i < N; i++) { types[i] = x % 3; x = Math.floor(x / 3); }
    if (!spansBox(W, H, types)) continue;
    const g = I.buildBoard(W, H, types);
    if (g.ice === 0 || g.n < 3) continue;
    boards++;
    for (const s of g.normals) {
      const r = evalStart(W, H, types, g, s, 2);
      if (r.item) { uniqueLevels++; top.add(W, H, r.item); }
    }
  }
  return { items: top.items, boards, uniqueLevels };
}

// ---------- Simulated annealing ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function evalState(W, H, types, start) {
  if (types[start] !== I.NORMAL || !spansBox(W, H, types)) return { fitness: -1000 };
  const g = I.buildBoard(W, H, types);
  if (g.ice === 0 || g.n < 4 || g.n > 47) return { fitness: -1000 };
  return evalStart(W, H, types, g, start, 64);
}
function annealWorker({ W, H, seconds, seed }) {
  const N = W * H;
  const rand = rng(seed);
  const top = new TopK(TOPK);
  const deadline = Date.now() + seconds * 1000;
  let chains = 0, evals = 0;
  const pick = () => (rand() * N) | 0;
  const randType = () => { const r = rand(); return r < 0.15 ? 0 : r < 0.42 ? 2 : 1; };
  while (Date.now() < deadline) {
    chains++;
    const types = new Uint8Array(N);
    for (let i = 0; i < N; i++) types[i] = randType();
    let start = pick();
    types[start] = I.NORMAL;
    let cur = evalState(W, H, types, start);
    const iters = 2000 + N * 80;
    const T0 = 3, T1 = 0.05;
    for (let it = 0; it < iters && Date.now() < deadline; it++) {
      const temp = T0 * Math.pow(T1 / T0, it / iters);
      const r = rand();
      const undo = [];
      let ns = start;
      if (r < 0.75) {
        const changes = rand() < 0.2 ? 2 : 1;
        for (let f = 0; f < changes; f++) {
          const i = pick();
          if (i === start) continue;
          const old = types[i];
          let nt = (old + 1 + ((rand() * 2) | 0)) % 3;
          undo.push([i, old]);
          types[i] = nt;
        }
      } else {
        const i = pick();
        if (i === start) continue;
        undo.push([i, types[i]]);
        types[i] = I.NORMAL;
        ns = i;
      }
      const nxt = evalState(W, H, types, ns);
      evals++;
      if (nxt.item) top.add(W, H, nxt.item);
      const delta = nxt.fitness - cur.fitness;
      if (delta >= 0 || rand() < Math.exp(delta / temp)) { cur = nxt; start = ns; }
      else for (let k = undo.length - 1; k >= 0; k--) types[undo[k][0]] = undo[k][1];
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
  const threads = os.cpus().length;
  const t0 = Date.now();
  const jobs = [];
  if (mode === 'exhaustive') {
    const total = 3 ** (W * H);
    const chunks = threads * 4;
    for (let c = 0; c < chunks; c++) jobs.push({ W, H, from: Math.floor(total * c / chunks), to: Math.floor(total * (c + 1) / chunks) });
  } else {
    for (let t = 0; t < threads; t++) jobs.push({ W, H, seconds, seed: (Date.now() + t * 7919) >>> 0 });
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
    console.log(`${mode} ${W}x${H}: ${JSON.stringify(stats)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const out = data(`ice_${W}x${H}.json`);
    if (fs.existsSync(out)) for (const it of JSON.parse(fs.readFileSync(out, 'utf8'))) all.add(W, H, it);
    fs.writeFileSync(out, JSON.stringify(all.items, null, 1));
    for (const it of all.items.slice(0, 4)) {
      console.log(`score=${it.score.toFixed(1)} n=${it.n} ice=${it.ice} bits=[${it.bits.map(x => x.toFixed(1)).join(' ')}] trap=${it.maxTrap} choices=${it.choices} iceMoves=${it.iceMoves} presses=${it.dirs.length}`);
      console.log('   ' + it.rows.join('\n   '));
    }
  });
}
