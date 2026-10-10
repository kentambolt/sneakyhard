'use strict';
// Builds the public page docs/index.html from the developer version dev/index.html:
//  - the engine (tools/mix.js) is embedded in both pages, so they work without any other files
//  - PUBLIC = true: "show solution" (key L) is switched off
//  - level data is cut down to id, size and the level itself: no solutions, so they cannot be read from the
//    source either, and no difficulty numbers. "Check route" (key H) works it out in the browser and does not
//    need the solution.
// Usage: node tools/build-public.js
const fs = require('fs');
const path = require('path');
const { DEV_PAGE, PUBLIC_PAGE } = require('./paths');

const SECTIONS = ['VEJ', 'TAKT', 'IS', 'KRYDS', 'MESTER', 'POST'];
// the public page only gets what the game uses: no solutions and no difficulty numbers
const KEEP_FIELDS = ['id', 'w', 'h', 'rows'];
const SOLUTION_FIELDS = ['sol', 'dirs', 'events', 'order', 'moves'];
const SOLVER_BEGIN = '// SOLVER-BEGIN (copied from tools/mix.js by tools/build-public.js)';
const OLD_SOLVER_BEGIN = '// SOLVER-BEGIN (kopieres fra tools/mix.js af tools/build-public.js)';

function replaceBetween(text, begin, end, body) {
  const i0 = text.indexOf(begin), i1 = text.indexOf(end);
  if (i0 < 0 || i1 < 0 || i1 < i0) throw new Error(`markers ${begin} / ${end} not found`);
  return text.slice(0, i0 + begin.length) + body + text.slice(i1);
}

// 1) the engine into the developer version
const solver = fs.readFileSync(path.join(__dirname, 'mix.js'), 'utf8');
if (solver.includes('</script')) throw new Error('mix.js must not contain </script');
let dev = fs.readFileSync(DEV_PAGE, 'utf8').replace(OLD_SOLVER_BEGIN, SOLVER_BEGIN);
dev = replaceBetween(dev, SOLVER_BEGIN, '// SOLVER-END', '\n' + solver + '\n');
fs.writeFileSync(DEV_PAGE, dev);

// 2) the public version
let pub = dev;
if (pub.split('const PUBLIC = false;').length !== 2) throw new Error('the PUBLIC flag was not found exactly once');
pub = pub.replace('const PUBLIC = false;', 'const PUBLIC = true;');

let levels = 0;
for (const name of SECTIONS) {
  const begin = `// LEVELS-${name}-BEGIN`, end = `// LEVELS-${name}-END`;
  const i0 = pub.indexOf(begin), i1 = pub.indexOf(end);
  const body = pub.slice(i0 + begin.length, i1);
  const m = body.match(/const (LEVELS_\w+) = (\[[\s\S]*\]);/);
  if (!m) throw new Error(`level data for ${name} not found`);
  const list = JSON.parse(m[2]).map((lv) => Object.fromEntries(KEEP_FIELDS.map(f => [f, lv[f]])));
  levels += list.length;
  pub = replaceBetween(pub, begin, end, `\nconst ${m[1]} = [\n` + list.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n];\n');
}

// safety check: no solution fields left in the level data
for (const f of SOLUTION_FIELDS) if (pub.includes(`"${f}":`)) throw new Error(`the solution field "${f}" is still in the public page`);

pub = '<!doctype html>\n<html lang="en">\n' + pub;
fs.mkdirSync(path.dirname(PUBLIC_PAGE), { recursive: true });
fs.writeFileSync(PUBLIC_PAGE, pub);
console.log(`docs/index.html written: ${levels} levels, no solutions, ${(pub.length / 1024).toFixed(0)} KB`);
