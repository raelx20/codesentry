const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { checkCachedAvailability } = require('./availability');

const execFileAsync = promisify(execFile);

const TOOL_NAME = 'bandit';
const SUPPORTED_EXTENSIONS = new Set(['.py', '.pyw']);
const TIMEOUT_MS = 30000;

async function checkAvailability(options = {}) {
  return checkCachedAvailability(TOOL_NAME, async () => {
    try {
      await execFileAsync('bandit', ['--version'], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }, options);
}

async function runBandit(files, config = {}) {
  const result = { available: false, results: [], errors: [], warning: null };

  if (!files || files.length === 0) return result;

  const targetFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  if (targetFiles.length === 0) return result;

  const available = await checkAvailability(config);
  if (!available) {
    result.warning = 'Bandit not available. Install with: pip install bandit';
    return result;
  }
  result.available = true;

  try {
    const args = [
      '-f', 'json',
      '-r',
      '--exit-zero',
      ...targetFiles,
    ];

    const { stdout } = await execFileAsync('bandit', args, {
      timeout: config.timeout || TIMEOUT_MS,
      cwd: config.projectPath || process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const banditOutput = JSON.parse(stdout || '{"results":[]}');
    const results = banditOutput.results || [];

    for (const item of results) {
      result.results.push({
        filename: item.filename || item.file || 'unknown',
        test_id: item.test_id || item.testid || '',
        issue_severity: item.issue_severity || 'MEDIUM',
        issue_confidence: item.issue_confidence || 'MEDIUM',
        issue_text: item.issue_text || item.message || '',
        line_number: item.line_number || item.line || null,
      });
    }
  } catch (err) {
    if (err.stdout) {
      try {
        const banditOutput = JSON.parse(err.stdout || '{"results":[]}');
        const results = banditOutput.results || [];
        for (const item of results) {
          result.results.push({
            filename: item.filename || item.file || 'unknown',
            test_id: item.test_id || item.testid || '',
            issue_severity: item.issue_severity || 'MEDIUM',
            issue_confidence: item.issue_confidence || 'MEDIUM',
            issue_text: item.issue_text || item.message || '',
            line_number: item.line_number || item.line || null,
          });
        }
      } catch {
        result.errors.push(`Bandit output parse error: ${err.message}`);
      }
    } else {
      result.errors.push(`Bandit execution error: ${err.message}`);
    }
  }

  return result;
}

module.exports = {
  runBandit,
  checkAvailability,
  TOOL_NAME,
  SUPPORTED_EXTENSIONS,
};
