'use strict';
// Level generator for "Crossroads" (1 piece, tiles + crossings) and "The Gauntlet" (combinations of elements).
//   node gen-mix.js kryds 5 300 [threads]
//   node gen-mix.js mester 5 300 [threads] [combo]
// combo = comma-separated list of at least two elements: two (two pieces, one control), ice, perm (crossings),
// num (numbered checkpoints). Default: two,ice,perm.
// Every element in the combo must actually matter in the solution (see quality()).
// Results are merged into data/kryds_WxH.json or data/mester-<combo>_WxH.json.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { data } = require('./paths');
const os = require('os');
const fs = require('fs');
const M = require('./mix');

const TOPK = 300;
const MAXK = 9;
const ELEMENTS = ['two', 'ice', 'perm', 'num'];

function makeVariant(name, comboArg) {
  if (name === 'kryds') {
    return {
      file: 'kryds', combo: 'perm', pieces: 1, nums: false,
      types: [M.HOLE, M.NORMAL, M.PERM],
      randType: (r) => (r < 0.12 ? M.HOLE : r < 0.3 ? M.PERM : M.NORMAL),
      // the solution has to use the crossings (at least twice on boards of some size)
      quality: (an, g) => g.perm >= 1 && (g.n < 8 || an.permVisits >= 2),
    };
  }
  if (name !== 'mester') throw new Error('unknown variant ' + name);
  const set = new Set((comboArg || 'two,ice,perm').split(',').map(s => s.trim()).filter(Boolean));
  for (const e of set) if (!ELEMENTS.includes(e)) throw new Error('unknown element ' + e);
  if (set.size < 2) throw new Error('a Gauntlet combo needs at least two elements');
  const combo = [...set].sort().join('+');
  const types = [M.HOLE, M.NORMAL];
  if (set.has('ice')) types.push(M.ICE);
  if (set.has('perm')) types.push(M.PERM);
  return {
    file: `mester-${combo}`, combo, pieces: set.has('two') ? 2 : 1, nums: set.has('num'), types,
    randType: (r) => (r < 0.1 ? M.HOLE : set.has('ice') && r < 0.22 ? M.ICE : set.has('perm') && r < 0.34 ? M.PERM : M.NORMAL),
    quality(an, g, plain) {
      if (set.has('two') && Math.min(an.lens[0], an.lens[1]) < Math.max(2, Math.floor(g.n / 5))) return false;
      if (set.has('ice') && (g.ice < 1 || an.iceMoves < 1)) return false;
      if (set.has('perm') && (g.perm < 1 || an.permVisits < 1)) return false;
      // checkpoints must matter: without the numbers the level must not have a unique solution
      if (set.has('num') && (g.K < 1 || plain === 1)) return false;
      return true;
    },
  };
}

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
  key(W, H, rows) { const lv = M.parseLevel(rows); return M.canonical(W, H, lv.types, lv.a, lv.b, lv.nums); }
  add(W, H, item) {
    if (this.items.length >= this.k && item.score <= this.items[this.items.length - 1].score) return;
    const key = this.key(W, H, item.rows);
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.items.push(item);
    this.items.sort((x, y) => y.score - x.score);
    if (this.items.length > this.k) this.keys.delete(this.key(W, H, this.items.pop().rows));
  }
}

function evalState(V, W, H, types, nums, a, b) {
  const okStart = (c) => c >= 0 && !nums[c] && (types[c] === M.NORMAL || types[c] === M.PERM);
  if (!okStart(a) || (V.pieces === 2 && (!okStart(b) || a === b)) || !spansBox(W, H, types)) return { fitness: -1000 };
  const g = M.buildBoard(W, H, types, V.nums ? nums : undefined);
  if (g.n < 3 || g.n > 40) return { fitness: -1000 };
  const c = M.countSolutions(g, V.pieces, a, b, 64, 1e6);
  if (c.count < 0) return { fitness: -40 };
  if (c.count === 0) return { fitness: -8 - c.minRem };
  if (c.count > 1) return { fitness: -1 - Math.log2(c.count) };
  const an = M.analyze(g, V.pieces, a, b, { budget: 3e6 });
  if (an.solutions !== 1) return { fitness: -40 };
  const sc = score(an);
  const plain = V.nums ? M.countSolutions(M.buildBoard(W, H, types), V.pieces, a, b, 2, 1e6).count : null;
  // unique but some element doesn't matter: let annealing pass through, but don't keep it
  if (!V.quality(an, g, plain)) return { fitness: sc * 0.3 };
  return {
    fitness: sc,
    item: {
      score: sc, combo: V.combo, n: g.n, ice: g.ice, perm: g.perm, K: g.K,
      rows: M.levelToRows(W, H, types, a, V.pieces === 2 ? b : -1, V.nums ? nums : undefined),
      bits: an.bits.map(x => +x.toFixed(3)), maxTrap: an.maxTrap, choices: an.choices,
      iceMoves: an.iceMoves, permVisits: an.permVisits, solo: an.solo, lens: an.lens, presses: an.presses,
    },
  };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// remove checkpoint k and shift the higher numbers down by one
function removeNum(nums, k) {
  for (let i = 0; i < nums.length; i++) { if (nums[i] === k) nums[i] = 0; else if (nums[i] > k) nums[i]--; }
}

function annealWorker({ variant, combo, W, H, seconds, seed }) {
  const V = makeVariant(variant, combo);
  const N = W * H;
  const rand = rng(seed);
  const top = new TopK(TOPK);
  const deadline = Date.now() + seconds * 1000;
  let chains = 0, evals = 0;
  const pick = () => (rand() * N) | 0;
  const maxNum = (nums) => nums.reduce((m, v) => Math.max(m, v), 0);
  const freeNormal = (types, nums, a, b) => {
    const out = [];
    for (let i = 0; i < N; i++) if (types[i] === M.NORMAL && !nums[i] && i !== a && i !== b) out.push(i);
    return out;
  };
  while (Date.now() < deadline) {
    chains++;
    let types = new Uint8Array(N), nums = new Int8Array(N);
    for (let i = 0; i < N; i++) types[i] = V.randType(rand());
    let a = pick(), b = V.pieces === 2 ? pick() : -1;
    while (V.pieces === 2 && b === a) b = pick();
    types[a] = M.NORMAL;
    if (b >= 0) types[b] = M.NORMAL;
    if (V.nums) {
      const K0 = 1 + ((rand() * 3) | 0);
      for (let k = 1; k <= K0; k++) { const f = freeNormal(types, nums, a, b); if (f.length) nums[f[(rand() * f.length) | 0]] = k; }
    }
    let cur = evalState(V, W, H, types, nums, a, b);
    const iters = 2000 + N * 80;
    const T0 = 3, T1 = 0.05;
    for (let it = 0; it < iters && Date.now() < deadline; it++) {
      const temp = T0 * Math.pow(T1 / T0, it / iters);
      const t2 = types.slice(), n2 = nums.slice();
      let a2 = a, b2 = b;
      const r = rand();
      if (r < 0.55 || (!V.nums && r < 0.75)) {
        // change the type of one or two cells (a start never becomes a hole or ice)
        const changes = rand() < 0.2 ? 2 : 1;
        for (let f = 0; f < changes; f++) {
          const i = pick();
          const choices = V.types.filter(t => t !== t2[i] && !((i === a2 || i === b2) && (t === M.HOLE || t === M.ICE)));
          if (!choices.length) continue;
          t2[i] = choices[(rand() * choices.length) | 0];
          if (t2[i] !== M.NORMAL && n2[i]) removeNum(n2, n2[i]);
        }
      } else if (V.nums && r < 0.67) {
        // add a checkpoint with the next number
        const K = maxNum(n2), f = freeNormal(t2, n2, a2, b2);
        if (K >= MAXK || !f.length) continue;
        n2[f[(rand() * f.length) | 0]] = K + 1;
      } else if (V.nums && r < 0.75) {
        // remove a checkpoint
        const K = maxNum(n2);
        if (K < 1) continue;
        removeNum(n2, 1 + ((rand() * K) | 0));
      } else if (V.nums && r < 0.85) {
        // move a checkpoint
        const K = maxNum(n2), f = freeNormal(t2, n2, a2, b2);
        if (!K || !f.length) continue;
        const k = 1 + ((rand() * K) | 0);
        for (let i = 0; i < N; i++) if (n2[i] === k) n2[i] = 0;
        n2[f[(rand() * f.length) | 0]] = k;
      } else {
        // move a piece's start
        const i = pick();
        if (i === a2 || i === b2 || n2[i]) continue;
        if (t2[i] === M.HOLE || t2[i] === M.ICE) t2[i] = M.NORMAL;
        if (V.pieces === 1 || rand() < 0.5) a2 = i; else b2 = i;
      }
      const nxt = evalState(V, W, H, t2, n2, a2, b2);
      evals++;
      if (nxt.item) top.add(W, H, nxt.item);
      const delta = nxt.fitness - cur.fitness;
      if (delta >= 0 || rand() < Math.exp(delta / temp)) { cur = nxt; types = t2; nums = n2; a = a2; b = b2; }
    }
  }
  return { items: top.items, chains, evals };
}

if (!isMainThread) {
  parentPort.postMessage(annealWorker(workerData));
} else {
  const variant = process.argv[2] || 'kryds';
  const W = +process.argv[3] || 5, H = W;
  const seconds = +process.argv[4] || 60;
  const threads = +process.argv[5] || os.cpus().length;
  const combo = process.argv[6];
  const V = makeVariant(variant, combo);
  const t0 = Date.now();
  const all = new TopK(TOPK);
  const stats = { chains: 0, evals: 0 };
  const runs = Array.from({ length: threads }, (_, t) => new Promise(resolve => {
    const w = new Worker(__filename, { workerData: { variant, combo, W, H, seconds, seed: (Date.now() + t * 7919) >>> 0 } });
    w.on('message', (r) => {
      for (const it of r.items) all.add(W, H, it);
      stats.chains += r.chains; stats.evals += r.evals;
    });
    w.on('error', (e) => console.error(e));
    w.on('exit', resolve);
  }));
  Promise.all(runs).then(() => {
    console.log(`${V.file} ${W}x${H}: ${JSON.stringify(stats)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const out = data(`${V.file}_${W}x${H}.json`);
    if (fs.existsSync(out)) for (const it of JSON.parse(fs.readFileSync(out, 'utf8'))) all.add(W, H, it);
    fs.writeFileSync(out, JSON.stringify(all.items, null, 1));
    for (const it of all.items.slice(0, 3)) {
      console.log(`score=${it.score.toFixed(1)} tiles=${it.n} ice=${it.ice} crossings=${it.perm} checkpoints=${it.K || 0} bits=[${it.bits.map(x => x.toFixed(1)).join(' ')}] trap=${it.maxTrap} lens=[${it.lens}] presses=${it.presses}`);
      console.log('   ' + it.rows.join('\n   '));
    }
  });
}
