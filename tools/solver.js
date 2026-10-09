'use strict';
// Solver og sværhedsmåler for "besøg alle felter én gang"-baner (Hamilton-sti fra fast start).
// Virker både i Node (require) og i browseren (window.PathSolver).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PathSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const INF = 1e9;
  const LMAX = 8; // største lookahead vi måler med

  // Regler en "fornuftig" spiller (og solveren) bruger til at afvise træk med det samme:
  const RULE_DEG = 1;    // et felt kan ikke længere nås, eller to felter er blindgyder (kun én slutning)
  const RULE_CONN = 2;   // de resterende felter er delt i to øer
  const RULE_PARITY = 4; // tvunget slutfelt har forkert skakbrætfarve (subtilt - kun til tælling)
  const RULES_HUMAN = RULE_DEG | RULE_CONN;
  const RULES_ALL = RULE_DEG | RULE_CONN | RULE_PARITY;

  class Budget extends Error {}

  function buildGraph(w, h, mask) {
    const id = new Int32Array(w * h).fill(-1);
    const cells = [];
    for (let i = 0; i < w * h; i++) if (mask[i]) { id[i] = cells.length; cells.push(i); }
    const n = cells.length;
    const nbStart = new Int32Array(n + 1);
    const list = [];
    const color = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const i = cells[k], x = i % w, y = (i / w) | 0;
      color[k] = (x + y) & 1;
      nbStart[k] = list.length;
      if (y > 0 && id[i - w] >= 0) list.push(id[i - w]);
      if (x < w - 1 && id[i + 1] >= 0) list.push(id[i + 1]);
      if (y < h - 1 && id[i + w] >= 0) list.push(id[i + w]);
      if (x > 0 && id[i - 1] >= 0) list.push(id[i - 1]);
    }
    nbStart[n] = list.length;
    return { w, h, n, cells, id, nbStart, nb: Int32Array.from(list), color };
  }

  function isConnected(g) {
    if (g.n === 0) return false;
    const seen = new Uint8Array(g.n), st = [0];
    seen[0] = 1;
    let cnt = 1;
    while (st.length) {
      const u = st.pop();
      for (let j = g.nbStart[u]; j < g.nbStart[u + 1]; j++) {
        const v = g.nb[j];
        if (!seen[v]) { seen[v] = 1; cnt++; st.push(v); }
      }
    }
    return cnt === g.n;
  }

  // Skakbræt-paritet: en sti skifter farve hvert skridt, så startfarven skal være i flertal (eller lige mange).
  function parityAllowsStart(g, s) {
    let same = 0;
    for (let k = 0; k < g.n; k++) if (g.color[k] === g.color[s]) same++;
    const other = g.n - same;
    return same === other || same === other + 1;
  }

  class Search {
    constructor(g) {
      this.g = g;
      const n = g.n;
      this.visited = new Uint8Array(n);
      this.deg = new Int32Array(n);
      this.adj = new Int32Array(n);
      this.adjCtr = 0;
      this.seen = new Int32Array(n);
      this.seenCtr = 0;
      this.stack = new Int32Array(n);
      this.reset();
    }
    reset() {
      const g = this.g;
      this.visited.fill(0);
      for (let k = 0; k < g.n; k++) this.deg[k] = g.nbStart[k + 1] - g.nbStart[k];
      this.remaining = g.n;
      this.lo = 0; this.hi = 0;
    }
    visit(v) {
      const g = this.g;
      this.visited[v] = 1; this.remaining--;
      for (let j = g.nbStart[v]; j < g.nbStart[v + 1]; j++) this.deg[g.nb[j]]--;
      if (v < 32) this.lo |= (1 << v); else this.hi |= (1 << (v - 32));
    }
    unvisit(v) {
      const g = this.g;
      this.visited[v] = 0; this.remaining++;
      for (let j = g.nbStart[v]; j < g.nbStart[v + 1]; j++) this.deg[g.nb[j]]++;
      if (v < 32) this.lo &= ~(1 << v); else this.hi &= ~(1 << (v - 32));
    }
    // Kan stillingen (hoved = head, besøgte felter) stadig føre til en løsning ifølge reglerne?
    ok(head, rules) {
      const rem = this.remaining;
      if (rem === 0) return true;
      const g = this.g, n = g.n, vis = this.visited, deg = this.deg, nbS = g.nbStart, nb = g.nb;
      if (deg[head] === 0) return false;
      if (rules & RULE_DEG) {
        const m = ++this.adjCtr, adj = this.adj;
        for (let j = nbS[head]; j < nbS[head + 1]; j++) adj[nb[j]] = m;
        let ones = 0, end = -1;
        for (let k = 0; k < n; k++) {
          if (vis[k]) continue;
          const e = deg[k] + (adj[k] === m ? 1 : 0);
          if (e <= 1) {
            if (e === 0 || ++ones > 1) return false;
            end = k;
          }
        }
        if ((rules & RULE_PARITY) && end >= 0) {
          const want = (rem & 1) ? (g.color[head] ^ 1) : g.color[head];
          if (g.color[end] !== want) return false;
        }
      }
      if (rules & RULE_CONN) {
        const s = ++this.seenCtr, seen = this.seen, st = this.stack;
        let u0 = -1;
        for (let j = nbS[head]; j < nbS[head + 1]; j++) if (!vis[nb[j]]) { u0 = nb[j]; break; }
        seen[u0] = s; st[0] = u0;
        let sp = 1, cnt = 1;
        while (sp) {
          const u = st[--sp];
          for (let j = nbS[u]; j < nbS[u + 1]; j++) {
            const x = nb[j];
            if (!vis[x] && seen[x] !== s) { seen[x] = s; st[sp++] = x; cnt++; }
          }
        }
        if (cnt !== rem) return false;
      }
      return true;
    }
    // Nøgle for (besøgte felter, hoved). Op til 47 felter passer i ét tal; derover bruges en Map i to niveauer.
    key(head) {
      return ((this.hi >>> 0) * 4294967296 + (this.lo >>> 0)) * 64 + head;
    }
    memoGet(memo, head) {
      if (this.g.n <= 47) return memo.get(this.key(head));
      const m = memo.get(this.lo);
      return m === undefined ? undefined : m.get((this.hi >>> 0) * 64 + head);
    }
    memoSet(memo, head, r) {
      if (this.g.n <= 47) { memo.set(this.key(head), r); return; }
      let m = memo.get(this.lo);
      if (m === undefined) { m = new Map(); memo.set(this.lo, m); }
      m.set((this.hi >>> 0) * 64 + head, r);
    }
  }

  // Antal løsninger fra start (stopper ved cap). Returnerer -1 hvis budgettet sprænges.
  function countSolutions(g, start, cap = 2, budget = 5e6, search) {
    const S = search || new Search(g);
    S.reset();
    S.visit(start);
    if (!S.ok(start, RULES_ALL)) return 0;
    let count = 0, nodes = 0;
    const nbS = g.nbStart, nb = g.nb, vis = S.visited;
    const dfs = (head) => {
      if (S.remaining === 0) { count++; return; }
      if (++nodes > budget) throw new Budget();
      for (let j = nbS[head]; j < nbS[head + 1]; j++) {
        const u = nb[j];
        if (vis[u]) continue;
        S.visit(u);
        if (S.ok(u, RULES_ALL)) dfs(u);
        S.unvisit(u);
        if (count >= cap) return;
      }
    };
    try { dfs(start); } catch (e) { if (e instanceof Budget) return -1; throw e; }
    return count;
  }

  // Fuld analyse af søgetræet som en "fornuftig" spiller ser det.
  //  - Spilleren laver aldrig et træk, der STRAKS efterlader et utilgængeligt felt, to blindgyder eller to øer.
  //  - Med lookahead L kan spilleren desuden se, at et træk er dødt, hvis alle fortsættelser dør inden for L træk.
  //  - P[L] = sandsynligheden for at løse banen i første forsøg, hvis man vælger tilfældigt blandt de træk
  //    der stadig ser mulige ud. bits[L] = -log2(P[L]) = "hvor mange møntkast skal man vinde".
  // Fælde-dybde h(stilling) = hvor mange træk man kan fortsætte før det går op for en at man er død.
  function analyze(g, start, opts = {}) {
    const budget = opts.budget || 2e6;
    const rules = opts.rules || RULES_HUMAN;
    const S = new Search(g);
    S.reset();
    S.visit(start);
    if (!S.ok(start, rules)) return { solutions: 0 };
    const nbS = g.nbStart, nb = g.nb, vis = S.visited;
    const memo = new Map();
    const K = LMAX + 3; // [sol, h, P0..PLMAX]
    const SOLVED = new Float64Array(K);
    SOLVED[0] = 1; SOLVED[1] = INF;
    for (let L = 0; L <= LMAX; L++) SOLVED[2 + L] = 1;
    let nodes = 0;
    const node = (head) => {
      if (S.remaining === 0) return SOLVED;
      let r = S.memoGet(memo, head);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      const kids = [];
      for (let j = nbS[head]; j < nbS[head + 1]; j++) {
        const u = nb[j];
        if (vis[u]) continue;
        S.visit(u);
        if (S.ok(u, rules)) kids.push(node(u));
        S.unvisit(u);
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
      S.memoSet(memo, head, r);
      return r;
    };
    let root;
    try { root = node(start); } catch (e) { if (e instanceof Budget) return { solutions: -1 }; throw e; }
    const P = Array.from(root.subarray(2));
    const bits = P.map(p => (p > 0 ? -Math.log2(p) : Infinity));
    const res = { solutions: root[0], states: nodes, P, bits };
    if (root[0] === 1) Object.assign(res, solutionDetails(g, start, rules, memo, S));
    return res;
  }

  // Gå den (unikke) løsning igennem og beskriv hvert valg: hvilke forkerte træk fandtes og hvor dybe var fælderne.
  function solutionDetails(g, start, rules, memo, S) {
    S.reset();
    S.visit(start);
    const nbS = g.nbStart, nb = g.nb, vis = S.visited;
    const path = [start];
    const steps = [];
    let head = start;
    // Warnsdorff-spiller: blandt træk der ikke er åbenlyst dårlige, vælg feltet med færrest videre udgange
    // ("tag kanterne og hjørnerne først"). Sandsynligheden for at den strategi løser banen:
    let pWarns = 1;
    while (S.remaining > 0) {
      let next = -1;
      const traps = [];
      let minDeg = 99, nMin = 0, nextDeg = -1;
      for (let j = nbS[head]; j < nbS[head + 1]; j++) {
        const u = nb[j];
        if (vis[u]) continue;
        S.visit(u);
        if (S.ok(u, rules)) {
          const d = S.deg[u];
          if (d < minDeg) { minDeg = d; nMin = 1; } else if (d === minDeg) nMin++;
          const r = S.remaining === 0 ? null : S.memoGet(memo, u);
          if (!r || r[0] > 0) { next = u; nextDeg = d; } else traps.push(r[1]);
        } else traps.push(-1); // åbenlyst dårligt træk
        S.unvisit(u);
      }
      pWarns *= nextDeg === minDeg ? 1 / nMin : 0;
      steps.push(traps);
      S.visit(next);
      path.push(next);
      head = next;
    }
    // Største fælde-dybde og summen af fælde-dybder (kun ikke-åbenlyse fælder)
    let maxTrap = 0, trapSum = 0, choices = 0;
    for (const t of steps) {
      let real = false;
      for (const d of t) if (d >= 0) { real = true; trapSum += d + 1; if (d + 1 > maxTrap) maxTrap = d + 1; }
      if (real) choices++;
    }
    return { path, steps, maxTrap, trapSum, choices, pWarns, bitsWarns: pWarns > 0 ? -Math.log2(pWarns) : Infinity };
  }

  // Helt naiv spiller: vælger tilfældigt blandt alle lovlige træk. Tæller også "næsten-løsninger":
  // forskellige måder at sidde fast på, hvor der kun manglede 1-2 felter.
  function analyzeRaw(g, start, opts = {}) {
    const budget = opts.budget || 3e6;
    const S = new Search(g);
    S.reset();
    S.visit(start);
    const nbS = g.nbStart, nb = g.nb, vis = S.visited;
    const memo = new Map();
    let nodes = 0;
    // [P(løs), antal maksimale stier, antal næsten-løsninger (1 felt mangler), (2 felter mangler)]
    const node = (head) => {
      if (S.remaining === 0) return [1, 1, 0, 0];
      let r = S.memoGet(memo, head);
      if (r) return r;
      if (++nodes > budget) throw new Budget();
      let p = 0, paths = 0, near1 = 0, near2 = 0, moves = 0;
      for (let j = nbS[head]; j < nbS[head + 1]; j++) {
        const u = nb[j];
        if (vis[u]) continue;
        moves++;
        S.visit(u);
        const c = node(u);
        S.unvisit(u);
        p += c[0]; paths += c[1]; near1 += c[2]; near2 += c[3];
      }
      if (moves === 0) r = [0, 1, S.remaining === 1 ? 1 : 0, S.remaining === 2 ? 1 : 0];
      else r = [p / moves, paths, near1, near2];
      S.memoSet(memo, head, r);
      return r;
    };
    try {
      const r = node(start);
      return { P: r[0], bits: -Math.log2(r[0]), paths: r[1], near1: r[2], near2: r[3], states: nodes };
    } catch (e) { if (e instanceof Budget) return null; throw e; }
  }

  // ---- Hjælpefunktioner til baner ----
  // Bane som tekst: '#' = felt, '.' = hul, 'S' = start.
  function parseLevel(rows) {
    const h = rows.length, w = rows[0].length;
    const mask = new Uint8Array(w * h);
    let startCell = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch !== '.' && ch !== ' ') mask[y * w + x] = 1;
      if (ch === 'S') startCell = y * w + x;
    }
    return { w, h, mask, startCell };
  }
  function levelToRows(w, h, mask, startCell) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = '';
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        s += i === startCell ? 'S' : mask[i] ? '#' : '.';
      }
      rows.push(s);
    }
    return rows;
  }
  // Kanonisk form under de 8 symmetrier (kun kvadratiske gitre) - til at fjerne dubletter.
  function canonical(w, h, mask, startCell) {
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
        s += i === startCell ? 'S' : mask[i] ? '#' : '.';
      }
      if (best === null || s < best) best = s;
    }
    return best;
  }

  return {
    INF, LMAX, RULES_HUMAN, RULES_ALL, RULE_DEG, RULE_CONN, RULE_PARITY,
    buildGraph, isConnected, parityAllowsStart, Search, countSolutions, analyze, analyzeRaw,
    parseLevel, levelToRows, canonical,
  };
});
