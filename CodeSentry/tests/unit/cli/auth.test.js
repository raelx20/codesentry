const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  getGlobalConfigDir,
  getGlobalConfigPath,
  readGlobalConfig,
  saveGlobalConfig,
  loadGlobalConfig,
  maskApiKey,
  ensureAuth,
} = require('../../../src/cli/auth');

describe('Auth Module & Global Configuration', () => {
  let tempDir;
  let tempConfigPath;
  let origEnvKey;
  let origEnvModel;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesentry-auth-test-'));
    tempConfigPath = path.join(tempDir, 'config.json');
    origEnvKey = process.env.OPENROUTER_API_KEY;
    origEnvModel = process.env.OPENROUTER_MODEL;
  });

  afterEach(() => {
    if (origEnvKey !== undefined) {
      process.env.OPENROUTER_API_KEY = origEnvKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }

    if (origEnvModel !== undefined) {
      process.env.OPENROUTER_MODEL = origEnvModel;
    } else {
      delete process.env.OPENROUTER_MODEL;
    }

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Path Resolution', () => {
    it('should return valid ~/.codesentry paths', () => {
      const dir = getGlobalConfigDir();
      const file = getGlobalConfigPath();
      assert.ok(dir.includes('.codesentry'));
      assert.ok(file.endsWith('config.json'));
      assert.equal(path.dirname(file), dir);
    });
  });

  describe('readGlobalConfig & saveGlobalConfig', () => {
    it('should return empty object for non-existent config file', () => {
      const config = readGlobalConfig(tempConfigPath);
      assert.deepEqual(config, {});
    });

    it('should save config and read it back accurately', () => {
      const saved = saveGlobalConfig({
        openrouter_api_key: 'sk-or-v1-test-key-1234567890',
        openrouter_model: 'poolside/laguna-s-2.1:free',
      }, tempConfigPath);

      assert.ok(saved);
      assert.equal(saved.openrouter_api_key, 'sk-or-v1-test-key-1234567890');
      assert.equal(saved.openrouter_model, 'poolside/laguna-s-2.1:free');
      assert.ok(saved.created_at);
      assert.ok(saved.updated_at);

      const readBack = readGlobalConfig(tempConfigPath);
      assert.equal(readBack.openrouter_api_key, 'sk-or-v1-test-key-1234567890');
      assert.equal(readBack.openrouter_model, 'poolside/laguna-s-2.1:free');
    });

    it('should merge updates without erasing existing fields', () => {
      saveGlobalConfig({
        openrouter_api_key: 'sk-or-v1-initial',
        openrouter_model: 'model-a',
      }, tempConfigPath);

      saveGlobalConfig({
        openrouter_model: 'model-b',
      }, tempConfigPath);

      const finalConfig = readGlobalConfig(tempConfigPath);
      assert.equal(finalConfig.openrouter_api_key, 'sk-or-v1-initial');
      assert.equal(finalConfig.openrouter_model, 'model-b');
    });

    it('should handle corrupted JSON gracefully', () => {
      fs.writeFileSync(tempConfigPath, '{ bad-json-syntax }', 'utf8');
      const config = readGlobalConfig(tempConfigPath);
      assert.deepEqual(config, {});
    });

    it('should enforce 0o600 file permissions on saveGlobalConfig', () => {
      saveGlobalConfig({ openrouter_api_key: 'sk-or-v1-secret' }, tempConfigPath);
      assert.ok(fs.existsSync(tempConfigPath));
      if (process.platform !== 'win32') {
        const stat = fs.statSync(tempConfigPath);
        assert.equal(stat.mode & 0o777, 0o600);
      }
    });
  });

  describe('loadGlobalConfig', () => {
    it('should populate process.env if not already set', () => {
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_MODEL;

      saveGlobalConfig({
        openrouter_api_key: 'sk-or-v1-loaded-key',
        openrouter_model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      }, tempConfigPath);

      const result = loadGlobalConfig(tempConfigPath);
      assert.equal(result.isConfigured, true);
      assert.equal(process.env.OPENROUTER_API_KEY, 'sk-or-v1-loaded-key');
      assert.equal(process.env.OPENROUTER_MODEL, 'nvidia/nemotron-3-ultra-550b-a55b:free');
    });

    it('should NOT overwrite existing process.env values', () => {
      process.env.OPENROUTER_API_KEY = 'env-preexisting-key';
      process.env.OPENROUTER_MODEL = 'env-preexisting-model';

      saveGlobalConfig({
        openrouter_api_key: 'sk-or-v1-file-key',
        openrouter_model: 'file-model',
      }, tempConfigPath);

      loadGlobalConfig(tempConfigPath);
      assert.equal(process.env.OPENROUTER_API_KEY, 'env-preexisting-key');
      assert.equal(process.env.OPENROUTER_MODEL, 'env-preexisting-model');
    });
  });

  describe('maskApiKey', () => {
    it('should mask standard OpenRouter API keys', () => {
      const key = 'sk-or-v1-mock-dummy-testing-api-token-9339';
      const masked = maskApiKey(key);
      assert.ok(masked.startsWith('sk-or-v1'));
      assert.ok(masked.endsWith('9339'));
      assert.ok(masked.includes('••••'));
      assert.ok(!masked.includes('dummy-testing'));
    });

    it('should handle short or missing keys safely', () => {
      assert.equal(maskApiKey(null), '(not configured)');
      assert.equal(maskApiKey(''), '(not configured)');
      assert.equal(maskApiKey('short123'), '••••••••');
    });
  });

  describe('ensureAuth', () => {
    it('should return isConfigured: true if OPENROUTER_API_KEY is already set', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-v1-existing';
      const result = await ensureAuth({ jsonMode: true });
      assert.equal(result.isConfigured, true);
      assert.equal(result.apiKey, 'sk-or-v1-existing');
    });

    it('should skip without error if noAi: true is passed', async () => {
      delete process.env.OPENROUTER_API_KEY;
      const result = await ensureAuth({ noAi: true });
      assert.equal(result.isConfigured, false);
      assert.equal(result.skipped, true);
    });

    it('should skip non-interactively in jsonMode without hanging', async () => {
      delete process.env.OPENROUTER_API_KEY;
      const result = await ensureAuth({ jsonMode: true });
      assert.equal(result.isConfigured, false);
      assert.equal(result.skipped, true);
    });
  });
});
