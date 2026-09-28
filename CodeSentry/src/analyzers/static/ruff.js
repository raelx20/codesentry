const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { checkCachedAvailability } = require('./availability');

const execFileAsync = promisify(execFile);

const TOOL_NAME = 'ruff';
const SUPPORTED_EXTENSIONS = new Set(['.py', '.pyw']);
const TIMEOUT_MS = 30000;

async function checkAvailability(options = {}) {
  return checkCachedAvailability(TOOL_NAME, async () => {
    try {
      await execFileAsync('ruff', ['--version'], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }, options);
}

async function runRuff(files, config = {}) {
  const result = { available: false, results: [], errors: [], warning: null };

  if (!files || files.length === 0) return result;

  const targetFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  if (targetFiles.length === 0) return result;

  const available = await checkAvailability(config);
  if (!available) {
    result.warning = 'Ruff not available. Install with: pip install ruff';
    return result;
  }
  result.available = true;

  try {
    const args = [
      'check',
      '--output-format', 'json',
      '--no-fix',
      ...targetFiles,
    ];

    const { stdout } = await execFileAsync('ruff', args, {
      timeout: config.timeout || TIMEOUT_MS,
      cwd: config.projectPath || process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const ruffOutput = JSON.parse(stdout || '[]');

    for (const item of ruffOutput) {
      result.results.push({
        filename: item.filename || item.file || 'unknown',
        code: item.code || '',
        message: item.message || item.text || '',
        location: item.location || { row: item.line || null, column: item.column || null },
        fix: item.fix || null,
      });
    }
  } catch (err) {
    if (err.stdout) {
      try {
        const ruffOutput = JSON.parse(err.stdout || '[]');
        for (const item of ruffOutput) {
          result.results.push({
            filename: item.filename || item.file || 'unknown',
            code: item.code || '',
            message: item.message || item.text || '',
            location: item.location || { row: item.line || null, column: item.column || null },
            fix: item.fix || null,
          });
        }
      } catch {
        result.errors.push(`Ruff output parse error: ${err.message}`);
      }
    } else {
      result.errors.push(`Ruff execution error: ${err.message}`);
    }
  }

  return result;
}

module.exports = {
  runRuff,
  checkAvailability,
  TOOL_NAME,
  SUPPORTED_EXTENSIONS,
};
