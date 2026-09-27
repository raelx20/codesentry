const test = require('node:test');
const assert = require('node:assert');
const { AutoGradEngine, calculateAutoGrad, matchLearnedFix, learnFromFix } = require('../../../src/core/autograd');

test('AutoGrad Engine - Risk Assessment & Grading', async (t) => {
  const engine = new AutoGradEngine();

  await t.test('evaluates clean codebase as A+ grade', () => {
    const result = engine.evaluate([], { projectPath: 'clean-proj-test' });
    assert.strictEqual(result.grade, 'A+');
    assert.strictEqual(result.score, 100);
    assert.strictEqual(result.offlineResolvableCount, 0);
  });

  await t.test('calculates appropriate penalty for Blockers and High severities', () => {
    const findings = [
      { ruleId: 'sql-injection', severity: 'BLOCKER', category: 'security' },
      { ruleId: 'command-injection', severity: 'HIGH', category: 'security' },
      { ruleId: 'unused-var', severity: 'LOW', category: 'bugs' },
    ];
    const result = engine.evaluate(findings, { projectPath: 'vulnerable-proj-test' });
    assert.ok(result.score < 70, `Expected score < 70, got ${result.score}`);
    assert.ok(['C', 'D', 'F'].includes(result.grade));
  });

  await t.test('calculates historical trend between consecutive evaluations', () => {
    const proj = 'trend-test-' + Date.now();
    const first = engine.evaluate([{ severity: 'BLOCKER' }], { projectPath: proj });
    const second = engine.evaluate([], { projectPath: proj });

    assert.strictEqual(second.trend.direction, 'improved');
    assert.ok(second.trend.delta > 0);
    assert.ok(second.trend.symbol.includes('▲'));
  });

  await t.test('matches seed learned patterns for offline self-solving', () => {
    const finding = {
      ruleId: 'loose-equality',
      category: 'bugs',
      snippet: 'if (x == y) {',
    };
    const match = engine.matchLearnedFix(finding);
    assert.ok(match !== null, 'Expected match for loose-equality pattern');
    assert.strictEqual(match.patternId, 'loose-equality');
    assert.strictEqual(match.proposedPatch, 'if (x === y) {');
  });

  await t.test('dynamically learns new patterns from verified fixes', () => {
    const customFinding = {
      ruleId: 'custom-unclosed-stream',
      category: 'resources',
    };
    const orig = 'const stream = fs.createReadStream(path);';
    const fixed = 'const stream = fs.createReadStream(path); stream.on("close", () => {});';

    const learned = engine.learnFromFix(customFinding, orig, fixed);
    assert.strictEqual(learned, true);

    const match = engine.matchLearnedFix({
      ruleId: 'custom-unclosed-stream',
      category: 'resources',
      snippet: 'const stream = fs.createReadStream(path);',
    });
    assert.ok(match !== null, 'Expected dynamically learned pattern to be matched');
  });
});
