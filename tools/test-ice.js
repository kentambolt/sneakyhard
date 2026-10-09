'use strict';
// Krydstjek af ice.js mod en uafhængig, naiv implementering (egen glide-logik, ingen beskæring),
// og afspilning af den fundne løsning tryk for tryk.
const I = require('./ice');
let seed = 777;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

// Ét tryk: returnerer { x, y, landed } eller null hvis intet sker
function press(w, h, types, used, x, y, d) {
  const blocked = (cx, cy) => cx < 0 || cy < 0 || cx >= w || cy >= h || types[cy * w + cx] === 0 || (types[cy * w + cx] === 1 && used[cy * w + cx]);
  let cx = x + DX[d], cy = y + DY[d];
  if (blocked(cx, cy)) return null;
  while (types[cy * w + cx] === 2) {
    const nx = cx + DX[d], ny = cy + DY[d];
    if (blocked(nx, ny)) return { x: cx, y: cy, landed: false };
    cx = nx; cy = ny;
  }
  return { x: cx, y: cy, landed: true };
}

function brute(w, h, types, start) {
  const used = new Uint8Array(w * h);
  let total = 0;
  for (const t of types) if (t === 1) total++;
  used[start] = 1;
  let count = 0;
  const rec = (pos, done) => {
    if (done === total) { count++; return; }
    // alle nye felter der kan nås via vandring på is
    const seen = new Set([pos]), q = [pos], targets = new Set();
    while (q.length) {
      const c = q.shift();
      for (let d = 0; d < 4; d++) {
        const r = press(w, h, types, used, c % w, (c / w) | 0, d);
        if (!r) continue;
        const to = r.y * w + r.x;
        if (r.landed) targets.add(to);
        else if (!seen.has(to)) { seen.add(to); q.push(to); }
      }
    }
    for (const t of targets) { used[t] = 1; rec(t, done + 1); used[t] = 0; }
  };
  rec(start, 1);
  return count;
}

function replay(w, h, types, start, dirs, order) {
  const used = new Uint8Array(w * h);
  used[start] = 1;
  let x = start % w, y = (start / w) | 0;
  const seq = [start];
  for (const ch of dirs) {
    const r = press(w, h, types, used, x, y, 'URDL'.indexOf(ch));
    if (!r) return false;
    x = r.x; y = r.y;
    if (r.landed) { used[y * w + x] = 1; seq.push(y * w + x); }
  }
  for (let i = 0; i < w * h; i++) if (types[i] === 1 && !used[i]) return false;
  return seq.join() === order.join();
}

let tested = 0, uniq = 0, fails = 0;
for (let t = 0; t < 2500; t++) {
  const W = 3 + (t % 2);
  const types = new Uint8Array(W * W);
  for (let i = 0; i < W * W; i++) { const r = rand(); types[i] = r < 0.15 ? 0 : r < 0.42 ? 2 : 1; }
  const g = I.buildBoard(W, W, types);
  if (g.n < 2) continue;
  for (const s of g.normals) {
    const want = brute(W, W, types, s);
    const c = I.countSolutions(g, s, 1e9, 1e9).count;
    const an = I.analyze(g, s);
    tested++;
    if (want !== c || (an.solutions || 0) !== want) { fails++; if (fails < 6) console.log('MISMATCH', want, c, an.solutions, I.levelToRows(W, W, types, s)); }
    if (want === 1) {
      uniq++;
      if (!replay(W, W, types, s, an.dirs, an.order)) { fails++; console.log('BAD REPLAY', an.dirs, I.levelToRows(W, W, types, s)); }
    }
  }
}
console.log(`${tested} (bane, start)-par testet, ${uniq} med unik løsning, ${fails} fejl`);
