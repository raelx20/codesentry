const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { checkCachedAvailability } = require('./availability');

const execFileAsync = promisify(execFile);

const TOOL_NAME = 'semgrep';
const TIMEOUT_MS = 15000;

async function checkAvailability(options = {}) {
  return checkCachedAvailability(TOOL_NAME, async () => {
    try {
      await execFileAsync('semgrep', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }, options);
}

async function runSemgrep(files, config = {}) {
  const result = { available: false, results: [], errors: [], warning: null };

  if (!files || files.length === 0) return result;

  const available = await checkAvailability(config);
  if (!available) {
    result.warning = 'Semgrep not available. Install with: pip install semgrep';
    return result;
  }
  result.available = true;

  try {
    const args = [
      '--json',
      '--quiet',
      '--metrics=off',
      '--disable-version-check',
      '--config', 'auto',
      ...files,
    ];

    const { stdout } = await execFileAsync('semgrep', args, {
      timeout: config.timeout || TIMEOUT_MS,
      cwd: config.projectPath || process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const semgrepOutput = JSON.parse(stdout || '{"results":[]}');
    const results = semgrepOutput.results || [];

    for (const item of results) {
      result.results.push({
        path: item.path || item.file || 'unknown',
        check_id: item.check_id || item.rule || item.id || '',
        severity: item.extra?.severity || item.severity || 'MEDIUM',
        message: item.extra?.message || item.message || '',
        start: item.start || { line: item.line || null, col: item.column || null },
      });
    }
  } catch (err) {
    if (err.stdout) {
      try {
        const semgrepOutput = JSON.parse(err.stdout || '{"results":[]}');
        const results = semgrepOutput.results || [];
        for (const item of results) {
          result.results.push({
            path: item.path || item.file || 'unknown',
            check_id: item.check_id || item.rule || item.id || '',
            severity: item.extra?.severity || item.severity || 'MEDIUM',
            message: item.extra?.message || item.message || '',
            start: item.start || { line: item.line || null, col: item.column || null },
          });
        }
      } catch {
        result.errors.push(`Semgrep output parse error: ${err.message}`);
      }
    } else {
      result.errors.push(`Semgrep execution error: ${err.message}`);
    }
  }

  return result;
}

module.exports = {
  runSemgrep,
  checkAvailability,
  TOOL_NAME,
};
