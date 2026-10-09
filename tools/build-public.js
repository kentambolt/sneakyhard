'use strict';
// Bygger den offentlige side docs/index.html ud fra udviklerversionen dev/index.html:
//  - motoren (tools/mix.js) lægges ind i begge sider, så de virker uden andre filer
//  - PUBLIC = true: "Vis løsning" (tasten L) er slået fra
//  - banedataene skæres ned til id, størrelse og selve banen: ingen løsninger, så de heller ikke kan læses i
//    kilden, og ingen sværhedstal. "Tjek kurs" (tasten H) regner selv i browseren og har ikke brug for løsningen.
// Brug: node tools/build-public.js
const fs = require('fs');
const path = require('path');
const { DEV_PAGE, PUBLIC_PAGE } = require('./paths');

const SECTIONS = ['VEJ', 'TAKT', 'IS', 'KRYDS', 'MESTER', 'POST'];
// Den offentlige side får kun det, spillet bruger: ingen løsninger og ingen sværhedstal
const KEEP_FIELDS = ['id', 'w', 'h', 'rows'];
const SOLUTION_FIELDS = ['sol', 'dirs', 'events', 'order', 'moves'];

function replaceBetween(text, begin, end, body) {
  const i0 = text.indexOf(begin), i1 = text.indexOf(end);
  if (i0 < 0 || i1 < 0 || i1 < i0) throw new Error(`markører ${begin} / ${end} ikke fundet`);
  return text.slice(0, i0 + begin.length) + body + text.slice(i1);
}

// 1) motoren ind i udviklerversionen
const solver = fs.readFileSync(path.join(__dirname, 'mix.js'), 'utf8');
if (solver.includes('</script')) throw new Error('mix.js må ikke indeholde </script');
let dev = fs.readFileSync(DEV_PAGE, 'utf8');
dev = replaceBetween(dev, '// SOLVER-BEGIN (kopieres fra tools/mix.js af tools/build-public.js)', '// SOLVER-END', '\n' + solver + '\n');
fs.writeFileSync(DEV_PAGE, dev);

// 2) offentlig version
let pub = dev;
if (pub.split('const PUBLIC = false;').length !== 2) throw new Error('PUBLIC-flaget ikke fundet præcis én gang');
pub = pub.replace('const PUBLIC = false;', 'const PUBLIC = true;');

let levels = 0;
for (const name of SECTIONS) {
  const begin = `// LEVELS-${name}-BEGIN`, end = `// LEVELS-${name}-END`;
  const i0 = pub.indexOf(begin), i1 = pub.indexOf(end);
  const body = pub.slice(i0 + begin.length, i1);
  const m = body.match(/const (LEVELS_\w+) = (\[[\s\S]*\]);/);
  if (!m) throw new Error(`banedata for ${name} ikke fundet`);
  const list = JSON.parse(m[2]).map((lv) => Object.fromEntries(KEEP_FIELDS.map(f => [f, lv[f]])));
  levels += list.length;
  pub = replaceBetween(pub, begin, end, `\nconst ${m[1]} = [\n` + list.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n');
}

// sikkerhedstjek: ingen løsningsfelter tilbage i banedataene
for (const f of SOLUTION_FIELDS) if (pub.includes(`"${f}":`)) throw new Error(`løsningsfeltet "${f}" findes stadig i den offentlige side`);

pub = '<!doctype html>\n<html lang="da">\n' + pub;
fs.mkdirSync(path.dirname(PUBLIC_PAGE), { recursive: true });
fs.writeFileSync(PUBLIC_PAGE, pub);
console.log(`docs/index.html skrevet: ${levels} baner, ingen løsninger, ${(pub.length / 1024).toFixed(0)} KB`);
