'use strict';
// Level generator. Finds the hardest levels for a WxH grid.
//   node gen.js exhaustive 5        (exhaustive, parallel - realistic up to 5x5)
//   node gen.js anneal 6 [seconds]  (simulated annealing, parallel)
// Result: levels_WxH.json with the best levels (unique solution, sorted by score).
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { data } = require('./paths');
const os = require('os');
const fs = require('fs');
const P = require('./solver');

const TOPK = 300;

// Difficulty score: the sum of "guessing bits" for players with lookahead 0..LMAX.
// A wrong move whose trap is only revealed after d moves counts for every player with lookahead < d,
// so deep traps weigh more than traps you see straight away.
// Plus a bonus if the "take edges/corners first" strategy (Warnsdorff) doesn't solve the level.
function score(a) {
  let s = 0;
  for (let L = 0; L <= P.LMAX; L++) s += a.bits[L];
  return s + Math.min(a.bitsWarns, 6);
}

function spansBox(W, H, mask) {
  let r0 = 0, r1 = 0, c0 = 0, c1 = 0;
  for (let x = 0; x < W; x++) { r0 |= mask[x]; r1 |= mask[(H - 1) * W + x]; }
  for (let y = 0; y < H; y++) { c0 |= mask[y * W]; c1 |= mask[y * W + W - 1]; }
  return r0 && r1 && c0 && c1;
}

// Evaluates all start tiles for a mask. Returns the best unique start and the fitness for annealing.
function evalMask(W, H, mask, solCap) {
  if (!spansBox(W, H, mask)) return { fitness: -1000 };
  const g = P.buildGraph(W, H, mask);
  if (g.n < 2 || g.n > 64 || !P.isConnected(g)) return { fitness: -1000 };
  const S = new P.Search(g);
  let best = null, minSol = Infinity;
  const uniques = [];
  for (let s = 0; s < g.n; s++) {
    if (!P.parityAllowsStart(g, s)) continue;
    const c = P.countSolutions(g, s, solCap, 2e6, S);
    if (c <= 0) continue;
    if (c < minSol) minSol = c;
    if (c !== 1) continue;
    const a = P.analyze(g, s, { budget: 3e6 });
    if (a.solutions !== 1) continue;
    const sc = score(a);
    const item = { score: sc, start: g.cells[s], a, n: g.n };
    uniques.push(item);
    if (!best || sc > best.score) best = item;
  }
  if (best) return { fitness: best.score, best, uniques };
  if (minSol === Infinity) return { fitness: -500 };
  return { fitness: -1 - Math.log2(minSol) };
}

class TopK {
  constructor(k) { this.k = k; this.items = []; this.keys = new Set(); }
  add(W, H, mask, item) {
    if (this.items.length >= this.k && item.score <= this.items[this.items.length - 1].score) return;
    const key = P.canonical(W, H, mask, item.start);
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.items.push({
      score: item.score, n: item.n, rows: P.levelToRows(W, H, mask, item.start),
      bits: item.a.bits.map(b => +b.toFixed(3)), maxTrap: item.a.maxTrap, trapSum: item.a.trapSum,
      choices: item.a.choices, states: item.a.states,
      bitsWarns: item.a.bitsWarns === Infinity || item.a.bitsWarns === null ? null : +item.a.bitsWarns.toFixed(3),
    });
    this.items.sort((a, b) => b.score - a.score);
    if (this.items.length > this.k) {
      const out = this.items.pop();
      this.keys.delete(P.canonical(W, H, P.parseLevel(out.rows).mask, P.parseLevel(out.rows).startCell));
    }
  }
}

// ---------- Exhaustive ----------
function exhaustiveWorker({ W, H, from, to }) {
  const N = W * H;
  const full = N === 32 ? 0xffffffff : (1 << N) - 1;
  const rowMask = (1 << W) - 1;
  let colL = 0, colR = 0, black = 0;
  for (let y = 0; y < H; y++) { colL |= 1 << (y * W); colR |= 1 << (y * W + W - 1); }
  for (let i = 0; i < N; i++) if (((i % W) + ((i / W) | 0)) % 2 === 0) black |= 1 << i;
  const notL = full & ~colL, notR = full & ~colR;
  const pop = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const top = new TopK(TOPK);
  let connected = 0, uniqueLevels = 0;
  const mask = new Uint8Array(N);
  for (let m = from; m < to; m++) {
    if (!(m & rowMask) || !(m & (rowMask << (W * (H - 1)))) || !(m & colL) || !(m & colR)) continue;
    const d = pop(m & black) - pop(m & ~black);
    if (d > 1 || d < -1) continue;
    // connectivity via bit flood fill
    let f = m & -m, prev = 0;
    while (f !== prev) {
      prev = f;
      f = (f | ((f << 1) & notL) | ((f >>> 1) & notR) | (f << W) | (f >>> W)) & m;
    }
    if (f !== m) continue;
    connected++;
    for (let i = 0; i < N; i++) mask[i] = (m >>> i) & 1;
    const r = evalMask(W, H, mask, 2);
    if (r.uniques) for (const u of r.uniques) { uniqueLevels++; top.add(W, H, mask, u); }
  }
  return { items: top.items, connected, uniqueLevels };
}

// ---------- Simulated annealing ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function annealWorker({ W, H, seconds, seed, fill }) {
  const N = W * H;
  const rand = rng(seed);
  const top = new TopK(TOPK);
  const deadline = Date.now() + seconds * 1000;
  let chains = 0, evals = 0;
  while (Date.now() < deadline) {
    chains++;
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = rand() < fill ? 1 : 0;
    let cur = evalMask(W, H, mask, 64);
    let best = cur.fitness;
    const iters = 1500 + N * 60;
    const T0 = 3, T1 = 0.05;
    for (let it = 0; it < iters && Date.now() < deadline; it++) {
      const T = T0 * Math.pow(T1 / T0, it / iters);
      const flips = rand() < 0.25 ? 2 : 1;
      const idx = [];
      for (let f = 0; f < flips; f++) { const i = (rand() * N) | 0; idx.push(i); mask[i] ^= 1; }
      const nxt = evalMask(W, H, mask, 64);
      evals++;
      if (nxt.uniques) for (const u of nxt.uniques) top.add(W, H, mask, u);
      const delta = nxt.fitness - cur.fitness;
      if (delta >= 0 || rand() < Math.exp(delta / T)) { cur = nxt; if (cur.fitness > best) best = cur.fitness; }
      else for (const i of idx) mask[i] ^= 1;
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
  let stats = { connected: 0, uniqueLevels: 0, chains: 0, evals: 0 };
  let next = 0, done = 0;
  const runNext = () => new Promise(resolve => {
    const pump = () => {
      if (next >= jobs.length) return resolve();
      const job = jobs[next++];
      const w = new Worker(__filename, { workerData: { mode, args: job } });
      w.on('message', (r) => {
        for (const it of r.items) {
          const lv = P.parseLevel(it.rows);
          all.add(W, H, lv.mask, { score: it.score, start: lv.startCell, n: it.n, a: it });
        }
        for (const k of Object.keys(stats)) stats[k] += r[k] || 0;
        done++;
        if (mode === 'exhaustive') process.stderr.write(`\r${done}/${jobs.length} chunks`);
      });
      w.on('error', (e) => { console.error(e); });
      w.on('exit', pump);
    };
    pump();
  });
  Promise.all(Array.from({ length: threads }, runNext)).then(() => {
    console.error(`\n${mode} ${W}x${H}: ${JSON.stringify(stats)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const out = data(`levels_${W}x${H}.json`);
    let prev = [];
    if (fs.existsSync(out)) prev = JSON.parse(fs.readFileSync(out, 'utf8'));
    for (const it of prev) {
      const lv = P.parseLevel(it.rows);
      all.add(W, H, lv.mask, { score: it.score, start: lv.startCell, n: it.n, a: it });
    }
    fs.writeFileSync(out, JSON.stringify(all.items, null, 1));
    for (const it of all.items.slice(0, 5)) {
      console.log(`score=${it.score.toFixed(2)} n=${it.n} bits=[${it.bits.map(b => b.toFixed(1)).join(' ')}] maxTrap=${it.maxTrap} choices=${it.choices}`);
      console.log('   ' + it.rows.join('\n   '));
    }
  });
}
