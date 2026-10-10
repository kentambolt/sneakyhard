'use strict';
// Shows analysis of the best levels in levels_*.json. Usage: node check.js 5 [count]
const P = require('./solver');
const { data } = require('./paths');
const fs = require('fs');
const size = process.argv[2] || '5';
const k = +process.argv[3] || 8;
const levels = JSON.parse(fs.readFileSync(data(`levels_${size}x${size}.json`), 'utf8'));
for (const lv of levels.slice(0, k)) {
  const L = P.parseLevel(lv.rows);
  const g = P.buildGraph(L.w, L.h, L.mask);
  const s = g.id[L.startCell];
  const a = P.analyze(g, s);
  const raw = P.analyzeRaw(g, s, { budget: 5e6 });
  console.log(`score=${lv.score.toFixed(1)} n=${g.n} bits0=${a.bits[0].toFixed(1)} bits8=${a.bits[8].toFixed(1)} warnsdorff=${a.bitsWarns === Infinity ? 'ALWAYS FAILS' : a.bitsWarns.toFixed(1) + ' bits'} maxTrap=${a.maxTrap}` +
    (raw ? ` | naive: ${raw.bits.toFixed(1)} bits, ${raw.paths} paths, ${raw.near1} missing-1, ${raw.near2} missing-2` : ' | naive: (too large)'));
  console.log('   ' + lv.rows.join('\n   '));
}
