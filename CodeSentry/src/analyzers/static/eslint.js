const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { checkCachedAvailability } = require('./availability');

const execFileAsync = promisify(execFile);

const TOOL_NAME = 'eslint';
const SUPPORTED_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const TIMEOUT_MS = 30000;

async function checkAvailability(options = {}) {
  return checkCachedAvailability(TOOL_NAME, async () => {
    try {
      await execFileAsync('npx', ['eslint', '--version'], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }, options);
}

async function runEslint(files, config = {}) {
  const result = { available: false, results: [], errors: [], warning: null };

  if (!files || files.length === 0) return result;

  const targetFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  if (targetFiles.length === 0) return result;

  const available = await checkAvailability(config);
  if (!available) {
    result.warning = 'ESLint not available. Install with: npm install -g eslint';
    return result;
  }
  result.available = true;

  try {
    const args = [
      '--format', 'json',
      '--no-error-on-unmatched-pattern',
      ...targetFiles,
    ];

    const { stdout } = await execFileAsync('npx', args, {
      timeout: config.timeout || TIMEOUT_MS,
      cwd: config.projectPath || process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const eslintOutput = JSON.parse(stdout);

    for (const fileResult of eslintOutput) {
      if (!fileResult.messages || !Array.isArray(fileResult.messages)) continue;

      for (const msg of fileResult.messages) {
        result.results.push({
          filePath: fileResult.filePath,
          ruleId: msg.ruleId || null,
          severity: msg.severity,
          message: msg.message,
          line: msg.line || null,
          column: msg.column || null,
          fix: msg.fix || null,
        });
      }
    }
  } catch (err) {
    if (err.stdout) {
      try {
        const eslintOutput = JSON.parse(err.stdout);
        for (const fileResult of eslintOutput) {
          if (!fileResult.messages || !Array.isArray(fileResult.messages)) continue;
          for (const msg of fileResult.messages) {
            result.results.push({
              filePath: fileResult.filePath,
              ruleId: msg.ruleId || null,
              severity: msg.severity,
              message: msg.message,
              line: msg.line || null,
              column: msg.column || null,
              fix: msg.fix || null,
            });
          }
        }
      } catch {
        result.errors.push(`ESLint output parse error: ${err.message}`);
      }
    } else {
      result.errors.push(`ESLint execution error: ${err.message}`);
    }
  }

  return result;
}

module.exports = {
  runEslint,
  checkAvailability,
  TOOL_NAME,
  SUPPORTED_EXTENSIONS,
};
