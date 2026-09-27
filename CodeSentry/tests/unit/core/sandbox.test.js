const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isCriticalChange,
  executeWithAutoSandbox,
  verifyInSandbox,
} = require('../../../src/core/sandbox');

test('AutoSandbox - Critical Change Isolation & Safety Guard', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesentry-sandbox-test-'));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('detects critical severity and security category findings', () => {
    assert.strictEqual(
      isCriticalChange({
        findings: [{ severity: 'BLOCKER', category: 'bugs' }],
      }),
      true
    );

    assert.strictEqual(
      isCriticalChange({
        findings: [{ severity: 'MEDIUM', category: 'security' }],
      }),
      true
    );

    assert.strictEqual(
      isCriticalChange({
        file: 'Dockerfile',
        findings: [{ severity: 'LOW', category: 'bugs' }],
      }),
      true
    );

    assert.strictEqual(
      isCriticalChange({
        findings: [{ severity: 'LOW', category: 'bugs' }],
        newSnippet: 'const x = 1;',
      }),
      false
    );
  });

  await t.test('detects dangerous runtime primitives as critical', () => {
    assert.strictEqual(
      isCriticalChange({
        findings: [{ severity: 'LOW', category: 'bugs' }],
        newSnippet: 'return eval(userInput);',
      }),
      true
    );

    assert.strictEqual(
      isCriticalChange({
        findings: [{ severity: 'LOW', category: 'bugs' }],
        newSnippet: 'const cp = child_process.exec(cmd);',
      }),
      true
    );
  });

  await t.test('safely executes critical changes through sandbox with backup', () => {
    const testFile = path.join(tmpDir, 'secure_app.js');
    const originalCode = 'const secret = "hardcoded_token";\n';
    const safePatchedCode = 'const secret = process.env.API_TOKEN || "";\n';

    fs.writeFileSync(testFile, originalCode, 'utf8');

    let applied = false;
    const result = executeWithAutoSandbox({
      projectPath: tmpDir,
      filePath: testFile,
      originalContent: originalCode,
      proposedContent: safePatchedCode,
      findings: [{ ruleId: 'hardcoded-secret', severity: 'BLOCKER', category: 'security' }],
      applyFn: () => {
        fs.writeFileSync(testFile, safePatchedCode, 'utf8');
        applied = true;
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sandboxed, true);
    assert.strictEqual(result.critical, true);
    assert.strictEqual(applied, true);
    assert.ok(result.backupFilePath);
    assert.ok(fs.existsSync(result.backupFilePath));
  });

  await t.test('intercepts and blocks broken critical changes in sandbox without touching disk', () => {
    const testFile = path.join(tmpDir, 'broken_patch.js');
    const originalCode = 'function calculateTotal(x, y) {\n  return x + y;\n}\n';
    const brokenPatchedCode = 'function calculateTotal(x, y) {\n  return x + ((\n'; // Syntax error!

    fs.writeFileSync(testFile, originalCode, 'utf8');

    let applied = false;
    const result = executeWithAutoSandbox({
      projectPath: tmpDir,
      filePath: testFile,
      originalContent: originalCode,
      proposedContent: brokenPatchedCode,
      findings: [{ ruleId: 'sql-injection', severity: 'BLOCKER', category: 'security' }],
      applyFn: () => {
        fs.writeFileSync(testFile, brokenPatchedCode, 'utf8');
        applied = true;
      },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.sandboxed, true);
    assert.strictEqual(applied, false, 'applyFn should NOT have been called!');
    assert.ok(result.error.includes('AutoSandbox Guard blocked unsafe modification'));

    // Original file must remain 100% untouched
    const currentOnDisk = fs.readFileSync(testFile, 'utf8');
    assert.strictEqual(currentOnDisk, originalCode);
  });
});
