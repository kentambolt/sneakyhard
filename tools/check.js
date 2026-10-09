'use strict';
// Viser analyse af de bedste baner i levels_*.json. Brug: node check.js 5 [antal]
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
  console.log(`score=${lv.score.toFixed(1)} n=${g.n} bits0=${a.bits[0].toFixed(1)} bits8=${a.bits[8].toFixed(1)} warnsdorff=${a.bitsWarns === Infinity ? 'FEJLER ALTID' : a.bitsWarns.toFixed(1) + ' bits'} maxTrap=${a.maxTrap}` +
    (raw ? ` | naiv: ${raw.bits.toFixed(1)} bits, ${raw.paths} stier, ${raw.near1} mangler-1, ${raw.near2} mangler-2` : ' | naiv: (for stor)'));
  console.log('   ' + lv.rows.join('\n   '));
}
