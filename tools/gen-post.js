'use strict';
// Banegenerator til "Postløb": én brik, almindelige felter og nummererede poster, der skal tages i rækkefølge.
//   node gen-post.js 5 300 [tråde]
// Resultat flettes ind i post_WxH.json.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { data } = require('./paths');
const os = require('os');
const fs = require('fs');
const M = require('./mix');

const TOPK = 300;
const MAXK = 9;

function score(a) {
  let s = 0;
  for (let L = 0; L <= M.LMAX; L++) s += a.bits[L];
  return s;
}
function spansBox(W, H, types) {
  let r0 = 0, r1 = 0, c0 = 0, c1 = 0;
  for (let x = 0; x < W; x++) { r0 |= types[x] ? 1 : 0; r1 |= types[(H - 1) * W + x] ? 1 : 0; }
  for (let y = 0; y < H; y++) { c0 |= types[y * W] ? 1 : 0; c1 |= types[y * W + W - 1] ? 1 : 0; }
  return r0 && r1 && c0 && c1;
}

class TopK {
  constructor(k) { this.k = k; this.items = []; this.keys = new Set(); }
  add(W, H, item) {
    if (this.items.length >= this.k && item.score <= this.items[this.items.length - 1].score) return;
    const lv = M.parseLevel(item.rows);
    const key = M.canonical(W, H, lv.types, lv.a, lv.b, lv.nums);
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.items.push(item);
    this.items.sort((x, y) => y.score - x.score);
    if (this.items.length > this.k) {
      const o = M.parseLevel(this.items.pop().rows);
      this.keys.delete(M.canonical(W, H, o.types, o.a, o.b, o.nums));
    }
  }
}

function evalState(W, H, types, nums, start) {
  if (types[start] !== M.NORMAL || nums[start] || !spansBox(W, H, types)) return { fitness: -1000 };
  const g = M.buildBoard(W, H, types, nums);
  if (g.n < 3 || g.n > 40 || g.K < 1) return { fitness: -1000 };
  const c = M.countSolutions(g, 1, start, -1, 64, 1e6);
  if (c.count < 0) return { fitness: -40 };
  if (c.count === 0) return { fitness: -8 - c.minRem };
  if (c.count > 1) return { fitness: -1 - Math.log2(c.count) };
  const an = M.analyze(g, 1, start, -1, { budget: 3e6 });
  if (an.solutions !== 1) return { fitness: -40 };
  const sc = score(an);
  // Posterne skal gøre en forskel: uden numrene må banen ikke have en unik løsning
  const plain = M.countSolutions(M.buildBoard(W, H, types), 1, start, -1, 2, 1e6).count;
  if ((g.n >= 8 && g.K < 2) || plain === 1) return { fitness: sc * 0.3 };
  return {
    fitness: sc,
    item: {
      score: sc, n: g.n, K: g.K, rows: M.levelToRows(W, H, types, start, -1, nums),
      bits: an.bits.map(x => +x.toFixed(3)), maxTrap: an.maxTrap, choices: an.choices, plain,
    },
  };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Fjern post k og ryk de højere numre én ned
function removeNum(nums, k) {
  for (let i = 0; i < nums.length; i++) { if (nums[i] === k) nums[i] = 0; else if (nums[i] > k) nums[i]--; }
}
function annealWorker({ W, H, seconds, seed }) {
  const N = W * H;
  const rand = rng(seed);
  const top = new TopK(TOPK);
  const deadline = Date.now() + seconds * 1000;
  let chains = 0, evals = 0;
  const pick = () => (rand() * N) | 0;
  const maxNum = (nums) => nums.reduce((m, v) => Math.max(m, v), 0);
  const freeNormal = (types, nums, start) => {
    const out = [];
    for (let i = 0; i < N; i++) if (types[i] === M.NORMAL && !nums[i] && i !== start) out.push(i);
    return out;
  };
  while (Date.now() < deadline) {
    chains++;
    let types = new Uint8Array(N), nums = new Int8Array(N);
    for (let i = 0; i < N; i++) types[i] = rand() < 0.85 ? M.NORMAL : M.HOLE;
    let start = pick();
    types[start] = M.NORMAL;
    const K0 = 2 + ((rand() * 3) | 0);
    for (let k = 1; k <= K0; k++) { const f = freeNormal(types, nums, start); if (f.length) nums[f[(rand() * f.length) | 0]] = k; }
    let cur = evalState(W, H, types, nums, start);
    const iters = 2000 + N * 80;
    const T0 = 3, T1 = 0.05;
    for (let it = 0; it < iters && Date.now() < deadline; it++) {
      const temp = T0 * Math.pow(T1 / T0, it / iters);
      const t2 = types.slice(), n2 = nums.slice();
      let s2 = start;
      const r = rand();
      if (r < 0.5) {
        // felt <-> hul
        const i = pick();
        if (i === s2) continue;
        if (t2[i] === M.NORMAL) { if (n2[i]) removeNum(n2, n2[i]); t2[i] = M.HOLE; } else t2[i] = M.NORMAL;
      } else if (r < 0.65) {
        // ny post med næste nummer
        const K = maxNum(n2), f = freeNormal(t2, n2, s2);
        if (K >= MAXK || !f.length) continue;
        n2[f[(rand() * f.length) | 0]] = K + 1;
      } else if (r < 0.75) {
        // fjern en post
        const K = maxNum(n2);
        if (K <= 1) continue;
        removeNum(n2, 1 + ((rand() * K) | 0));
      } else if (r < 0.9) {
        // flyt en post
        const K = maxNum(n2), f = freeNormal(t2, n2, s2);
        if (!K || !f.length) continue;
        const k = 1 + ((rand() * K) | 0);
        for (let i = 0; i < N; i++) if (n2[i] === k) n2[i] = 0;
        n2[f[(rand() * f.length) | 0]] = k;
      } else {
        // flyt starten
        const i = pick();
        if (n2[i]) continue;
        t2[i] = M.NORMAL;
        s2 = i;
      }
      const nxt = evalState(W, H, t2, n2, s2);
      evals++;
      if (nxt.item) top.add(W, H, nxt.item);
      const delta = nxt.fitness - cur.fitness;
      if (delta >= 0 || rand() < Math.exp(delta / temp)) { cur = nxt; types = t2; nums = n2; start = s2; }
    }
  }
  return { items: top.items, chains, evals };
}

if (!isMainThread) {
  parentPort.postMessage(annealWorker(workerData));
} else {
  const W = +process.argv[2] || 5, H = W;
  const seconds = +process.argv[3] || 60;
  const threads = +process.argv[4] || os.cpus().length;
  const t0 = Date.now();
  const all = new TopK(TOPK);
  const stats = { chains: 0, evals: 0 };
  const runs = Array.from({ length: threads }, (_, t) => new Promise(resolve => {
    const w = new Worker(__filename, { workerData: { W, H, seconds, seed: (Date.now() + t * 7919) >>> 0 } });
    w.on('message', (r) => {
      for (const it of r.items) all.add(W, H, it);
      stats.chains += r.chains; stats.evals += r.evals;
    });
    w.on('error', (e) => console.error(e));
    w.on('exit', resolve);
  }));
  Promise.all(runs).then(() => {
    console.log(`post ${W}x${H}: ${JSON.stringify(stats)} på ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const out = data(`post_${W}x${H}.json`);
    if (fs.existsSync(out)) for (const it of JSON.parse(fs.readFileSync(out, 'utf8'))) all.add(W, H, it);
    fs.writeFileSync(out, JSON.stringify(all.items, null, 1));
    for (const it of all.items.slice(0, 4)) {
      console.log(`score=${it.score.toFixed(1)} felter=${it.n} poster=${it.K} bits=[${it.bits.map(x => x.toFixed(1)).join(' ')}] fælde=${it.maxTrap} uden-numre=${it.plain} løsninger`);
      console.log('   ' + it.rows.join('\n   '));
    }
  });
}
