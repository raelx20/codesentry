const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { checkCachedAvailability } = require('./availability');

const execFileAsync = promisify(execFile);

const TOOL_NAME = 'typescript';
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const TIMEOUT_MS = 60000;

async function checkAvailability(projectPath, options = {}) {
  const cwd = projectPath || process.cwd();
  return checkCachedAvailability(TOOL_NAME, async () => {
    try {
      await execFileAsync('npx', ['tsc', '--version'], {
        timeout: 10000,
        cwd,
      });
      return true;
    } catch {
      return false;
    }
  }, { ...options, cacheKey: `${TOOL_NAME}:${cwd}` });
}

async function runTypescript(files, config = {}) {
  const result = { available: false, results: [], errors: [], warning: null };

  const targetFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  if (targetFiles.length === 0) return result;

  const cwd = config.projectPath || process.cwd();
  const available = await checkAvailability(cwd);
  if (!available) {
    result.warning = 'TypeScript compiler not available. Install with: npm install -g typescript';
    return result;
  }
  result.available = true;

  try {
    const args = ['--noEmit', '--pretty', 'false', '--noColor'];

    const tsconfigPath = path.join(cwd, 'tsconfig.json');
    try {
      require('node:fs').accessSync(tsconfigPath);
    } catch {
      args.push('--init');
    }

    const { stdout, stderr } = await execFileAsync('npx', args, {
      timeout: config.timeout || TIMEOUT_MS,
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = (stderr || stdout || '').trim();
    if (!output) return result;

    const lines = output.split('\n');
    for (const line of lines) {
      const parsed = parseTscLine(line);
      if (parsed) {
        result.results.push(parsed);
      }
    }
  } catch (err) {
    const output = (err.stdout || err.stderr || '').trim();
    if (output) {
      const lines = output.split('\n');
      for (const line of lines) {
        const parsed = parseTscLine(line);
        if (parsed) {
          result.results.push(parsed);
        }
      }
    } else {
      result.errors.push(`TypeScript execution error: ${err.message}`);
    }
  }

  return result;
}

function parseTscLine(line) {
  if (!line || line.startsWith('Found')) return null;

  const match = line.match(/^(.+)\((\d+),(\d+)\):\s+(error|warning|message)\s+(TS\d+):\s+(.+)$/);
  if (!match) return null;

  return {
    file: match[1],
    line: parseInt(match[2], 10),
    column: parseInt(match[3], 10),
    category: match[4],
    code: match[5],
    messageText: match[6],
  };
}

module.exports = {
  runTypescript,
  checkAvailability,
  parseTscLine,
  TOOL_NAME,
  SUPPORTED_EXTENSIONS,
};
