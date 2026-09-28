const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { RepoMap, extractComponents } = require('../../../src/core/repo-map');

test('RepoMap Architectural Context & Component Extractor', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesentry-repomap-'));
  const cachePath = path.join(tmpDir, 'repo-map-cache.json');

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('extractComponents detects routes, sinks, and exports in JS', () => {
    const jsCode = `
const express = require('express');
const app = express();
const db = require('./db');

app.get('/api/users', (req, res) => {
  db.query('SELECT * FROM users');
});

module.exports = { app };
`;
    const components = extractComponents('server.js', jsCode);
    const types = components.map(c => c.type);
    assert.ok(types.includes('ENTRYPOINT'));
    assert.ok(types.includes('DATA_SINK'));
    assert.ok(types.includes('EXPORTS'));

    const entry = components.find(c => c.type === 'ENTRYPOINT');
    assert.strictEqual(entry.label, 'GET /api/users');
  });

  await t.test('extractComponents detects AI sinks and python functions', () => {
    const pyCode = `
import openai

def generate_summary(text):
    return openai.chat.completions.create(prompt=text)
`;
    const components = extractComponents('ai.py', pyCode);
    const types = components.map(c => c.type);
    assert.ok(types.includes('AI_SINK'));
    assert.ok(types.includes('EXPORTS'));
  });

  await t.test('builds repo map with mtime caching', () => {
    const file1 = path.join(tmpDir, 'api.js');
    fs.writeFileSync(file1, 'app.post("/login", () => {}); module.exports = { login: true };', 'utf8');

    const repoMap = new RepoMap(cachePath);
    repoMap.build(['api.js'], tmpDir);

    const summary = repoMap.toSummary();
    assert.ok(summary.includes('api.js'));
    assert.ok(summary.includes('ENTRYPOINT: POST /login'));
    assert.ok(summary.includes('exports: login'));

    // Cache file should exist
    assert.ok(fs.existsSync(cachePath));

    // Rebuilding without changes should hit cache
    const repoMap2 = new RepoMap(cachePath);
    repoMap2.build(['api.js'], tmpDir);
    const summary2 = repoMap2.toSummary();
    assert.strictEqual(summary2, summary);
  });
});
