'use strict';
// Krydstjek af twins.js: beskåret optælling og analyse skal give samme antal løsninger som naiv brute-force,
// og den unikke løsning skal kunne afspilles fra start til alle felter er betrådt.
const T = require('./twins');
let seed = 4242;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

function brute(g, a0, b0) {
  const vis = new Uint8Array(g.n);
  vis[a0] = vis[b0] = 1;
  let rem = g.n - 2, count = 0;
  const dfs = (a, b) => {
    if (rem === 0) { count++; return; }
    for (let d = 0; d < 4; d++) {
      const ta = g.nb[a * 4 + d], tb = g.nb[b * 4 + d];
      const ma = ta >= 0 && !vis[ta], mb = tb >= 0 && !vis[tb];
      if (!ma && !mb) continue;
      if (ma) { vis[ta] = 1; rem--; }
      if (mb) { vis[tb] = 1; rem--; }
      dfs(ma ? ta : a, mb ? tb : b);
      if (ma) { vis[ta] = 0; rem++; }
      if (mb) { vis[tb] = 0; rem++; }
    }
  };
  dfs(a0, b0);
  return count;
}

function replay(g, a, b, moves) {
  const vis = new Uint8Array(g.n);
  vis[a] = vis[b] = 1;
  let rem = g.n - 2;
  for (const ch of moves) {
    const d = T.DIRS.indexOf(ch);
    const ta = g.nb[a * 4 + d], tb = g.nb[b * 4 + d];
    const ma = ta >= 0 && !vis[ta], mb = tb >= 0 && !vis[tb];
    if (!ma && !mb) return false;
    if (ma) { vis[ta] = 1; rem--; a = ta; }
    if (mb) { vis[tb] = 1; rem--; b = tb; }
  }
  return rem === 0;
}

let tested = 0, uniq = 0, fails = 0;
for (let t = 0; t < 1500; t++) {
  const W = 3 + (t % 2);
  const mask = new Uint8Array(W * W);
  for (let i = 0; i < W * W; i++) mask[i] = rand() < 0.8 ? 1 : 0;
  const g = T.buildBoard(W, W, mask);
  if (g.n < 3 || T.components(g) > 2) continue;
  for (let a = 0; a < g.n; a++) for (let b = a + 1; b < g.n; b++) {
    const want = brute(g, a, b);
    const c = T.countSolutions(g, a, b, 1e9, 1e9).count;
    const an = T.analyze(g, a, b);
    tested++;
    if (want !== c || (an.solutions || 0) !== want) { fails++; if (fails < 5) console.log('MISMATCH', want, c, an.solutions, T.levelToRows(W, W, mask, g.cells[a], g.cells[b])); }
    if (want === 1) {
      uniq++;
      if (!replay(g, a, b, an.moves)) { fails++; console.log('BAD REPLAY', an.moves); }
    }
  }
}
console.log(`${tested} (bane, startpar) testet, ${uniq} med unik løsning, ${fails} fejl`);
