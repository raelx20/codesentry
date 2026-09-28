/**
 * Cross-platform test runner compatible with Node 18, 20, 22, and 24 on all OSes.
 * Resolves test files dynamically to avoid shell globbing incompatibilities.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findTestFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const target = process.argv[2] || 'all';
let dirs = [];
if (target === 'unit') {
  dirs = ['tests/unit'];
} else if (target === 'analyzers') {
  dirs = ['tests/analyzers'];
} else if (target === 'integration') {
  dirs = ['tests/integration'];
} else {
  dirs = ['tests/unit', 'tests/analyzers', 'tests/integration'];
}

const rootDir = path.resolve(__dirname, '..');
const files = dirs.flatMap(d => findTestFiles(path.resolve(rootDir, d)));

if (files.length === 0) {
  console.log(`No test files found for target: ${target}`);
  process.exit(0);
}

// Pass resolved relative paths to node --test
const relFiles = files.map(f => path.relative(rootDir, f));
const res = spawnSync(process.execPath, ['--test', ...relFiles], {
  cwd: rootDir,
  stdio: 'inherit',
});

process.exit(res.status !== null ? res.status : 1);
