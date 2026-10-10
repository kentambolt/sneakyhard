'use strict';
// "Black Ice": one piece, normal tiles and ice. Normal tiles can be used once and disappear afterwards.
// Ice never disappears: step onto ice and you slide on in the same direction until you hit a normal tile
// (and land on it) or something you can't walk on (edge, hole, used tile) - then you stop on the last ice tile.
// Goal: every normal tile used. A solution = the order the tiles are used in (wandering on ice is free).
// Solver + difficulty meter in the same style as solver.js. Works in Node and the browser (window.IceSolver).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IceSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const INF = 1e9;
  const LMAX = 8;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const DIRS = 'URDL';
  const HOLE = 0, NORMAL = 1, ICE = 2;

  class Budget extends Error {}

  function buildBoard(w, h, types) {
    const N = w * h;
    const nid = new Int32Array(N).fill(-1);
    const normals = [];
    for (let i = 0; i < N; i++) if (types[i] === NORMAL) { nid[i] = normals.length; normals.push(i); }
    const nbr = new Int32Array(N * 4).fill(-1);
    for (let i = 0; i < N; i++) {
      const x = i % w, y = (i / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) nbr[i * 4 + d] = ny * w + nx;
      }
    }
    let ice = 0;
    for (let i = 0; i < N; i++) if (types[i] === ICE) ice++;
    return { w, h, N, types: Uint8Array.from(types), nid, normals, n: normals.length, nbr, ice };
  }

  class IceSearch {
    constructor(g) {
      this.g = g;
      const N = g.N;
      this.visited = new Uint8Array(N);
      this.seen = new Int32Array(N);
      this.tmark = new Int32Array(N);
      this.stamp = 0;
      this.queue = new Int32Array(N);
      this.bufs = [];
      for (let k = 0; k <= g.n + 1; k++) this.bufs.push(new Int32Array(Math.max(1, g.n)));
    }
    reset(start) {
      this.visited.fill(0);
      this.remaining = this.g.n;
      this.lo = 0; this.hi = 0;
      this.p = start;
      this.visit(start);
    }
    visit(c) {
      const k = this.g.nid[c];
      this.visited[c] = 1; this.remaining--;
      if (k < 32) this.lo |= (1 << k); else this.hi |= (1 << (k - 32));
    }
    unvisit(c) {
      const k = this.g.nid[c];
      this.visited[c] = 0; this.remaining++;
      if (k < 32) this.lo &= ~(1 << k); else this.hi &= ~(1 << (k - 32));
    }
    isWall(c) {
      const t = this.g.types[c];
      return t === HOLE || (t === NORMAL && this.visited[c] === 1);
    }
    // One press in direction d from tile 'from'. -1 = nothing happens; otherwise (to << 1) | (1 if you land on a new tile)
    slide(from, d) {
      const nbr = this.g.nbr, types = this.g.types;
      let q = nbr[from * 4 + d];
      if (q < 0 || this.isWall(q)) return -1;
      for (;;) {
        if (types[q] === NORMAL) return (q << 1) | 1;
        const r = nbr[q * 4 + d];
        if (r < 0 || this.isWall(r)) return q << 1;
        q = r;
      }
    }
    // All new tiles you can reach (possibly by wandering on the ice) without using other tiles first.
    targets(out) {
      const m = ++this.stamp, seen = this.seen, tmark = this.tmark, q = this.queue;
      let qh = 0, qt = 0, cnt = 0;
      seen[this.p] = m; q[qt++] = this.p;
      while (qh < qt) {
        const r = q[qh++];
        for (let d = 0; d < 4; d++) {
          const s = this.slide(r, d);
          if (s < 0) continue;
          const to = s >> 1;
          if (s & 1) { if (tmark[to] !== m) { tmark[to] = m; out[cnt++] = to; } }
          else if (seen[to] !== m) { seen[to] = m; q[qt++] = to; }
        }
      }
      return cnt;
    }
    // Shortest sequence of presses from the current position to land on 'target'. Returns { dirs, iceMoves } or null.
    routeTo(target) {
      const N = this.g.N;
      const prev = new Int32Array(N).fill(-2), prevD = new Int8Array(N);
      const q = [this.p];
      prev[this.p] = -1;
      while (q.length) {
        const r = q.shift();
        for (let d = 0; d < 4; d++) {
          const s = this.slide(r, d);
          if (s < 0) continue;
          const to = s >> 1;
          if ((s & 1) && to === target) {
            let dirs = DIRS[d], ice = this.g.types[this.g.nbr[r * 4 + d]] === ICE ? 1 : 0, c = r;
            while (prev[c] >= 0) { dirs = DIRS[prevD[c]] + dirs; ice++; c = prev[c]; } // intermediate stops are always on ice
            return { dirs, iceMoves: ice };
          }
          if (!(s & 1) && prev[to] === -2) { prev[to] = r; prevD[to] = d; q.push(to); }
        }
      }
      return null;
    }
    // "Obviously dead" for a sensible player (safe rules, never removes a real solution):
    //  - a tile with no way in, or two tiles that can only be the end tile
    //  - the remaining tiles don't lie in one connected area (tiles + ice) that the piece is standing next to
    ok() {
      if (this.remaining === 0) return true;
      const g = this.g, types = g.types, nbr = g.nbr, vis = this.visited, p = this.p;
      const m = ++this.stamp, tmark = this.tmark;
      for (let d = 0; d < 4; d++) { const c = nbr[p * 4 + d]; if (c >= 0) tmark[c] = m; }
      let forced = 0, u0 = -1;
      for (const u of g.normals) {
        if (vis[u]) continue;
        if (u0 < 0) u0 = u;
        let nn = 0, ic = 0;
        for (let d = 0; d < 4; d++) {
          const c = nbr[u * 4 + d];
          if (c < 0) continue;
          if (types[c] === ICE) ic++;
          else if (types[c] === NORMAL && !vis[c]) nn++;
        }
        const pa = tmark[u] === m ? 1 : 0;
        if (nn + ic + pa === 0) return false;
        if (ic === 0 && nn + pa <= 1 && ++forced > 1) return false;
      }
      const s = ++this.stamp, seen = this.seen, q = this.queue;
      let qh = 0, qt = 0, normals = 0, touch = false;
      seen[u0] = s; q[qt++] = u0;
      while (qh < qt) {
        const u = q[qh++];
        if (types[u] === NORMAL) normals++;
        if (tmark[u] === m) touch = true;
        for (let d = 0; d < 4; d++) {
          const c = nbr[u * 4 + d];
          if (c < 0 || seen[c] === s || this.isWall(c)) continue;
          seen[c] = s; q[qt++] = c;
        }
      }
      return normals === this.remaining && touch;
    }
    key() { return ((this.hi >>> 0) * 4294967296 + (this.lo >>> 0)) * 64 + this.g.nid[this.p]; }
  }

  function countSolutions(g, start, cap = 2, budget = 2e6, search) {
    const S = search || new IceSearch(g);
    S.reset(start);
    if (!S.ok()) return { count: 0, minRem: S.remaining };
    let count = 0, nodes = 0, minRem = S.remaining;
    const dfs = (depth) => {
      if (S.remaining < minRem) minRem = S.remaining;
      if (S.remaining === 0) { count++; return; }
      if (++nodes > budget) throw new Budget();
      const out = S.bufs[depth], k = S.targets(out), from = S.p;
      for (let i = 0; i < k; i++) {
        const t = out[i];
        S.visit(t); S.p = t;
        if (S.ok()) dfs(depth + 1);
        S.unvisit(t); S.p = from;
        if (count >= cap) return;
      }
    };
    try { dfs(0); } catch (e) { if (e instanceof Budget) return { count: -1, minRem }; throw e; }
    return { count, minRem };
  }

  // Same model as the other games: a "move" is the choice of the next tile (wandering on the ice in between is free).
  function analyze(g, start, opts = {}) {
    if (g.n > 47) throw new Error('too many tiles');
    const budget = opts.budget || 3e6;
    const S = new IceSearch(g);
    S.reset(start);
    if (!S.ok()) return { solutions: 0 };
    const memo = new Map();
    const K = LMAX + 3;
    const SOLVED = new Float64Array(K);
    SOLVED[0] = 1; SOLVED[1] = INF;
    for (let L = 0; L <= LMAX; L++) SOLVED[2 + L] = 1;
    let nodes = 0;
    const node = (depth) => {
      if (S.remaining === 0) return SOLVED;
      const key = S.key();
      let r = memo.get(key);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      const out = S.bufs[depth], k = S.targets(out), from = S.p;
      const kids = [];
      for (let i = 0; i < k; i++) {
        const t = out[i];
        S.visit(t); S.p = t;
        if (S.ok()) kids.push(node(depth + 1));
        S.unvisit(t); S.p = from;
      }
      r = new Float64Array(K);
      let sol = 0, hmax = -1;
      for (const c of kids) { sol += c[0]; if (c[1] > hmax) hmax = c[1]; }
      r[0] = sol;
      r[1] = sol > 0 ? INF : hmax + 1;
      for (let L = 0; L <= LMAX; L++) {
        let sum = 0, cnt = 0;
        for (const c of kids) if (c[1] >= L) { sum += c[2 + L]; cnt++; }
        r[2 + L] = cnt ? sum / cnt : 0;
      }
      memo.set(key, r);
      return r;
    };
    let root;
    try { root = node(0); } catch (e) { if (e instanceof Budget) return { solutions: -1 }; throw e; }
    const P = Array.from(root.subarray(2));
    const res = { solutions: root[0], states: nodes, P, bits: P.map(p => (p > 0 ? -Math.log2(p) : Infinity)) };
    if (root[0] !== 1) return res;
    // Walk through the unique solution: order, concrete presses and traps
    S.reset(start);
    const order = [start];
    let dirs = '', iceMoves = 0, maxTrap = 0, choices = 0, depth = 0;
    while (S.remaining > 0) {
      const out = S.bufs[depth], k = S.targets(out), from = S.p;
      let next = -1, real = false;
      for (let i = 0; i < k; i++) {
        const t = out[i];
        S.visit(t); S.p = t;
        if (S.ok()) {
          const r = S.remaining === 0 ? null : memo.get(S.key());
          if (!r || r[0] > 0) next = t;
          else { real = true; if (r[1] + 1 > maxTrap) maxTrap = r[1] + 1; }
        }
        S.unvisit(t); S.p = from;
      }
      if (real) choices++;
      const route = S.routeTo(next);
      dirs += route.dirs;
      iceMoves += route.iceMoves;
      S.visit(next); S.p = next;
      order.push(next);
      depth++;
    }
    return Object.assign(res, { order, dirs, iceMoves, maxTrap, choices });
  }

  // Naive player: picks at random among all tiles it can reach. Counts near-solutions.
  function analyzeRaw(g, start, opts = {}) {
    const budget = opts.budget || 3e6;
    const S = new IceSearch(g);
    S.reset(start);
    const memo = new Map();
    let nodes = 0;
    const node = (depth) => {
      if (S.remaining === 0) return [1, 1, 0, 0];
      const key = S.key();
      let r = memo.get(key);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      const out = S.bufs[depth], k = S.targets(out), from = S.p;
      let p = 0, paths = 0, near1 = 0, near2 = 0;
      for (let i = 0; i < k; i++) {
        const t = out[i];
        S.visit(t); S.p = t;
        const c = node(depth + 1);
        S.unvisit(t); S.p = from;
        p += c[0]; paths += c[1]; near1 += c[2]; near2 += c[3];
      }
      r = k === 0 ? [0, 1, S.remaining === 1 ? 1 : 0, S.remaining === 2 ? 1 : 0] : [p / k, paths, near1, near2];
      memo.set(key, r);
      return r;
    };
    try {
      const r = node(0);
      return { P: r[0], bits: -Math.log2(r[0]), paths: r[1], near1: r[2], near2: r[3], states: nodes };
    } catch (e) { if (e instanceof Budget) return null; throw e; }
  }

  // Level as text: '#' tile, '~' ice, '.' hole, 'S' start (a normal tile).
  function parseLevel(rows) {
    const h = rows.length, w = rows[0].length;
    const types = new Uint8Array(w * h);
    let start = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x], i = y * w + x;
      types[i] = ch === '.' ? HOLE : ch === '~' ? ICE : NORMAL;
      if (ch === 'S') start = i;
    }
    return { w, h, types, start };
  }
  function levelToRows(w, h, types, start) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) { const i = y * w + x; s += i === start ? 'S' : types[i] === HOLE ? '.' : types[i] === ICE ? '~' : '#'; }
      rows.push(s);
    }
    return rows;
  }
  function canonical(w, h, types, start) {
    let best = null;
    const T = w === h ? 8 : 4;
    for (let t = 0; t < T; t++) {
      let s = '';
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let sx, sy;
        switch (t) {
          case 0: sx = x; sy = y; break;
          case 1: sx = w - 1 - x; sy = y; break;
          case 2: sx = x; sy = h - 1 - y; break;
          case 3: sx = w - 1 - x; sy = h - 1 - y; break;
          case 4: sx = y; sy = x; break;
          case 5: sx = h - 1 - y; sy = x; break;
          case 6: sx = y; sy = w - 1 - x; break;
          case 7: sx = h - 1 - y; sy = w - 1 - x; break;
        }
        const i = sy * w + sx;
        s += i === start ? 'S' : '.#~'[types[i]];
      }
      if (best === null || s < best) best = s;
    }
    return best;
  }

  return { INF, LMAX, DIRS, DX, DY, HOLE, NORMAL, ICE, buildBoard, IceSearch, countSolutions, analyze, analyzeRaw, parseLevel, levelToRows, canonical };
});
