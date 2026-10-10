'use strict';
// General engine for all variants: 1 or 2 pieces (shared control), tile types:
//   hole, normal tile (used once and disappears), ice (permanent; you slide), crossing (permanent; you stop).
// A press moves all pieces in the same direction; if they are on the same line, the one in front moves first.
// When sliding on ice you keep going until you hit something you can't walk on (stop on the ice),
// or a normal tile/crossing (you land/stop on it).
// Goal: every normal tile used. Movement on ice/crossings without new tiles is free; a "move" in
// the difficulty model is therefore an "event" = a press that uses new tiles (1 or 2).
// Works in Node and the browser (window.MixSolver).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MixSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const INF = 1e9;
  const LMAX = 8;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const DIRS = 'URDL';
  const HOLE = 0, NORMAL = 1, ICE = 2, PERM = 3;

  class Budget extends Error {}

  function buildBoard(w, h, types, nums) {
    const N = w * h;
    const nid = new Int32Array(N).fill(-1);
    const normals = [];
    let ice = 0, perm = 0;
    for (let i = 0; i < N; i++) {
      if (types[i] === NORMAL) { nid[i] = normals.length; normals.push(i); }
      if (types[i] === ICE) ice++;
      if (types[i] === PERM) perm++;
    }
    const nbr = new Int32Array(N * 4).fill(-1);
    for (let i = 0; i < N; i++) {
      const x = i % w, y = (i / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) nbr[i * 4 + d] = ny * w + nx;
      }
    }
    const num = nums ? Int8Array.from(nums) : new Int8Array(N);
    let K = 0;
    for (let i = 0; i < N; i++) if (num[i] > K) K = num[i];
    return { w, h, N, types: Uint8Array.from(types), nid, normals, n: normals.length, nbr, ice, perm, num, K };
  }

  // How far ahead a cell is in direction d (to decide who moves first)
  function progress(g, c, d) {
    const x = c % g.w, y = (c / g.w) | 0;
    return d === 0 ? -y : d === 1 ? x : d === 2 ? y : -x;
  }

  class MixSearch {
    constructor(g, pieces) {
      this.g = g;
      this.pieces = pieces;
      const N = g.N;
      this.visited = new Uint8Array(N);
      this.seen = new Int32Array(N * (N + 1));
      this.stamp = 0;
      this.mark = new Int32Array(N);
      this.mark2 = new Int32Array(N);
      this.comp = new Int32Array(N);
      this.queue = new Int32Array(N * (N + 1) * 2 + 4);
      this.res = new Int32Array(4);
    }
    reset(a, b) {
      this.visited.fill(0);
      this.remaining = this.g.n;
      this.lo = 0; this.hi = 0;
      this.numDone = 0;
      this.a = a; this.b = this.pieces === 2 ? b : -1;
      if (this.g.types[a] === NORMAL) this.visit(a);
      if (this.b >= 0 && this.g.types[this.b] === NORMAL) this.visit(this.b);
    }
    visit(c) {
      const k = this.g.nid[c];
      this.visited[c] = 1; this.remaining--;
      if (this.g.num[c]) this.numDone++;
      if (k < 32) this.lo |= (1 << k); else this.hi |= (1 << (k - 32));
    }
    unvisit(c) {
      const k = this.g.nid[c];
      this.visited[c] = 0; this.remaining++;
      if (this.g.num[c]) this.numDone--;
      if (k < 32) this.lo &= ~(1 << k); else this.hi &= ~(1 << (k - 32));
    }
    // Simulate one press from the piece positions (x, y). Writes [x2, y2, landX, landY] to this.res. false if nothing moves.
    press(x, y, d) {
      const g = this.g, types = g.types, nbr = g.nbr, vis = this.visited, r = this.res, num = g.num;
      const nd = this.numDone; // checkpoints taken before this press: both pieces move at once, so one press cannot take two checkpoints
      const pos0 = x, pos1 = y;
      let p0 = x, p1 = y, l0 = 0, l1 = 0;
      const firstIs1 = y >= 0 && progress(g, y, d) > progress(g, x, d);
      for (let step = 0; step < 2; step++) {
        const k = (step === 0) === firstIs1 ? 1 : 0;
        const cur = k === 0 ? p0 : p1;
        if (cur < 0) continue;
        const other = k === 0 ? p1 : p0;
        let q = nbr[cur * 4 + d];
        if (q < 0 || q === other) continue;
        const tq = types[q];
        if (tq === HOLE || (tq === NORMAL && (vis[q] || (num[q] && num[q] !== nd + 1)))) continue;
        if (tq === ICE) {
          for (;;) {
            const nx = nbr[q * 4 + d];
            if (nx < 0 || nx === other) break;
            const tn = types[nx];
            if (tn === HOLE || (tn === NORMAL && (vis[nx] || (num[nx] && num[nx] !== nd + 1)))) break;
            q = nx;
            if (tn !== ICE) break;
          }
        }
        if (k === 0) { p0 = q; l0 = types[q] === NORMAL ? 1 : 0; } else { p1 = q; l1 = types[q] === NORMAL ? 1 : 0; }
      }
      if (p0 === pos0 && p1 === pos1) return false;
      r[0] = p0; r[1] = p1; r[2] = l0; r[3] = l1;
      return true;
    }
    pairIndex(x, y) { return x * (this.g.N + 1) + (y + 1); }
    // All events (presses that use new tiles) reachable via free movement. Returns a list of [la, lb, x, y]
    // where la/lb = new tile for piece 1/2 or -1. The pieces are identical, so (x, y) is normalized with x < y.
    events() {
      const g = this.g, N = g.N, seen = this.seen, q = this.queue, r = this.res;
      const m = ++this.stamp;
      const out = [], keys = new Set();
      let x0 = this.a, y0 = this.b;
      if (y0 >= 0 && y0 < x0) { const t = x0; x0 = y0; y0 = t; }
      let qh = 0, qt = 0;
      seen[this.pairIndex(x0, y0)] = m; q[qt++] = x0; q[qt++] = y0;
      while (qh < qt) {
        const x = q[qh++], y = q[qh++];
        for (let d = 0; d < 4; d++) {
          if (!this.press(x, y, d)) continue;
          let x2 = r[0], y2 = r[1], l0 = r[2], l1 = r[3];
          if (y2 >= 0 && y2 < x2) { let t = x2; x2 = y2; y2 = t; t = l0; l0 = l1; l1 = t; }
          if (l0 || l1) {
            const key = ((l0 ? x2 : 63) * 64 + (l1 ? y2 : 63)) * 4096 + x2 * 64 + (y2 + 1);
            if (!keys.has(key)) { keys.add(key); out.push([l0 ? x2 : -1, l1 ? y2 : -1, x2, y2]); }
          } else {
            const pi = this.pairIndex(x2, y2);
            if (seen[pi] !== m) { seen[pi] = m; q[qt++] = x2; q[qt++] = y2; }
          }
        }
      }
      return out;
    }
    apply(e) { if (e[0] >= 0) this.visit(e[0]); if (e[1] >= 0) this.visit(e[1]); this.a = e[2]; this.b = e[3]; }
    unapply(e, a, b) { if (e[0] >= 0) this.unvisit(e[0]); if (e[1] >= 0) this.unvisit(e[1]); this.a = a; this.b = b; }
    // Shortest sequence of presses from the current position to event e. Returns a string of directions.
    routeTo(e) {
      const N = this.g.N, r = this.res;
      let x0 = this.a, y0 = this.b;
      if (y0 >= 0 && y0 < x0) { const t = x0; x0 = y0; y0 = t; }
      const start = this.pairIndex(x0, y0);
      const prev = new Map([[start, null]]);
      const q = [[x0, y0]];
      while (q.length) {
        const [x, y] = q.shift();
        const here = this.pairIndex(x, y);
        for (let d = 0; d < 4; d++) {
          if (!this.press(x, y, d)) continue;
          let x2 = r[0], y2 = r[1], l0 = r[2], l1 = r[3];
          if (y2 >= 0 && y2 < x2) { let t = x2; x2 = y2; y2 = t; t = l0; l0 = l1; l1 = t; }
          if (l0 || l1) {
            if ((l0 ? x2 : -1) === e[0] && (l1 ? y2 : -1) === e[1] && x2 === e[2] && y2 === e[3]) {
              let dirs = DIRS[d], k = here;
              while (prev.get(k)) { const [pk, pd] = prev.get(k); dirs = DIRS[pd] + dirs; k = pk; }
              return dirs;
            }
          } else {
            const pi = this.pairIndex(x2, y2);
            if (!prev.has(pi)) { prev.set(pi, [here, d]); q.push([x2, y2]); }
          }
        }
      }
      return null;
    }
    // "Obviously dead" (safe rules): a tile with no way in, too many forced end tiles,
    // or remaining tiles spread over more areas than the pieces can reach.
    ok() {
      if (this.remaining === 0) return true;
      const g = this.g, types = g.types, nbr = g.nbr, vis = this.visited;
      const P = this.b >= 0 ? [this.a, this.b] : [this.a];
      const m = ++this.stamp, mark = this.mark;
      // neighbors of pieces standing on a used tile (can step straight in)
      for (const p of P) if (types[p] === NORMAL) for (let d = 0; d < 4; d++) { const c = nbr[p * 4 + d]; if (c >= 0) mark[c] = m; }
      let forced = 0, u0 = -1;
      for (const u of g.normals) {
        if (vis[u]) continue;
        if (u0 < 0) u0 = u;
        let nn = 0, re = 0;
        for (let d = 0; d < 4; d++) {
          const c = nbr[u * 4 + d];
          if (c < 0) continue;
          const t = types[c];
          if (t === ICE || t === PERM) re++;
          else if (t === NORMAL && !vis[c]) nn++;
        }
        const pa = mark[u] === m ? 1 : 0;
        if (nn + re + pa === 0) return false;
        if (re === 0 && nn + pa <= 1 && ++forced > P.length) return false;
      }
      // areas of (unused tiles + ice + crossings); each area with unused tiles must be reachable by its own piece
      const s = ++this.stamp, comp = this.comp, mark2 = this.mark2;
      const q = this.queue;
      const touches = []; // per area: bitmask of pieces standing in/next to the area
      let nComp = 0;
      for (const u of g.normals) {
        if (vis[u] || mark2[u] === s) continue;
        let qh = 0, qt = 0, touch = 0;
        mark2[u] = s; q[qt++] = u;
        while (qh < qt) {
          const c = q[qh++];
          for (let k = 0; k < P.length; k++) {
            if (P[k] === c) touch |= 1 << k;
            for (let d = 0; d < 4; d++) if (nbr[P[k] * 4 + d] === c) touch |= 1 << k;
          }
          for (let d = 0; d < 4; d++) {
            const x = nbr[c * 4 + d];
            if (x < 0 || mark2[x] === s) continue;
            const t = types[x];
            if (t === HOLE || (t === NORMAL && vis[x])) continue;
            mark2[x] = s; q[qt++] = x;
          }
        }
        if (!touch) return false;
        touches.push(touch);
        if (++nComp > P.length) return false;
      }
      if (nComp === 2 && !(((touches[0] & 1) && (touches[1] & 2)) || ((touches[0] & 2) && (touches[1] & 1)))) return false;
      return true;
    }
    key() {
      let x = this.a, y = this.b;
      if (y >= 0 && y < x) { const t = x; x = y; y = t; }
      return ((this.hi >>> 0) * 4294967296 + (this.lo >>> 0)) * 4096 + x * 64 + (y + 1);
    }
  }

  function countSolutions(g, pieces, a, b, cap = 2, budget = 2e6) {
    const S = new MixSearch(g, pieces);
    S.reset(a, b);
    if (!S.ok()) return { count: 0, minRem: S.remaining };
    let count = 0, nodes = 0, minRem = S.remaining;
    const dfs = () => {
      if (S.remaining < minRem) minRem = S.remaining;
      if (S.remaining === 0) { count++; return; }
      if (++nodes > budget) throw new Budget();
      const evs = S.events(), pa = S.a, pb = S.b;
      for (const e of evs) {
        S.apply(e);
        if (S.ok()) dfs();
        S.unapply(e, pa, pb);
        if (count >= cap) return;
      }
    };
    try { dfs(); } catch (e) { if (e instanceof Budget) return { count: -1, minRem }; throw e; }
    return { count, minRem };
  }

  // Can you still reach the goal from a given position? Used by "Check course" in the browser, so the page doesn't need
  // to contain the solution. used = used tiles (cell numbers), pos = the pieces' positions.
  // Returns true/false, or null if the budget is exceeded.
  function solvableFrom(g, pieces, used, pos, budget = 3e6) {
    const S = new MixSearch(g, pieces);
    S.visited.fill(0);
    S.remaining = g.n; S.lo = 0; S.hi = 0; S.numDone = 0;
    for (const c of used) if (g.types[c] === NORMAL && !S.visited[c]) S.visit(c);
    S.a = pos[0]; S.b = pieces === 2 ? pos[1] : -1;
    if (S.remaining === 0) return true;
    if (!S.ok()) return false;
    const dead = new Set(); // positions proven impossible
    const key = () => {
      if (g.n <= 40) return S.key();
      let x = S.a, y = S.b;
      if (y >= 0 && y < x) { const t = x; x = y; y = t; }
      return `${S.hi >>> 0},${S.lo >>> 0},${x},${y}`;
    };
    let nodes = 0;
    const dfs = () => {
      if (S.remaining === 0) return true;
      const k = key();
      if (dead.has(k)) return false;
      if (++nodes > budget) throw new Budget();
      const evs = S.events(), pa = S.a, pb = S.b;
      for (const e of evs) {
        S.apply(e);
        const found = S.ok() && dfs();
        S.unapply(e, pa, pb);
        if (found) return true;
      }
      dead.add(k);
      return false;
    };
    try { return dfs(); } catch (e) { if (e instanceof Budget) return null; throw e; }
  }

  // Same difficulty model as the other games, with events as moves.
  function analyze(g, pieces, a0, b0, opts = {}) {
    if (g.n > 40) throw new Error('too many tiles');
    const budget = opts.budget || 3e6;
    const S = new MixSearch(g, pieces);
    S.reset(a0, b0);
    if (!S.ok()) return { solutions: 0 };
    const memo = new Map();
    const K = LMAX + 3;
    const SOLVED = new Float64Array(K);
    SOLVED[0] = 1; SOLVED[1] = INF;
    for (let L = 0; L <= LMAX; L++) SOLVED[2 + L] = 1;
    let nodes = 0;
    const node = () => {
      if (S.remaining === 0) return SOLVED;
      const key = S.key();
      let r = memo.get(key);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      const evs = S.events(), pa = S.a, pb = S.b;
      const kids = [];
      for (const e of evs) {
        S.apply(e);
        if (S.ok()) kids.push(node());
        S.unapply(e, pa, pb);
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
    try { root = node(); } catch (e) { if (e instanceof Budget) return { solutions: -1 }; throw e; }
    const P = Array.from(root.subarray(2));
    const res = { solutions: root[0], states: nodes, P, bits: P.map(p => (p > 0 ? -Math.log2(p) : Infinity)) };
    if (root[0] !== 1) return res;
    // Walk through the unique solution
    S.reset(a0, b0);
    const events = [];
    let dirs = '', maxTrap = 0, choices = 0;
    while (S.remaining > 0) {
      const evs = S.events(), pa = S.a, pb = S.b;
      let next = null, real = false;
      for (const e of evs) {
        S.apply(e);
        if (S.ok()) {
          const r = S.remaining === 0 ? null : memo.get(S.key());
          if (!r || r[0] > 0) next = e;
          else { real = true; if (r[1] + 1 > maxTrap) maxTrap = r[1] + 1; }
        }
        S.unapply(e, pa, pb);
      }
      if (real) choices++;
      dirs += S.routeTo(next);
      S.apply(next);
      events.push([next[0], next[1]].filter(c => c >= 0));
    }
    return Object.assign(res, { dirs, events, maxTrap, choices }, playStats(g, pieces, a0, b0, dirs));
  }

  // Statistics for a concrete sequence of presses: slides on ice, visits to crossings, tiles per piece, moves with only one piece
  function playStats(g, pieces, a0, b0, dirs) {
    const S = new MixSearch(g, pieces);
    S.reset(a0, b0);
    let x = S.a, y = S.b;
    let iceMoves = 0, permVisits = 0, solo = 0;
    const lens = [0, 0];
    for (const ch of dirs) {
      const d = DIRS.indexOf(ch);
      S.press(x, y, d);
      const [x2, y2, l0, l1] = S.res;
      const moved = [x2 !== x, y >= 0 && y2 !== y];
      const slid = [x, y].some((p, k) => moved[k] && g.types[g.nbr[p * 4 + d]] === ICE);
      if (slid) iceMoves++;
      if ((moved[0] && g.types[x2] === PERM) || (moved[1] && g.types[y2] === PERM)) permVisits++;
      if (pieces === 2 && moved[0] !== moved[1]) solo++;
      if (l0) { S.visit(x2); lens[0]++; }
      if (l1) { S.visit(y2); lens[1]++; }
      x = x2; y = y2;
    }
    return { iceMoves, permVisits, solo, lens, presses: dirs.length };
  }

  // Naive player: random event among all possible ones. Counts near-solutions.
  function analyzeRaw(g, pieces, a0, b0, opts = {}) {
    const budget = opts.budget || 3e6;
    const S = new MixSearch(g, pieces);
    S.reset(a0, b0);
    const memo = new Map();
    let nodes = 0;
    const node = () => {
      if (S.remaining === 0) return [1, 1, 0, 0];
      const key = S.key();
      let r = memo.get(key);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      const evs = S.events(), pa = S.a, pb = S.b;
      let p = 0, paths = 0, near1 = 0, near2 = 0;
      for (const e of evs) {
        S.apply(e);
        const c = node();
        S.unapply(e, pa, pb);
        p += c[0]; paths += c[1]; near1 += c[2]; near2 += c[3];
      }
      r = evs.length === 0 ? [0, 1, S.remaining === 1 ? 1 : 0, S.remaining === 2 ? 1 : 0] : [p / evs.length, paths, near1, near2];
      memo.set(key, r);
      return r;
    };
    try {
      const r = node();
      return { P: r[0], bits: -Math.log2(r[0]), paths: r[1], near1: r[2], near2: r[3], states: nodes };
    } catch (e) { if (e instanceof Budget) return null; throw e; }
  }

  // Level as text: '#' tile, '.' hole, '~' ice, '+' crossing, '1'-'9' numbered checkpoints (taken in order),
  // 'S'/'A' first piece, 'B' second piece (on a tile), 'a'/'b' piece that starts on a crossing.
  function parseLevel(rows) {
    const h = rows.length, w = rows[0].length;
    const types = new Uint8Array(w * h), nums = new Int8Array(w * h);
    let a = -1, b = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x], i = y * w + x;
      types[i] = ch === '.' ? HOLE : ch === '~' ? ICE : (ch === '+' || ch === 'a' || ch === 'b') ? PERM : NORMAL;
      if (ch >= '1' && ch <= '9') nums[i] = +ch;
      if (ch === 'S' || ch === 'A' || ch === 'a') a = i;
      if (ch === 'B' || ch === 'b') b = i;
    }
    return { w, h, types, nums, a, b, pieces: b >= 0 ? 2 : 1 };
  }
  function levelToRows(w, h, types, a, b, nums) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (i === a) s += types[i] === PERM ? 'a' : (b >= 0 ? 'A' : 'S');
        else if (i === b) s += types[i] === PERM ? 'b' : 'B';
        else s += nums && nums[i] ? String(nums[i]) : '.#~+'[types[i]];
      }
      rows.push(s);
    }
    return rows;
  }
  function canonical(w, h, types, a, b, nums) {
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
        s += (i === a || i === b) ? 'P' : nums && nums[i] ? String(nums[i]) : '.#~+'[types[i]];
      }
      if (best === null || s < best) best = s;
    }
    return best;
  }

  return { INF, LMAX, DIRS, DX, DY, HOLE, NORMAL, ICE, PERM, buildBoard, MixSearch, countSolutions, solvableFrom, analyze, analyzeRaw, playStats, parseLevel, levelToRows, canonical };
});
