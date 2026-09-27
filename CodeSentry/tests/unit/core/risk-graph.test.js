const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { SoftwareRiskGraph, buildRiskGraph } = require('../../../src/core/risk-graph');

test('SoftwareRiskGraph & AttackGraph Engine', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesentry-riskgraph-'));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('builds graph and traces attack chain from HTTP route to database sink', () => {
    const serverFile = path.join(tmpDir, 'server.js');
    const code = `
const express = require('express');
const app = express();

app.post('/api/user', (req, res) => {
    const userId = req.body.id;
    db.query("SELECT * FROM users WHERE id = " + userId);
});
`;
    fs.writeFileSync(serverFile, code, 'utf8');

    const findings = [
      {
        id: 'find-sqli-1',
        tool: 'codesentry',
        severity: 'BLOCKER',
        category: 'security',
        ruleId: 'sql-injection',
        file: 'server.js',
        line: 7,
        message: 'SQL Injection via string concatenation',
      },
    ];

    const { summary, terminalOutput, mermaidOutput } = buildRiskGraph(['server.js'], findings, tmpDir);

    assert.ok(summary.nodeCount >= 2, `Expected at least 2 nodes, got ${summary.nodeCount}`);
    assert.strictEqual(summary.hasExploitablePaths, true);
    assert.strictEqual(summary.attackPaths.length, 1);
    assert.strictEqual(summary.attackPaths[0].severity, 'BLOCKER');

    // Terminal output verification
    assert.ok(terminalOutput.includes('ATTACKGRAPH EXPLOITABLE PATHS'));
    assert.ok(terminalOutput.includes('POST /api/user'));

    // Mermaid output verification
    assert.ok(mermaidOutput.includes('```mermaid'));
    assert.ok(mermaidOutput.includes('POST /api/user'));
  });

  await t.test('returns clean graph when no exploitable paths exist', () => {
    const { summary, terminalOutput, mermaidOutput } = buildRiskGraph([], [], tmpDir);
    assert.strictEqual(summary.hasExploitablePaths, false);
    assert.strictEqual(summary.attackPaths.length, 0);
    assert.strictEqual(terminalOutput, null);
    assert.ok(mermaidOutput.includes('Zero Exploitable Attack Paths Detected'));
  });
});
