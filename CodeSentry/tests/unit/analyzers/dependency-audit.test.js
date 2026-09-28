const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  runDependencyAudit,
  compareSemver,
  isVersionVulnerable,
  parsePackageJson,
  parseRequirementsTxt,
} = require('../../../src/analyzers/sca/dependency-audit');

test('SCA Dependency Audit Engine', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesentry-sca-test-'));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('compareSemver accurately orders semantic versions', () => {
    assert.strictEqual(compareSemver('1.0.0', '1.0.1'), -1);
    assert.strictEqual(compareSemver('2.0.0', '1.9.9'), 1);
    assert.strictEqual(compareSemver('4.17.21', '4.17.21'), 0);
    assert.strictEqual(compareSemver('^4.17.15', '4.17.21'), -1);
  });

  await t.test('isVersionVulnerable checks range constraints', () => {
    assert.strictEqual(isVersionVulnerable('4.17.15', '<4.17.21'), true);
    assert.strictEqual(isVersionVulnerable('4.17.21', '<4.17.21'), false);
    assert.strictEqual(isVersionVulnerable('4.18.0', '<4.17.21'), false);
    assert.strictEqual(isVersionVulnerable('3.3.6', '3.3.6'), true);
    assert.strictEqual(isVersionVulnerable('1.0.0', '*'), true);
  });

  await t.test('parsePackageJson extracts dependencies and line numbers', () => {
    const pkgContent = `{\n  "name": "sample",\n  "dependencies": {\n    "lodash": "^4.17.15",\n    "express": "^4.18.0"\n  }\n}`;
    const deps = parsePackageJson('package.json', pkgContent);
    assert.strictEqual(deps.length, 2);
    assert.strictEqual(deps[0].name, 'lodash');
    assert.strictEqual(deps[0].version, '4.17.15');
    assert.strictEqual(deps[0].line, 4);
  });

  await t.test('parseRequirementsTxt extracts python dependencies and line numbers', () => {
    const reqContent = `# Core deps\nrequests==2.20.0\nurllib3<1.26.18\nflask\n`;
    const deps = parseRequirementsTxt('requirements.txt', reqContent);
    assert.strictEqual(deps.length, 3);
    assert.strictEqual(deps[0].name, 'requests');
    assert.strictEqual(deps[0].version, '2.20.0');
    assert.strictEqual(deps[0].line, 2);
    assert.strictEqual(deps[1].name, 'urllib3');
    assert.strictEqual(deps[1].version, '1.26.18');
    assert.strictEqual(deps[1].line, 3);
  });

  await t.test('audits package.json and flags known vulnerable dependencies offline', async () => {
    const pkgFile = path.join(tmpDir, 'package.json');
    const pkgContent = JSON.stringify({
      dependencies: {
        'lodash': '4.17.15',
        'event-stream': '3.3.6',
      },
    }, null, 2);
    fs.writeFileSync(pkgFile, pkgContent, 'utf8');

    const result = await runDependencyAudit(
      { files: ['package.json'] },
      { projectPath: tmpDir }
    );

    assert.strictEqual(result.available, true);
    assert.ok(result.rawResults.length >= 2, `Expected at least 2 findings, got ${result.rawResults.length}`);

    const lodashFinding = result.rawResults.find(f => f.message.includes('lodash'));
    assert.ok(lodashFinding);
    assert.strictEqual(lodashFinding.severity, 'HIGH');
    assert.strictEqual(lodashFinding.category, 'security');

    const eventStreamFinding = result.rawResults.find(f => f.message.includes('event-stream'));
    assert.ok(eventStreamFinding);
    assert.strictEqual(eventStreamFinding.severity, 'BLOCKER');
  });

  await t.test('audits requirements.txt and flags vulnerable Python packages', async () => {
    const reqFile = path.join(tmpDir, 'requirements.txt');
    fs.writeFileSync(reqFile, 'pyyaml==5.3\nurllib3==1.25.10\n', 'utf8');

    const result = await runDependencyAudit(
      { files: ['requirements.txt'] },
      { projectPath: tmpDir }
    );

    assert.strictEqual(result.available, true);
    assert.ok(result.rawResults.length >= 2);

    const pyyamlFinding = result.rawResults.find(f => f.message.includes('pyyaml'));
    assert.ok(pyyamlFinding);
    assert.strictEqual(pyyamlFinding.severity, 'BLOCKER');
  });
});
