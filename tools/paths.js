'use strict';
// Fælles stier: kandidatbaner i data/, udviklerversionen i dev/, den offentlige side i docs/.
const path = require('path');
const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  DEV_PAGE: path.join(ROOT, 'dev', 'index.html'),
  PUBLIC_PAGE: path.join(ROOT, 'docs', 'index.html'),
  data: (file) => path.join(ROOT, 'data', file),
};
