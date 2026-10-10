'use strict';
// Cross-check: the solver's pruned count must give the same number of solutions as naive brute force.
const P = require('./solver');
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

function bruteCount(g, s) {
  const vis = new Uint8Array(g.n);
  let count = 0;
  const path = [];
  const dfs = (u, depth) => {
    if (depth === g.n) { count++; return; }
    for (let j = g.nbStart[u]; j < g.nbStart[u + 1]; j++) {
      const v = g.nb[j];
      if (!vis[v]) { vis[v] = 1; dfs(v, depth + 1); vis[v] = 0; }
    }
  };
  vis[s] = 1;
  dfs(s, 1);
  return count;
}

let tested = 0, uniq = 0, fails = 0;
for (let t = 0; t < 4000; t++) {
  const W = 3 + (t % 3), H = W;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = rand() < 0.8 ? 1 : 0;
  const g = P.buildGraph(W, H, mask);
  if (!P.isConnected(g)) continue;
  for (let s = 0; s < g.n; s++) {
    const b = bruteCount(g, s);
    const c = P.countSolutions(g, s, 1e9, 1e9);
    const a = P.analyze(g, s);
    tested++;
    if (b !== c || a.solutions !== b) { fails++; console.log('MISMATCH', b, c, a.solutions, P.levelToRows(W, H, mask, g.cells[s])); }
    if (b === 1) {
      uniq++;
      // the path must be a valid Hamiltonian path
      const seen = new Set(a.path);
      let okPath = seen.size === g.n && a.path[0] === s;
      for (let i = 1; i < a.path.length; i++) {
        const u = a.path[i - 1], v = a.path[i];
        let adj = false;
        for (let j = g.nbStart[u]; j < g.nbStart[u + 1]; j++) if (g.nb[j] === v) adj = true;
        okPath = okPath && adj;
      }
      if (!okPath) { fails++; console.log('BAD PATH', P.levelToRows(W, H, mask, g.cells[s])); }
    }
  }
}
console.log(`${tested} (level, start) pairs tested, ${uniq} with a unique solution, ${fails} failures`);
