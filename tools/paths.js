'use strict';
// Shared paths: candidate levels in data/, the developer version in dev/, the public page in docs/.
const path = require('path');
const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  DEV_PAGE: path.join(ROOT, 'dev', 'index.html'),
  PUBLIC_PAGE: path.join(ROOT, 'docs', 'index.html'),
  data: (file) => path.join(ROOT, 'data', file),
};
