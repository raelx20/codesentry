const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runEslint, checkAvailability: checkEslint } = require('../../src/analyzers/static/eslint');
const { runTypescript, checkAvailability: checkTS, parseTscLine } = require('../../src/analyzers/static/typescript');
const { runRuff, checkAvailability: checkRuff } = require('../../src/analyzers/static/ruff');
const { runBandit, checkAvailability: checkBandit } = require('../../src/analyzers/static/bandit');
const { runSemgrep, checkAvailability: checkSemgrep } = require('../../src/analyzers/static/semgrep');
const { runStaticAnalyzers, ANALYZERS } = require('../../src/analyzers/static/index');

describe('Static Analyzers', () => {
  describe('Tool Availability Detection', () => {
    it('should detect eslint availability without crashing', async () => {
      const available = await checkEslint();
      assert.equal(typeof available, 'boolean');
    });

    it('should detect typescript availability without crashing', async () => {
      const available = await checkTS();
      assert.equal(typeof available, 'boolean');
    });

    it('should detect ruff availability without crashing', async () => {
      const available = await checkRuff();
      assert.equal(typeof available, 'boolean');
    });

    it('should detect bandit availability without crashing', async () => {
      const available = await checkBandit();
      assert.equal(typeof available, 'boolean');
    });

    it('should detect semgrep availability without crashing', async () => {
      const available = await checkSemgrep();
      assert.equal(typeof available, 'boolean');
    });

    it('should cache availability and return identical result on repeated calls without re-executing', async () => {
      const { clearAvailabilityCache, getAvailabilityCache } = require('../../src/analyzers/static/availability');
      clearAvailabilityCache();
      const first = await checkEslint();
      const cache = getAvailabilityCache();
      assert.ok(cache.has('eslint'));
      assert.equal(cache.get('eslint'), first);

      const second = await checkEslint();
      assert.equal(second, first);
    });

    it('should allow clearing the availability cache', async () => {
      const { clearAvailabilityCache, getAvailabilityCache } = require('../../src/analyzers/static/availability');
      await checkRuff();
      assert.ok(getAvailabilityCache().has('ruff'));
      clearAvailabilityCache();
      assert.equal(getAvailabilityCache().has('ruff'), false);
    });
  });

  describe('ESLint Runner', () => {
    it('should return result object with expected structure', async () => {
      const result = await runEslint(['nonexistent.js']);
      assert.ok(result.hasOwnProperty('available'));
      assert.ok(result.hasOwnProperty('results'));
      assert.ok(result.hasOwnProperty('errors'));
      assert.ok(result.hasOwnProperty('warning'));
      assert.ok(Array.isArray(result.results));
    });

    it('should return empty for no files', async () => {
      const result = await runEslint([]);
      assert.equal(result.results.length, 0);
    });
  });

  describe('TypeScript Runner', () => {
    it('should return result object with expected structure', async () => {
      const result = await runTypescript(['nonexistent.ts']);
      assert.ok(result.hasOwnProperty('available'));
      assert.ok(result.hasOwnProperty('results'));
      assert.ok(Array.isArray(result.results));
    });
  });

  describe('Ruff Runner', () => {
    it('should return result object with expected structure', async () => {
      const result = await runRuff(['nonexistent.py']);
      assert.ok(result.hasOwnProperty('available'));
      assert.ok(result.hasOwnProperty('results'));
    });
  });

  describe('Bandit Runner', () => {
    it('should return result object with expected structure', async () => {
      const result = await runBandit(['nonexistent.py']);
      assert.ok(result.hasOwnProperty('available'));
      assert.ok(result.hasOwnProperty('results'));
    });
  });

  describe('Semgrep Runner', () => {
    it('should return result object with expected structure', async () => {
      const result = await runSemgrep(['nonexistent.js']);
      assert.ok(result.hasOwnProperty('available'));
      assert.ok(result.hasOwnProperty('results'));
    });
  });

  describe('TypeScript Line Parser', () => {
    it('should parse valid tsc diagnostic lines', () => {
      const line = 'src/app.ts(10,5): error TS2322: Type \'number\' is not assignable to type \'string\'.';
      const parsed = parseTscLine(line);
      assert.ok(parsed);
      assert.equal(parsed.file, 'src/app.ts');
      assert.equal(parsed.line, 10);
      assert.equal(parsed.column, 5);
      assert.equal(parsed.category, 'error');
      assert.equal(parsed.code, 'TS2322');
      assert.ok(parsed.messageText.includes('Type'));
    });

    it('should return null for non-diagnostic lines', () => {
      assert.equal(parseTscLine(''), null);
      assert.equal(parseTscLine('Found 2 errors.'), null);
      assert.equal(parseTscLine('random text'), null);
    });
  });

  describe('Static Analyzer Orchestrator', () => {
    it('should return array of results', async () => {
      const discovery = {
        files: ['test.js'],
        languages: ['javascript'],
        fileMap: { javascript: ['test.js'] },
      };
      const results = await runStaticAnalyzers(discovery, { enabledAnalyzers: [] });
      assert.ok(Array.isArray(results));
    });

    it('should handle empty discovery', async () => {
      const discovery = { files: [], languages: [], fileMap: {} };
      const results = await runStaticAnalyzers(discovery);
      assert.ok(Array.isArray(results));
    });

    it('all analyzers should be registered', () => {
      assert.ok(ANALYZERS.eslint);
      assert.ok(ANALYZERS.typescript);
      assert.ok(ANALYZERS.ruff);
      assert.ok(ANALYZERS.bandit);
      assert.ok(ANALYZERS.semgrep);
    });
  });
});
