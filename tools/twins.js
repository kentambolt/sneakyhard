'use strict';
// "I takt": to brikker, én styring. Begge brikker flytter i samme retning; en brik der ikke kan, bliver stående.
// Hvert felt kan kun betrædes én gang (startfelterne tæller som betrådt). Mål: alle felter betrådt.
// Solver + sværhedsmåler i samme stil som solver.js. Virker i Node og browser (window.TwinSolver).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TwinSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const INF = 1e9;
  const LMAX = 8;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const DIRS = 'URDL';

  class Budget extends Error {}

  function buildBoard(w, h, mask) {
    const id = new Int32Array(w * h).fill(-1);
    const cells = [];
    for (let i = 0; i < w * h; i++) if (mask[i]) { id[i] = cells.length; cells.push(i); }
    const n = cells.length;
    const nb = new Int32Array(n * 4).fill(-1);
    for (let k = 0; k < n; k++) {
      const x = cells[k] % w, y = (cells[k] / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) nb[k * 4 + d] = id[ny * w + nx];
      }
    }
    return { w, h, n, cells, id, nb };
  }

  // Antal sammenhængende øer på brættet
  function components(g) {
    const seen = new Uint8Array(g.n);
    let c = 0;
    for (let s = 0; s < g.n; s++) {
      if (seen[s]) continue;
      c++;
      const st = [s];
      seen[s] = 1;
      while (st.length) {
        const u = st.pop();
        for (let d = 0; d < 4; d++) { const v = g.nb[u * 4 + d]; if (v >= 0 && !seen[v]) { seen[v] = 1; st.push(v); } }
      }
    }
    return c;
  }

  class TwinSearch {
    constructor(g) {
      this.g = g;
      const n = g.n;
      this.visited = new Uint8Array(n);
      this.deg = new Int32Array(n);
      this.adjA = new Int32Array(n);
      this.adjB = new Int32Array(n);
      this.seen = new Int32Array(n);
      this.stamp = 0;
      this.stack = new Int32Array(n);
    }
    reset(a, b) {
      const g = this.g;
      this.visited.fill(0);
      for (let k = 0; k < g.n; k++) {
        let c = 0;
        for (let d = 0; d < 4; d++) if (g.nb[k * 4 + d] >= 0) c++;
        this.deg[k] = c;
      }
      this.remaining = g.n;
      this.lo = 0; this.hi = 0;
      this.visit(a); this.visit(b);
      this.a = a; this.b = b;
    }
    visit(v) {
      const nb = this.g.nb;
      this.visited[v] = 1; this.remaining--;
      for (let d = 0; d < 4; d++) { const u = nb[v * 4 + d]; if (u >= 0) this.deg[u]--; }
      if (v < 32) this.lo |= (1 << v); else this.hi |= (1 << (v - 32));
    }
    unvisit(v) {
      const nb = this.g.nb;
      this.visited[v] = 0; this.remaining++;
      for (let d = 0; d < 4; d++) { const u = nb[v * 4 + d]; if (u >= 0) this.deg[u]++; }
      if (v < 32) this.lo &= ~(1 << v); else this.hi &= ~(1 << (v - 32));
    }
    // Flyt i retning d. Returnerer 0 hvis ingen brik kan flytte, ellers bit0 = A flyttede, bit1 = B flyttede.
    move(d) {
      const nb = this.g.nb, vis = this.visited;
      const ta = nb[this.a * 4 + d], tb = nb[this.b * 4 + d];
      const ma = ta >= 0 && !vis[ta], mb = tb >= 0 && !vis[tb];
      if (!ma && !mb) return 0;
      if (ma) { this.visit(ta); this.a = ta; }
      if (mb) { this.visit(tb); this.b = tb; }
      return (ma ? 1 : 0) | (mb ? 2 : 0);
    }
    unmove(code, prevA, prevB) {
      if (code & 1) this.unvisit(this.a);
      if (code & 2) this.unvisit(this.b);
      this.a = prevA; this.b = prevB;
    }
    // "Åbenlyst død" for en fornuftig spiller: et felt kan ikke nås, for mange tvungne slutfelter,
    // eller øer der ikke kan dækkes af hver sin brik.
    ok() {
      const rem = this.remaining;
      if (rem === 0) return true;
      const g = this.g, n = g.n, nb = g.nb, vis = this.visited, deg = this.deg;
      const a = this.a, b = this.b;
      const liveA = deg[a] > 0, liveB = deg[b] > 0;
      const k = (liveA ? 1 : 0) + (liveB ? 1 : 0);
      if (k === 0) return false;
      const m = ++this.stamp, adjA = this.adjA, adjB = this.adjB;
      if (liveA) for (let d = 0; d < 4; d++) { const u = nb[a * 4 + d]; if (u >= 0) adjA[u] = m; }
      if (liveB) for (let d = 0; d < 4; d++) { const u = nb[b * 4 + d]; if (u >= 0) adjB[u] = m; }
      let forced = 0;
      for (let u = 0; u < n; u++) {
        if (vis[u]) continue;
        const du = deg[u], p = (adjA[u] === m ? 1 : 0) + (adjB[u] === m ? 1 : 0);
        if (du + p === 0) return false;
        if ((du === 0 || du + p === 1) && ++forced > k) return false;
      }
      const seen = this.seen, st = this.stack;
      let comps = 0, c1A = false, c1B = false, c2A = false, c2B = false;
      for (let s = 0; s < n; s++) {
        if (vis[s] || seen[s] === m) continue;
        if (++comps > k) return false;
        let hasA = false, hasB = false;
        seen[s] = m; st[0] = s;
        let sp = 1;
        while (sp) {
          const u = st[--sp];
          if (adjA[u] === m) hasA = true;
          if (adjB[u] === m) hasB = true;
          for (let d = 0; d < 4; d++) {
            const x = nb[u * 4 + d];
            if (x >= 0 && !vis[x] && seen[x] !== m) { seen[x] = m; st[sp++] = x; }
          }
        }
        if (!hasA && !hasB) return false;
        if (comps === 1) { c1A = hasA; c1B = hasB; } else { c2A = hasA; c2B = hasB; }
      }
      if (comps === 2 && !((c1A && c2B) || (c1B && c2A))) return false;
      return true;
    }
    pieceKey() { return this.a < this.b ? this.a * 64 + this.b : this.b * 64 + this.a; }
    memoGet(memo) {
      if (this.g.n <= 40) return memo.get(((this.hi >>> 0) * 4294967296 + (this.lo >>> 0)) * 4096 + this.pieceKey());
      const m = memo.get(this.lo);
      return m === undefined ? undefined : m.get((this.hi >>> 0) * 4096 + this.pieceKey());
    }
    memoSet(memo, r) {
      if (this.g.n <= 40) { memo.set(((this.hi >>> 0) * 4294967296 + (this.lo >>> 0)) * 4096 + this.pieceKey(), r); return; }
      let m = memo.get(this.lo);
      if (m === undefined) { m = new Map(); memo.set(this.lo, m); }
      m.set((this.hi >>> 0) * 4096 + this.pieceKey(), r);
    }
  }

  // Antal løsninger (træksekvenser) op til cap. minRem = færrest resterende felter set (til annealing-gradient).
  function countSolutions(g, a, b, cap = 2, budget = 2e6, search) {
    const S = search || new TwinSearch(g);
    S.reset(a, b);
    if (!S.ok()) return { count: 0, minRem: S.remaining };
    let count = 0, nodes = 0, minRem = S.remaining;
    const dfs = () => {
      if (S.remaining < minRem) minRem = S.remaining;
      if (S.remaining === 0) { count++; return; }
      if (++nodes > budget) throw new Budget();
      for (let d = 0; d < 4; d++) {
        const pa = S.a, pb = S.b;
        const code = S.move(d);
        if (!code) continue;
        if (S.ok()) dfs();
        S.unmove(code, pa, pb);
        if (count >= cap) return;
      }
    };
    try { dfs(); } catch (e) { if (e instanceof Budget) return { count: -1, minRem }; throw e; }
    return { count, minRem };
  }

  // Fuld analyse, samme model som det første spil: P[L] = chancen for at løse banen i første forsøg for en spiller,
  // der aldrig laver åbenlyse fejl og kan se L træk frem. bits[L] = -log2 P[L].
  function analyze(g, a0, b0, opts = {}) {
    const budget = opts.budget || 3e6;
    const S = new TwinSearch(g);
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
      let r = S.memoGet(memo);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      const kids = [];
      for (let d = 0; d < 4; d++) {
        const pa = S.a, pb = S.b;
        const code = S.move(d);
        if (!code) continue;
        if (S.ok()) kids.push(node());
        S.unmove(code, pa, pb);
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
      S.memoSet(memo, r);
      return r;
    };
    let root;
    try { root = node(); } catch (e) { if (e instanceof Budget) return { solutions: -1 }; throw e; }
    const P = Array.from(root.subarray(2));
    const res = { solutions: root[0], states: nodes, P, bits: P.map(p => (p > 0 ? -Math.log2(p) : Infinity)) };
    if (root[0] !== 1) return res;
    // Gå den unikke løsning igennem
    S.reset(a0, b0);
    let moves = '', maxTrap = 0, choices = 0, solo = 0;
    const turns = [0, 0], lens = [0, 0], last = [-1, -1]; // sving og antal felter pr. brik i løsningen
    while (S.remaining > 0) {
      let next = -1, real = false;
      for (let d = 0; d < 4; d++) {
        const pa = S.a, pb = S.b;
        const code = S.move(d);
        if (!code) continue;
        if (S.ok()) {
          const r = S.remaining === 0 ? null : S.memoGet(memo);
          if (!r || r[0] > 0) next = d;
          else { real = true; if (r[1] + 1 > maxTrap) maxTrap = r[1] + 1; }
        }
        S.unmove(code, pa, pb);
      }
      if (real) choices++;
      const code = S.move(next);
      if (code !== 3) solo++;
      for (const p of [0, 1]) {
        if (!(code & (1 << p))) continue;
        lens[p]++;
        if (last[p] >= 0 && last[p] !== next) turns[p]++;
        last[p] = next;
      }
      moves += DIRS[next];
    }
    return Object.assign(res, { moves, maxTrap, choices, solo, turns, lens });
  }

  // Helt naiv spiller: tilfældig retning blandt dem, der flytter noget. Tæller næsten-løsninger.
  function analyzeRaw(g, a0, b0, opts = {}) {
    const budget = opts.budget || 3e6;
    const S = new TwinSearch(g);
    S.reset(a0, b0);
    const memo = new Map();
    let nodes = 0;
    const node = () => {
      if (S.remaining === 0) return [1, 1, 0, 0];
      let r = S.memoGet(memo);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      let p = 0, paths = 0, near1 = 0, near2 = 0, moves = 0;
      for (let d = 0; d < 4; d++) {
        const pa = S.a, pb = S.b;
        const code = S.move(d);
        if (!code) continue;
        moves++;
        const c = node();
        S.unmove(code, pa, pb);
        p += c[0]; paths += c[1]; near1 += c[2]; near2 += c[3];
      }
      r = moves === 0 ? [0, 1, S.remaining === 1 ? 1 : 0, S.remaining === 2 ? 1 : 0] : [p / moves, paths, near1, near2];
      S.memoSet(memo, r);
      return r;
    };
    try {
      const r = node();
      return { P: r[0], bits: -Math.log2(r[0]), paths: r[1], near1: r[2], near2: r[3], states: nodes };
    } catch (e) { if (e instanceof Budget) return null; throw e; }
  }

  // Bane som tekst: '#' felt, '.' hul, 'A'/'B' brikkernes startfelter.
  function parseLevel(rows) {
    const h = rows.length, w = rows[0].length;
    const mask = new Uint8Array(w * h);
    let a = -1, b = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x], i = y * w + x;
      if (ch !== '.') mask[i] = 1;
      if (ch === 'A') a = i;
      if (ch === 'B') b = i;
    }
    return { w, h, mask, a, b };
  }
  function levelToRows(w, h, mask, a, b) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) { const i = y * w + x; s += i === a ? 'A' : i === b ? 'B' : mask[i] ? '#' : '.'; }
      rows.push(s);
    }
    return rows;
  }
  // Kanonisk form: spejlinger/rotationer ændrer retningerne konsistent, så banen er den samme. A og B er ombyttelige.
  function canonical(w, h, mask, a, b) {
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
        s += i === a || i === b ? 'P' : mask[i] ? '#' : '.';
      }
      if (best === null || s < best) best = s;
    }
    return best;
  }

  // Begge brikker skal lave rigtigt arbejde: mindst 2 sving og mindst en fjerdedel af felterne hver.
  // Ellers kører den ene bare i en lige linje, og banen er lettere at gennemskue.
  function shapeOK(an, n) {
    if (n < 10) return true; // opvarmningsbaner er for små til kravet
    const minLen = Math.max(3, Math.floor((n - 2) / 4));
    return Math.min(an.turns[0], an.turns[1]) >= 2 && Math.min(an.lens[0], an.lens[1]) >= minLen;
  }

  return { INF, LMAX, DIRS, DX, DY, shapeOK, buildBoard, components, TwinSearch, countSolutions, analyze, analyzeRaw, parseLevel, levelToRows, canonical };
});
