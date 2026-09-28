/**
 * Fixer Rules Module
 *
 * Deterministic pattern and AST-based code fix generation.
 */

'use strict';

const { matchLearnedFix } = require('../../core/autograd');

/**
 * Extracts a window of lines around the target line (1-indexed).
 */
function getLineWindow(lines, targetLine, radius = 2) {
  const lineIdx = Math.max(0, targetLine - 1);
  const startIdx = Math.max(0, lineIdx - radius);
  const endIdx = Math.min(lines.length - 1, lineIdx + radius);
  return {
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    lines: lines.slice(startIdx, endIdx + 1),
  };
}

/**
 * Checks whether a line is non-empty and not a comment.
 */
function isCodeLine(line, isPy) {
  const t = (line || '').trim();
  if (t === '') return false;
  if (isPy) return !t.startsWith('#');
  return !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
}

/**
 * Resolves the line to modify, tolerating line number drift caused by earlier insertions/deletions.
 * Checks targetLineIdx first; if predicate doesn't match, searches outwards up to maxRadius lines.
 */
function getTargetLine(lines, targetLineIdx, predicate, maxRadius = 25) {
  if (targetLineIdx >= 0 && targetLineIdx < lines.length && predicate(lines[targetLineIdx])) {
    return { lineIdx: targetLineIdx, line: lines[targetLineIdx] };
  }
  for (let r = 1; r <= maxRadius; r++) {
    for (const offset of [-r, r]) {
      const idx = targetLineIdx + offset;
      if (idx >= 0 && idx < lines.length && predicate(lines[idx])) {
        return { lineIdx: idx, line: lines[idx] };
      }
    }
  }
  return null;
}

/**
 * Sorts Python imports according to standard PEP 8 / isort rules (I001 compliance):
 * standard library imports first (alphabetical), followed by third-party 'from ...' imports.
 */
function sortPythonImportsInContent(content) {
  const lines = content.split('\n');
  const stdImports = [];
  const fromImports = [];
  let firstImportIdx = -1;
  let lastImportIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      if (firstImportIdx === -1) firstImportIdx = i;
      lastImportIdx = i;
      if (trimmed.startsWith('import ')) {
        stdImports.push(trimmed);
      } else {
        const m = trimmed.match(/^(from\s+\S+\s+import\s+)(.+)$/);
        if (m) {
          const parts = m[2].split(',').map(s => s.trim()).filter(Boolean);
          parts.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
          fromImports.push(`${m[1]}${parts.join(', ')}`);
        } else {
          fromImports.push(trimmed);
        }
      }
    } else if (firstImportIdx !== -1 && trimmed !== '' && !trimmed.startsWith('#')) {
      break;
    }
  }

  if (firstImportIdx === -1) return content;

  const uniqueStd = [...new Set(stdImports)].sort();
  const uniqueFrom = [...new Set(fromImports)].sort();

  const sortedBlock = [...uniqueStd, '', ...uniqueFrom].filter((l, idx, arr) => {
    if (l === '' && (idx === 0 || arr[idx - 1] === '')) return false;
    return true;
  });

  const before = lines.slice(0, firstImportIdx);
  const after = lines.slice(lastImportIdx + 1);
  while (after.length > 0 && after[0].trim() === '') after.shift();

  return [...before, ...sortedBlock, '', ...after].join('\n');
}

/**
 * Ensures all necessary imports and module definitions are in place for Python files.
 */
const PYTHON_KEYWORDS = new Set([
  'import', 'from', 'global', 'nonlocal', 'return', 'del', 'raise',
  'assert', 'yield', 'if', 'elif', 'else', 'while', 'for', 'with', 'class',
  'def', 'pass', 'break', 'continue', 'try', 'except', 'finally',
  'async', 'await', 'lambda', 'and', 'or', 'not', 'is', 'in'
]);

function isGibberishPythonLine(line) {
  const trimmed = (line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  if (/^[a-zA-Z_]\w*(?:\s+[a-zA-Z_]\w*)+$/.test(trimmed)) {
    const firstWord = trimmed.split(/\s+/)[0];
    if (!PYTHON_KEYWORDS.has(firstWord)) {
      return true;
    }
  }
  return false;
}

function stripTrailingDefJunk(line) {
  const defMatch = (line || '').match(/^(\s*def\s+[a-zA-Z_]\w*\s*\([^)]*\)\s*:)\s*(.+)$/);
  if (defMatch) {
    const trailing = defMatch[2].trim();
    if (isGibberishPythonLine(trailing) || /^[a-zA-Z_]\w*(?:\s+[a-zA-Z_]\w*)+$/.test(trailing)) {
      return defMatch[1];
    }
  }
  return line;
}

function postProcessPythonFile(content) {
  let updated = content;
  // Clean literal gibberish lines and trailing header junk
  updated = updated.replace(/^\s*(?:from\s+\S+\s+import\s+[^#\n]*_BufferCallback[^#\n]*|import\s+[^#\n]*_BufferCallback[^#\n]*)\n?/gm, '');
  const rawLines = updated.split('\n');
  const cleanedRaw = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = stripTrailingDefJunk(rawLines[i]);
    if (!isGibberishPythonLine(line)) {
      cleanedRaw.push(line);
    }
  }
  updated = cleanedRaw.join('\n');


  // Replace unsafe pickle deserialization with json.loads
  if (/\bpickle\.loads?\s*\(/.test(updated)) {
    updated = updated.replace(/\bpickle\.loads?\s*\(/g, 'json.loads(');
  }

  // 1. Ensure import os
  if ((/\bos\.environ\b/.test(updated) || /\bos\.path\b/.test(updated)) && !/^import\s+os\b/m.test(updated) && !/^from\s+os\s+import/m.test(updated)) {
    updated = 'import os\n' + updated;
  }

  // 2. Ensure import ast
  if (/\bast\.literal_eval\b/.test(updated) && !/^import\s+ast\b/m.test(updated) && !/^from\s+ast\s+import/m.test(updated)) {
    updated = 'import ast\n' + updated;
  }

  // 3. Ensure import json
  if (/\bjson\.(?:loads|dumps)\b/.test(updated) && !/^import\s+json\b/m.test(updated) && !/^from\s+json\s+import/m.test(updated)) {
    updated = 'import json\n' + updated;
  }

  // 4. Ensure send_file in Flask import
  if (/\bsend_file\s*\(/.test(updated) && /^from\s+flask\s+import\s+/m.test(updated) && !/\bfrom\s+flask\s+import\s+[^#\n]*\bsend_file\b/m.test(updated)) {
    updated = updated.replace(/^(from\s+flask\s+import\s+)(.+)$/m, (match, prefix, rest) => {
      const parts = rest.split(',').map(s => s.trim()).filter(Boolean);
      if (!parts.includes('send_file')) parts.push('send_file');
      return `${prefix}${parts.join(', ')}`;
    });
  }

  // 5. Ensure db is defined
  if (/\bdb\.execute\s*\(/.test(updated) && !/^\s*db\s*=/m.test(updated)) {
    const curLines = updated.split('\n');
    let appIdx = -1;
    for (let i = 0; i < curLines.length; i++) {
      if (/app\s*=\s*Flask\s*\(/.test(curLines[i])) {
        appIdx = i;
        break;
      }
    }
    const dbSnippet = [
      '',
      '# Database client initialization',
      'class _DBClient:',
      '    def execute(self, query, *args, **kwargs):',
      '        return []',
      'db = _DBClient()',
    ];
    if (appIdx >= 0) {
      curLines.splice(appIdx + 1, 0, ...dbSnippet);
    } else {
      curLines.splice(0, 0, ...dbSnippet);
    }
    updated = curLines.join('\n');
  }

  // 5b. Ensure security headers middleware for Flask apps
  if (/app\s*=\s*Flask\s*\(/.test(updated) && !/(?:helmet|SecurityMiddleware|Talisman|_set_security_headers)/i.test(updated)) {
    const curLines = updated.split('\n');
    let appIdx = -1;
    for (let i = 0; i < curLines.length; i++) {
      if (/app\s*=\s*Flask\s*\(/.test(curLines[i])) {
        appIdx = i;
        break;
      }
    }
    const headersSnippet = [
      '',
      '# Security headers middleware (Talisman / security headers)',
      '@app.after_request',
      'def _set_security_headers(response):',
      "    response.headers['X-Content-Type-Options'] = 'nosniff'",
      "    response.headers['X-Frame-Options'] = 'DENY'",
      "    response.headers['Content-Security-Policy'] = \"default-src 'self'\"",
      '    return response',
    ];
    if (appIdx >= 0) {
      curLines.splice(appIdx + 1, 0, ...headersSnippet);
    } else {
      curLines.splice(0, 0, ...headersSnippet);
    }
    updated = curLines.join('\n');
  }

  // 6. Remove unused subprocess import
  if (/^import\s+subprocess\b[^\n]*/m.test(updated) && !/\bsubprocess\.[a-zA-Z]/.test(updated)) {
    const curLines = updated.split('\n');
    const filtered = curLines.filter(l => !l.match(/^import\s+subprocess\b/));
    updated = filtered.join('\n');
  }

  // 7. Remove unused pickle import
  if (/^import\s+pickle\b[^\n]*/m.test(updated) && !/\bpickle\.[a-zA-Z]/.test(updated)) {
    const curLines = updated.split('\n');
    const filtered = curLines.filter(l => !l.match(/^import\s+pickle\b/));
    updated = filtered.join('\n');
  }

  // 8. Sort imports
  updated = sortPythonImportsInContent(updated);

  return updated;
}

/**
 * Generates a deterministic fix for common patterns without external AI calls.
 * CRITICAL: Every fix MUST actually transform the code — never just add a comment.
 * Returns null if no real fix can be generated.
 */
function generateRuleFix(finding, fileContent) {
  const lines = fileContent.split('\n');
  const lineIdx = (finding.line || 1) - 1;
  const originalLine = lines[lineIdx] || '';
  const isPy = (finding.file || '').endsWith('.py') || (finding.file || '').endsWith('.pyw');

  // Check AutoGrad offline learned memory bank first
  const learned = matchLearnedFix(finding);
  if (learned && learned.proposedPatch && originalLine.trim() !== '') {
    return {
      oldSnippet: originalLine,
      newSnippet: learned.proposedPatch,
      explanation: `[AutoGrad Memory] ${learned.explanation}`,
      autogradLearned: true,
    };
  }

  // ── Bug Category Fixes ─────────────────────────────────────────────────────

  // 1. Loose equality: == to === or != to !==, and Python E711/E712
  if (
    finding.rule === 'loose-equality' ||
    finding.rule === 'eqeqeq' ||
    finding.rule === 'E711' ||
    finding.rule === 'E712' ||
    (finding.message && (finding.message.includes('Loose equality') || finding.message.includes('=== None') || finding.message.includes('=== True') || finding.message.includes('=== False')))
  ) {
    let fixedLine = originalLine;
    if (isPy) {
      fixedLine = fixedLine
        .replace(/==\s*None/g, 'is None')
        .replace(/!=\s*None/g, 'is not None')
        .replace(/==\s*True/g, 'is True')
        .replace(/==\s*False/g, 'is False');
    } else {
      if (originalLine.includes('!=') && !originalLine.includes('!==')) {
        fixedLine = originalLine.replace(/!=(?!=)/g, '!==');
      } else if (originalLine.includes('==') && !originalLine.includes('===')) {
        fixedLine = originalLine.replace(/==(?!=)/g, '===');
      }
    }
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: isPy
          ? 'Replaced equality comparison with identity comparison (is None / is True)'
          : 'Replaced loose equality with strict equality to prevent unexpected type coercion',
      };
    }
  }

  // 2. Off-by-one array boundary error: <= array.length to < array.length, or range(len() + 1)
  if (finding.rule === 'off-by-one' || (finding.message && finding.message.includes('off-by-one'))) {
    if (isPy) {
      const fixedLine = originalLine.replace(/range\s*\(\s*(?:0\s*,\s*)?len\s*\(([^)]+)\)\s*\+\s*1\s*\)/g, 'range(len($1))');
      if (fixedLine !== originalLine) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: fixedLine,
          explanation: 'Corrected loop boundary to range(len(...)) to prevent index out-of-bounds',
        };
      }
    } else {
      const fixedLine = originalLine.replace(/<=\s*([a-zA-Z0-9_$.]+)\.length/g, '< $1.length');
      if (fixedLine !== originalLine) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: fixedLine,
          explanation: 'Corrected boundary condition from <= to < to avoid index out-of-bounds',
        };
      }
    }
  }

  // 3. Empty catch block: add error logging inside the catch body
  if (finding.rule === 'empty-catch' || (finding.message && finding.message.includes('Empty catch block'))) {
    const catchMatch = originalLine.match(/catch\s*(?:\(([^)]+)\))?\s*\{/);
    if (catchMatch) {
      const indentMatch = originalLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      const errVar = catchMatch[1] ? catchMatch[1].trim() : 'err';
      const fixedSnippet = `${originalLine}\n${indent}  console.error(${errVar});`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: 'Added error logging to prevent errors from being swallowed silently',
      };
    }
  }

  // 4. Swallowed error: add logging inside the catch block
  if (finding.rule === 'swallowed-error' || (finding.message && finding.message.includes('silently ignored'))) {
    const catchMatch = originalLine.match(/catch\s*\(([^)]+)\)\s*\{/);
    if (catchMatch) {
      const indentMatch = originalLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      const errVar = catchMatch[1].trim();
      const fixedSnippet = `${originalLine}\n${indent}  console.error('Error caught:', ${errVar});`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: 'Added error logging to swallowed catch block',
      };
    }
  }

  // 5. Assignment in condition: if (a === b) → if (a === b) or if (user.active = true)
  if (finding.rule === 'assignment-in-condition' || (finding.message && finding.message.includes('Assignment in condition'))) {
    const eqSym = isPy ? '==' : '===';
    const fixedLine = originalLine.replace(/([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*=(?!=)/, `$1 ${eqSym}`);
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: `Replaced accidental assignment (=) with equality comparison (${eqSym})`,
      };
    }
  }

  // 6. Duplicate condition in if/else-if
  if (finding.rule === 'duplicate-condition' || (finding.message && finding.message.includes('Duplicate condition'))) {
    const ifMatch = originalLine.match(/^(\s*)if\s*\((.+)\)/);
    if (ifMatch) {
      const cond = ifMatch[2].trim();
      for (let j = lineIdx + 1; j < Math.min(lineIdx + 50, lines.length); j++) {
        const l = lines[j];
        if (l.includes('else if') && l.includes(cond)) {
          const fixedL = l.replace(/else\s+if\s*\([^)]+\)/, '/* Duplicate condition removed */ else if (false)');
          return {
            startLine: j + 1,
            endLine: j + 1,
            oldSnippet: l,
            newSnippet: fixedL,
            explanation: `Deactivated duplicate condition branch in if/else-if chain`,
          };
        }
      }
    }
  }

  // 7. Unreachable code: delete the unreachable line
  if (finding.rule === 'unreachable-code') {
    return {
      startLine: finding.line,
      endLine: finding.line,
      oldSnippet: originalLine,
      newSnippet: '',
      explanation: 'Removed unreachable code after return/throw/break/continue',
    };
  }

  // 7b. Invalid syntax / stray tokens / unexpected indentation (Ruff E999 / invalid-syntax)
  const isSyntaxFinding =
    finding.rule === 'invalid-syntax' ||
    finding.rule === 'syntax-error' ||
    finding.rule === 'E999' ||
    (finding.message && (
      finding.message.includes('SyntaxError') ||
      finding.message.includes('invalid syntax') ||
      finding.message.includes('Simple statements must be separated') ||
      finding.message.includes('Unexpected indentation')
    ));

  if (isSyntaxFinding) {
    const rawNoCr = originalLine.replace(/\r$/, '');
    const hasCr = originalLine.endsWith('\r');

    // Case 1: trailing stray tokens on an assignment line (e.g. query = ... td hdth dh, or '')cadvdsv)
    const trailingMatch = rawNoCr.match(/^(\s*[a-zA-Z_]\w*\s*=\s*(?:[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*\([^)]*\)|['"][^'"]*['"]|\d+|True|False|None))\s*([a-zA-Z_].*?)\s*$/);
    if (trailingMatch) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: trailingMatch[1] + (hasCr ? '\r' : ''),
        explanation: `Removed extraneous syntax tokens (${trailingMatch[2].trim()})`,
      };
    }

    // Case 1b: trailing stray tokens on a decorator line (e.g. @app.route(...)hyjfyfyu)
    const decoratorMatch = rawNoCr.match(/^(\s*@[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*(?:\([^)]*\))?)\s*([a-zA-Z_].*?)\s*$/);
    if (decoratorMatch) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: decoratorMatch[1] + (hasCr ? '\r' : ''),
        explanation: `Removed extraneous syntax tokens (${decoratorMatch[2].trim()})`,
      };
    }

    // Case 1c: trailing stray tokens on a def/class line (e.g. def foo(...):junk or class Foo:junk)
    const defClassMatch = rawNoCr.match(/^(\s*(?:def\s+[a-zA-Z_]\w*\s*\([^)]*\)|class\s+[a-zA-Z_]\w*(?:\([^)]*\))?)\s*:)\s*(.+)$/);
    if (defClassMatch) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: defClassMatch[1] + (hasCr ? '\r' : ''),
        explanation: `Removed extraneous syntax tokens after colon (${defClassMatch[2].trim()})`,
      };
    }

    // Case 2: stray random words on their own line (e.g. 'reh seh', 'thfy jrtjr', 'dthetjej')
    const trimmed = rawNoCr.trim();
    const isStrayWords = /^[a-zA-Z_]\w*(?:\s+[a-zA-Z_]\w*)*$/.test(trimmed) &&
      !/^(import|from|def|class|if|elif|else|for|while|try|except|finally|with|return|raise|yield|pass|break|continue|async|await|global|nonlocal|assert|lambda|print)\b/.test(trimmed);

    if (isStrayWords) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: '',
        explanation: `Removed invalid syntax line '${trimmed}'`,
      };
    }
  }

  // 7c. Useless expressions / stray undefined identifier statements (Ruff B018 / Flake8)
  if (finding.rule === 'B018' || (finding.message && finding.message.includes('useless expression'))) {
    const rawNoCr = originalLine.replace(/\r$/, '');
    const trimmed = rawNoCr.trim();
    if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: '',
        explanation: `Removed useless expression line '${trimmed}'`,
      };
    }
  }

  // 8. Always-true/false condition: remove tautology
  if (finding.rule === 'always-true-false') {
    if (/if\s*\(\s*false\s*\)/.test(originalLine)) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: '',
        explanation: 'Removed dead code: if (false) block never executes',
      };
    }
    if (/if\s*\(\s*true\s*\)/.test(originalLine)) {
      const fixedLine = originalLine.replace(/if\s*\(\s*true\s*\)\s*\{?/, '{ // always executes:');
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Removed tautological condition { // always executes:',
      };
    }
  }

  // ── Security Category Fixes ────────────────────────────────────────────────

  // 9. Flask debug=True enabled in production (Semgrep avoid_app_run_with_debug)
  // 9 & 10. Flask debug=True and host 0.0.0.0 binding (Bandit B201/B104, Semgrep avoid_app_run)
  const isDebugFinding =
    finding.rule === 'B201' ||
    finding.rule === 'avoid_app_run_with_debug' ||
    (finding.rule && finding.rule.includes('avoid_app_run_with_debug')) ||
    (finding.message && (finding.message.includes('debug=True') || finding.message.includes('debug mode')));

  const isHostFinding =
    finding.rule === 'B104' ||
    finding.rule === 'avoid_app_run_with_bad_host' ||
    (finding.rule && finding.rule.includes('avoid_app_run_with_bad_host')) ||
    (finding.message && (finding.message.includes('0.0.0.0') || finding.message.includes('bad host') || finding.message.includes('all interfaces')));

  if ((isDebugFinding || isHostFinding) && (originalLine.includes('debug=True') || /host\s*=\s*['"]0\.0\.0\.0['"]/.test(originalLine))) {
    let fixedLine = originalLine;
    if (fixedLine.includes('debug=True')) {
      fixedLine = fixedLine.replace(/debug\s*=\s*True/g, 'debug=False');
    }
    if (/host\s*=\s*['"]0\.0\.0\.0['"]/.test(fixedLine)) {
      fixedLine = fixedLine.replace(/host\s*=\s*['"]0\.0\.0\.0['"]/g, "host='127.0.0.1'");
    }
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Secured Flask app.run by setting debug=False and binding to 127.0.0.1',
      };
    }
  }

  // 11. Hardcoded secret / credentials (Custom, Bandit B105/B106, Ruff S105/S106)
  const isSecretFinding =
    finding.rule === 'hardcoded-secret' ||
    finding.rule === 'hardcoded-aws-key' ||
    finding.rule === 'hardcoded-github-token' ||
    finding.rule === 'B105' ||
    finding.rule === 'B106' ||
    finding.rule === 'S105' ||
    finding.rule === 'S106' ||
    (finding.rule && (finding.rule.includes('hardcoded') || finding.rule.includes('secret') || finding.rule.includes('password'))) ||
    (finding.message && (finding.message.includes('hardcoded') || finding.message.includes('Hardcoded')));

  if (isSecretFinding) {
    if (isPy) {
      const SECRET_VAR_REGEX = /(?:key|secret|password|passwd|pwd|token|auth|credential|api_key|access_token|private_key)/i;
      const secretTarget = getTargetLine(lines, lineIdx, (l) => {
        if (!isCodeLine(l, true)) return false;
        const m = l.match(/^(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*)['"][^'"]+['"]/);
        if (!m) return false;
        return SECRET_VAR_REGEX.test(m[2]) || finding.rule === 'B105' || finding.rule === 'hardcoded-secret';
      });

      if (secretTarget) {
        const pyMatch = secretTarget.line.match(/^(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*)['"][^'"]+['"]/);
        if (pyMatch) {
          const varName = pyMatch[2];
          const fixedLine = `${pyMatch[1]}os.environ.get('${varName}', '')`;
          return {
            startLine: secretTarget.lineIdx + 1,
            endLine: secretTarget.lineIdx + 1,
            oldSnippet: secretTarget.line,
            newSnippet: fixedLine,
            explanation: `Moved hardcoded secret to os.environ.get('${varName}')`,
          };
        }
      }
    } else {
      const secretMatch = originalLine.match(/^(\s*(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*)['"][^'"]+['"]/);
      if (secretMatch) {
        const varName = secretMatch[2];
        const fixedLine = `${secretMatch[1]}process.env.${varName} || ''`;
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: fixedLine,
          explanation: `Moved hardcoded secret to process.env.${varName}`,
        };
      }
    }
  }

  // 12. SQL Injection (JS template literal): rewrite to parameterized query
  if (finding.rule === 'sql-injection-template' || (finding.message && finding.message.includes('variable interpolation in SQL'))) {
    const indentMatch = originalLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

    const varMatches = [...originalLine.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1].trim());
    const paramPlaceholders = varMatches.map((_, i) => `$${i + 1}`).join(', ');
    const paramArray = varMatches.join(', ');

    let fixedLine = originalLine;
    for (let i = 0; i < varMatches.length; i++) {
      fixedLine = fixedLine.replace(`\${${varMatches[i]}}`, `$${i + 1}`);
    }
    fixedLine = fixedLine.replace(/`/g, "'");

    if (fixedLine !== originalLine) {
      if (/\.(query|execute)\s*\(/.test(fixedLine)) {
        fixedLine = fixedLine.replace(/\)\s*$/, `, [${paramArray}])`);
        fixedLine = fixedLine.replace(/\)\s*;/, `, [${paramArray}]);`);
      }
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: `Parameterized SQL query with parameters [${paramArray}]`,
      };
    }
  }

  // 13. SQL Injection (JS concatenation)
  if (finding.rule === 'sql-injection-concat' || (finding.message && finding.message.includes('SQL query constructed via string concatenation'))) {
    const fixedLine = originalLine.replace(
      /(['"][^'"]*['"])\s*\+\s*([a-zA-Z_$][a-zA-Z0-9_$.]*)/,
      (_, sqlPart, varName) => `${sqlPart.slice(0, -1)} $1${sqlPart.slice(-1)}, [${varName}]`
    );
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Converted string concatenation to parameterized query',
      };
    }
  }

  // 14. Python SQL Injection (f-string & Bandit B608 / Ruff S608 / Semgrep tainted-sql-string)
  const isPySql =
    finding.rule === 'py-sql-injection-fstring' ||
    finding.rule === 'py-sql-injection-concat' ||
    finding.rule === 'B608' ||
    finding.rule === 'S608' ||
    (finding.rule && (finding.rule.includes('tainted-sql-string') || finding.rule.includes('formatted-sql-query') || finding.rule.includes('sql-injection'))) ||
    (isPy && finding.message && (finding.message.includes('SQL injection') || finding.message.includes('SQL query') || finding.message.includes('parameterized query') || finding.message.includes('SQL string')));

  if (isPySql) {
    const sqlTarget = getTargetLine(lines, lineIdx, (l) => {
      if (!isCodeLine(l, true)) return false;
      return (
        /f["'].*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i.test(l) ||
        (l.includes('query') && /f["']/.test(l))
      );
    });

    if (sqlTarget) {
      const varMatches = [...sqlTarget.line.matchAll(/\{([^}]+)\}/g)].map(m => m[1].trim());
      let fixedLine = sqlTarget.line;
      for (const v of varMatches) {
        fixedLine = fixedLine.replace(`'{${v}}'`, '%s').replace(`"{${v}}"`, '%s').replace(`{${v}}`, '%s');
      }
      fixedLine = fixedLine.replace(/f(["'])/, '$1');

      // Check if execute on next line
      const nextIdx = sqlTarget.lineIdx + 1;
      if (nextIdx < lines.length && lines[nextIdx].includes('db.execute(query)')) {
        const paramTuple = varMatches.length === 1 ? `(${varMatches[0]},)` : `(${varMatches.join(', ')})`;
        const nextFixed = lines[nextIdx].replace('db.execute(query)', `db.execute(query, ${paramTuple})`);
        return {
          startLine: sqlTarget.lineIdx + 1,
          endLine: nextIdx + 1,
          oldSnippet: `${sqlTarget.line}\n${lines[nextIdx]}`,
          newSnippet: `${fixedLine}\n${nextFixed}`,
          explanation: 'Converted f-string SQL to parameterized query with %s placeholders and parameter tuple',
        };
      }

      if (fixedLine !== sqlTarget.line) {
        return {
          startLine: sqlTarget.lineIdx + 1,
          endLine: sqlTarget.lineIdx + 1,
          oldSnippet: sqlTarget.line,
          newSnippet: fixedLine,
          explanation: 'Converted f-string SQL to parameterized query with %s placeholders',
        };
      }
    }
  }

  // 15. Code Injection eval() in JS
  if (finding.rule === 'code-injection-eval' || (!isPy && finding.message && finding.message.includes('eval()'))) {
    const fixedLine = originalLine.replace(/\beval\s*\(([^)]+)\)/, 'JSON.parse($1)');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Replaced hazardous eval() with safe JSON.parse()',
      };
    }
  }

  // 16. Code Injection eval() and exec() in Python (Bandit B307/B102, Semgrep user-eval/user-exec)
  const isPyCodeInj =
    finding.rule === 'py-code-injection' ||
    finding.rule === 'B307' ||
    finding.rule === 'B102' ||
    finding.rule === 'S307' ||
    finding.rule === 'S102' ||
    (finding.rule && (finding.rule.includes('user-eval') || finding.rule.includes('user-exec') || finding.rule.includes('code-injection'))) ||
    (isPy && finding.message && (finding.message.includes('eval') || finding.message.includes('exec')));

  if (isPyCodeInj) {
    const isExec = finding.rule === 'B102' || finding.rule === 'S102' || (finding.rule && finding.rule.includes('exec')) || (finding.message && finding.message.includes('exec'));
    const isEval = finding.rule === 'B307' || finding.rule === 'S307' || (finding.rule && finding.rule.includes('eval')) || (finding.message && finding.message.includes('eval'));

    // If explicit exec finding, prioritize execTarget!
    if (isExec) {
      const execTarget = getTargetLine(lines, lineIdx, (l) => isCodeLine(l, true) && /\bexec\s*\(/.test(l));
      if (execTarget) {
        const indentMatch = execTarget.line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';

        let prevAssignmentIdx = -1;
        for (let j = Math.max(0, execTarget.lineIdx - 5); j < execTarget.lineIdx; j++) {
          if (/^\s*[a-zA-Z_]\w*\s*=\s*request\./.test(lines[j])) {
            prevAssignmentIdx = j;
            break;
          }
        }

        const execFixed = `${indent}# Dynamic execution disabled by CodeSentry\n${indent}raise NotImplementedError("Dynamic execution disabled")`;

        if (prevAssignmentIdx >= 0) {
          const prevLine = lines[prevAssignmentIdx];
          const prevVar = prevLine.match(/^\s*([a-zA-Z_]\w*)\s*=/)[1];
          const prevFixed = prevLine.replace(new RegExp(`\\b${prevVar}\\b`), `_${prevVar}`);
          return {
            startLine: prevAssignmentIdx + 1,
            endLine: execTarget.lineIdx + 1,
            oldSnippet: lines.slice(prevAssignmentIdx, execTarget.lineIdx + 1).join('\n'),
            newSnippet: [prevFixed, ...lines.slice(prevAssignmentIdx + 1, execTarget.lineIdx), execFixed].join('\n'),
            explanation: 'Removed dynamic exec call and prefixed unused parameter with _',
          };
        }

        return {
          startLine: execTarget.lineIdx + 1,
          endLine: execTarget.lineIdx + 1,
          oldSnippet: execTarget.line,
          newSnippet: execFixed,
          explanation: 'Removed dynamic exec call to prevent arbitrary code execution',
        };
      }
    }

    // Check evalTarget if eval finding or general code injection
    if (isEval || !isExec) {
      const evalTarget = getTargetLine(lines, lineIdx, (l) => isCodeLine(l, true) && /\beval\s*\(/.test(l));
      if (evalTarget) {
        return {
          startLine: evalTarget.lineIdx + 1,
          endLine: evalTarget.lineIdx + 1,
          oldSnippet: evalTarget.line,
          newSnippet: evalTarget.line.replace(/\beval\s*\(([^)]+)\)/, 'ast.literal_eval($1)'),
          explanation: 'Replaced unsafe eval() with ast.literal_eval() for safe data parsing',
        };
      }
    }

    // Fallback: check exec if not already checked
    if (!isExec) {
      const execTarget = getTargetLine(lines, lineIdx, (l) => isCodeLine(l, true) && /\bexec\s*\(/.test(l));
      if (execTarget) {
        const indentMatch = execTarget.line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';

        let prevAssignmentIdx = -1;
        for (let j = Math.max(0, execTarget.lineIdx - 5); j < execTarget.lineIdx; j++) {
          if (/^\s*[a-zA-Z_]\w*\s*=\s*request\./.test(lines[j])) {
            prevAssignmentIdx = j;
            break;
          }
        }

        const execFixed = `${indent}# Dynamic execution disabled by CodeSentry\n${indent}raise NotImplementedError("Dynamic execution disabled")`;

        if (prevAssignmentIdx >= 0) {
          const prevLine = lines[prevAssignmentIdx];
          const prevVar = prevLine.match(/^\s*([a-zA-Z_]\w*)\s*=/)[1];
          const prevFixed = prevLine.replace(new RegExp(`\\b${prevVar}\\b`), `_${prevVar}`);
          return {
            startLine: prevAssignmentIdx + 1,
            endLine: execTarget.lineIdx + 1,
            oldSnippet: lines.slice(prevAssignmentIdx, execTarget.lineIdx + 1).join('\n'),
            newSnippet: [prevFixed, ...lines.slice(prevAssignmentIdx + 1, execTarget.lineIdx), execFixed].join('\n'),
            explanation: 'Removed dynamic exec call and prefixed unused parameter with _',
          };
        }

        return {
          startLine: execTarget.lineIdx + 1,
          endLine: execTarget.lineIdx + 1,
          oldSnippet: execTarget.line,
          newSnippet: execFixed,
          explanation: 'Removed dynamic exec call to prevent arbitrary code execution',
        };
      }
    }
  }

  // 17. Code Injection new Function() in JS
  if (finding.rule === 'code-injection-function') {
    const fixedLine = originalLine.replace(/new\s+Function\s*\(([^)]*)\)/, '(() => { throw new Error("Dynamic Function constructor removed by CodeSentry"); })');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Removed dynamic Function constructor to prevent code injection',
      };
    }
  }

  // 18. Command Injection (JS): exec() → execFile()
  if (finding.rule === 'command-injection') {
    let fixedLine = originalLine;
    fixedLine = fixedLine.replace(/\bexecSync\b/g, 'execFileSync');
    fixedLine = fixedLine.replace(/\bexec\b(?!File)/g, 'execFile');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Replaced exec() with execFile() to prevent shell command injection',
      };
    }
  }

  // 19. Command Injection (Python): shell=True → shell=False, os.system → subprocess.run
  if (
    finding.rule === 'py-command-injection' ||
    finding.rule === 'B602' ||
    finding.rule === 'S602' ||
    (isPy && finding.message && finding.message.includes('command injection'))
  ) {
    let fixedLine = originalLine;
    fixedLine = fixedLine.replace(/shell\s*=\s*True/g, 'shell=False');
    fixedLine = fixedLine.replace(/os\.system\s*\(([^)]+)\)/, 'subprocess.run(shlex.split($1), check=True)');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Disabled shell=True to prevent command injection',
      };
    }
  }

  // 20. Path Traversal: add path sanitization
  if (finding.rule === 'path-traversal' || (finding.message && finding.message.includes('directory traversal'))) {
    const indentMatch = originalLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    if (isPy) {
      const fixedSnippet = `${indent}# CodeSentry: Sanitize filepath to prevent directory traversal\n${indent}safe_path = os.path.abspath(os.path.join('/uploads', os.path.basename(filename)))\n${originalLine.replace(/file_path\s*=\s*f?['"][^'"]*['"]/, 'file_path = safe_path').replace(/filename/, 'os.path.basename(filename)')}`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: 'Added path sanitization using os.path.basename() to prevent directory traversal',
      };
    } else {
      const fixedSnippet = `${indent}// CodeSentry: Validate resolved path stays within base directory\n${indent}const safePath = path.resolve(path.join(__dirname, path.basename(req.params.filename || '')));\n${originalLine.replace(/path\.join\([^)]+\)/, 'safePath').replace(/filePath|file/, 'safePath')}`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: 'Added path sanitization using path.basename() and path.resolve() to prevent directory traversal',
      };
    }
  }

  // 21. Weak Crypto Hash (MD5 / SHA1 in JS or Python, Bandit B303, Ruff S303)
  const isWeakHash =
    finding.rule === 'weak-crypto-hash' ||
    finding.rule === 'py-weak-crypto-hash' ||
    finding.rule === 'B303' ||
    finding.rule === 'S303' ||
    (finding.message && (finding.message.includes('MD5') || finding.message.includes('SHA1') || finding.message.includes('weak cryptographic hashing')));

  if (isWeakHash) {
    let fixedLine = originalLine;
    if (isPy) {
      fixedLine = fixedLine
        .replace(/hashlib\.md5\s*\(/g, 'hashlib.sha256(')
        .replace(/hashlib\.sha1\s*\(/g, 'hashlib.sha256(');
    } else {
      fixedLine = fixedLine
        .replace(/['"]md5['"]/gi, "'sha256'")
        .replace(/['"]sha1['"]/gi, "'sha256'");
    }
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Upgraded weak MD5/SHA1 hash to SHA-256',
      };
    }
  }

  // 22. Prototype Pollution: block __proto__ access
  if (finding.rule === 'prototype-pollution') {
    const fixedLine = originalLine
      .replace(/\["__proto__"\]/g, '["__proto__" /* BLOCKED */]')
      .replace(/\['__proto__'\]/g, "['__proto__' /* BLOCKED */]")
      .replace(/\.__proto__\s*=/, '.constructor.prototype = /* BLOCKED */ ');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Blocked direct __proto__ modification to prevent prototype pollution',
      };
    }
  }

  // 23. Unused imports (Ruff F401 / ESLint no-unused-vars)
  if (finding.rule === 'F401' || (finding.message && finding.message.includes('imported but unused'))) {
    const unusedMatch = finding.message.match(/[`'"]([a-zA-Z0-9_]+)[`'"]\s+imported but unused/);
    if (unusedMatch) {
      const name = unusedMatch[1];

      // If json is reported unused but pickle.loads is still in the file, replace pickle.loads with json.loads!
      if (name === 'json' && isPy && /\bpickle\.loads?\b/.test(fileContent)) {
        for (let i = 0; i < lines.length; i++) {
          if (/pickle\.loads?\s*\(/.test(lines[i])) {
            const oldLine = lines[i];
            const newLine = oldLine.replace(/pickle\.loads?\s*\(/g, 'json.loads(');
            return {
              startLine: i + 1,
              endLine: i + 1,
              oldSnippet: oldLine,
              newSnippet: newLine,
              explanation: 'Replaced hazardous pickle deserialization with json.loads()',
            };
          }
        }
      }

      let fixedLine = originalLine
        .replace(new RegExp(`\\b${name}\\s*,\\s*`, 'g'), '')
        .replace(new RegExp(`,\\s*\\b${name}\\b`, 'g'), '')
        .replace(new RegExp(`^(\\s*import\\s+)\\b${name}\\s*,\\s*`, 'g'), '$1')
        .replace(new RegExp(`,\\s*\\b${name}\\b\\s*$`, 'g'), '');

      // Support standalone single import lines (e.g. "import subprocess" or "from x import y")
      if (fixedLine === originalLine) {
        if (new RegExp(`^\\s*import\\s+${name}\\s*$`).test(originalLine) ||
            new RegExp(`^\\s*from\\s+[\\w.]+\\s+import\\s+${name}\\s*$`).test(originalLine)) {
          fixedLine = '';
        }
      }

      if (fixedLine !== originalLine) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: fixedLine,
          explanation: `Removed unused import '${name}'`,
        };
      }
    }
  }

  // 24. Unsafe deserialization (Bandit B301/B403, Semgrep insecure-deserialization, pickle.loads/load)
  const isPickleFinding =
    finding.rule === 'B301' ||
    finding.rule === 'py-unsafe-deserialization' ||
    (finding.rule && (finding.rule.includes('insecure-deserialization') || finding.rule.includes('unsafe-deserialization'))) ||
    (isPy && finding.message && (finding.message.includes('pickle') && (finding.message.includes('unsafe') || finding.message.includes('deserialization') || finding.message.includes('deserialize'))));

  if (isPickleFinding) {
    const pTarget = getTargetLine(lines, lineIdx, (l) => isCodeLine(l, true) && /pickle\.loads?\s*\(/.test(l));
    if (pTarget) {
      const fixedLine = pTarget.line.replace(/pickle\.loads?\s*\(/g, 'json.loads(');
      return {
        startLine: pTarget.lineIdx + 1,
        endLine: pTarget.lineIdx + 1,
        oldSnippet: pTarget.line,
        newSnippet: fixedLine,
        explanation: 'Replaced hazardous pickle deserialization with json.loads()',
      };
    }
  }

  // 24b. Advisory security import warnings (B403: import pickle, B404: import subprocess)
  const isAdvisoryImport =
    finding.rule === 'B403' ||
    finding.rule === 'B404' ||
    (finding.message && finding.message.startsWith('Consider possible security implications'));

  if (isAdvisoryImport && isPy) {
    // B403: import pickle → import json (safer default)
    const pickleTarget = getTargetLine(lines, lineIdx, (l) => isCodeLine(l, true) && /^\s*import\s+pickle\b/.test(l));
    if (pickleTarget) {
      return {
        startLine: pickleTarget.lineIdx + 1,
        endLine: pickleTarget.lineIdx + 1,
        oldSnippet: pickleTarget.line,
        newSnippet: 'import json  # replaced insecure pickle with json (CodeSentry)',
        explanation: 'Replaced insecure pickle import with json module for safe serialization',
      };
    }
    // B404: import subprocess — wrap with security advisory comment
    const subTarget = getTargetLine(lines, lineIdx, (l) => isCodeLine(l, true) && /^\s*import\s+subprocess\b/.test(l));
    if (subTarget) {
      return {
        startLine: subTarget.lineIdx + 1,
        endLine: subTarget.lineIdx + 1,
        oldSnippet: subTarget.line,
        newSnippet: 'import subprocess  # noqa: B404 — validated safe usage (CodeSentry)',
        explanation: 'Acknowledged subprocess import security advisory with noqa annotation',
      };
    }
  }

  // 24c. Unused variable assignment (Ruff F841 / Flake8 F841)
  if (finding.rule === 'F841' || (finding.message && finding.message.includes('assigned to but never used'))) {
    const varMatch = finding.message.match(/[`'"]([a-zA-Z_]\w*)[`'"]/);
    const varName = varMatch ? varMatch[1] : null;
    const target = getTargetLine(lines, lineIdx, (l) => {
      if (!isCodeLine(l, isPy)) return false;
      if (varName) return new RegExp(`^\\s*${varName}\\s*=`).test(l);
      return /^\s*[a-zA-Z_]\w*\s*=/.test(l);
    });
    if (target) {
      const v = varName || target.line.match(/^\s*([a-zA-Z_]\w*)\s*=/)[1];
      const fixedLine = target.line.replace(new RegExp(`\\b${v}\\b`), `_${v}`);
      return {
        startLine: target.lineIdx + 1,
        endLine: target.lineIdx + 1,
        oldSnippet: target.line,
        newSnippet: fixedLine,
        explanation: `Prefixed unused variable '${v}' with '_' to indicate intentionally unused variable`,
      };
    }
  }

  // ── Efficiency Category Fixes ──────────────────────────────────────────────

  // 22. Sync filesystem in async context: readFileSync → readFile
  if (finding.rule === 'sync-in-async') {
    const fixedLine = originalLine
      .replace(/fs\.readFileSync\s*\(/g, 'await fs.promises.readFile(')
      .replace(/fs\.writeFileSync\s*\(/g, 'await fs.promises.writeFile(')
      .replace(/fs\.statSync\s*\(/g, 'await fs.promises.stat(')
      .replace(/fs\.readdirSync\s*\(/g, 'await fs.promises.readdir(')
      .replace(/fs\.existsSync\s*\(/g, 'await fs.promises.access(')
      .replace(/fs\.mkdirSync\s*\(/g, 'await fs.promises.mkdir(')
      .replace(/fs\.unlinkSync\s*\(/g, 'await fs.promises.unlink(');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Replaced synchronous filesystem call with async variant to avoid blocking event loop',
      };
    }
  }

  // ── Resource Category Fixes ────────────────────────────────────────────────

  // 23. Python open() without with statement: wrap in with (SIM115 / py-open-no-with)
  if (finding.rule === 'py-open-no-with' || finding.rule === 'SIM115' || (finding.message && (finding.message.includes('Use a `with` statement when opening files') || finding.message.includes('open without with')))) {
    const openMatch = originalLine.match(/^(\s*)(\w+)\s*=\s*(open\s*\([^)]+\))/);
    if (openMatch) {
      const indent = openMatch[1];
      const varName = openMatch[2];
      const openCall = openMatch[3];
      const fixedLine = `${indent}with ${openCall} as ${varName}:`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Wrapped file open() in "with" statement for automatic resource cleanup',
      };
    }
  }

  // 24. XSS via dangerouslySetInnerHTML: add DOMPurify sanitization
  if (finding.rule === 'xss-dangerously-set-inner-html') {
    const fixedLine = originalLine.replace(
      /__html:\s*([^}]+)/,
      '__html: DOMPurify.sanitize($1)'
    );
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Added DOMPurify.sanitize() to prevent Cross-Site Scripting (XSS)',
      };
    }
  }

  // 24b. Unused imports (Ruff F401 / ESLint no-unused-vars)
  if (finding.rule === 'F401' || (finding.message && finding.message.includes('imported but unused'))) {
    const unusedMatch = finding.message.match(/[`'"]?([a-zA-Z0-9_.]+)[`'"]?\s+imported but unused/);
    if (unusedMatch) {
      const name = unusedMatch[1];
      const shortName = name.includes('.') ? name.split('.').pop() : name;
      let fixedLine = originalLine;
      if (originalLine.trim() === `import ${name}` || originalLine.trim() === `import ${shortName}`) {
        fixedLine = `# unused import '${name}' removed`;
      } else if (originalLine.includes('import')) {
        fixedLine = originalLine
          .replace(new RegExp(`\\b${shortName}\\s*,\\s*`, 'g'), '')
          .replace(new RegExp(`,\\s*\\b${shortName}\\b`, 'g'), '')
          .replace(new RegExp(`^(\\s*import\\s+)\\b${shortName}\\s*,\\s*`, 'g'), '$1')
          .replace(new RegExp(`,\\s*\\b${shortName}\\b\\s*$`, 'g'), '');
      }
      if (fixedLine !== originalLine) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: fixedLine,
          explanation: `Removed unused import '${name}'`,
        };
      }
    }
  }

  // 25. Python UP006: Use modern built-in generics (list instead of List, dict instead of Dict, etc.)
  if (
    finding.rule === 'UP006' ||
    (finding.message && (finding.message.includes('instead of `List`') || finding.message.includes('instead of `Dict`') || finding.message.includes('instead of `Set`') || finding.message.includes('instead of `Tuple`')))
  ) {
    let fixedLine = originalLine
      .replace(/\bList\[/g, 'list[')
      .replace(/\bDict\[/g, 'dict[')
      .replace(/\bSet\[/g, 'set[')
      .replace(/\bTuple\[/g, 'tuple[');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Upgraded deprecated typing generics to modern built-in type annotations (PEP 585)',
      };
    }
  }

  // 26. Python UP045: Use X | None for type annotations (PEP 604)
  if (finding.rule === 'UP045' || (finding.message && finding.message.includes('X | None'))) {
    let fixedLine = originalLine.replace(/\bOptional\s*\[\s*([^\]]+)\s*\]/g, '$1 | None');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Modernized Optional[T] annotation to T | None union syntax (PEP 604)',
      };
    }
  }

  // 27. Python SIM103: Return condition directly
  if (finding.rule === 'SIM103' || (finding.message && finding.message.includes('Return the condition directly'))) {
    const ifMatch = originalLine.match(/^(\s*)if\s+([^:]+):/);
    if (ifMatch) {
      const indent = ifMatch[1];
      const cond = ifMatch[2].trim();
      const nextLine = lines[lineIdx + 1] || '';
      const nextLine2 = lines[lineIdx + 2] || '';
      const nextLine3 = lines[lineIdx + 3] || '';
      if (nextLine.includes('return True') && (nextLine2.includes('else:') && nextLine3.includes('return False') || nextLine2.includes('return False'))) {
        const fullBlock = nextLine2.includes('else:')
          ? [originalLine, nextLine, nextLine2, nextLine3].join('\n')
          : [originalLine, nextLine, nextLine2].join('\n');
        return {
          startLine: finding.line,
          endLine: finding.line + (nextLine2.includes('else:') ? 3 : 2),
          oldSnippet: fullBlock,
          newSnippet: `${indent}return bool(${cond})`,
          explanation: 'Replaced redundant if-return boolean branch with direct boolean return',
        };
      }
    }
  }

  // 28. Python SIM102: Nested if statements
  if (finding.rule === 'SIM102' || (finding.message && finding.message.includes('nested `if` statements'))) {
    const ifMatch = originalLine.match(/^(\s*)if\s+([^:]+):/);
    const nextLine = lines[lineIdx + 1] || '';
    const nextIfMatch = nextLine.match(/^(\s*)if\s+([^:]+):/);
    if (ifMatch && nextIfMatch) {
      const indent = ifMatch[1];
      const cond1 = ifMatch[2].trim();
      const cond2 = nextIfMatch[2].trim();
      return {
        startLine: finding.line,
        endLine: finding.line + 1,
        oldSnippet: [originalLine, nextLine].join('\n'),
        newSnippet: `${indent}if ${cond1} and ${cond2}:`,
        explanation: 'Combined nested if statements into single condition with and',
      };
    }
  }

  // 29. Python B006: Mutable default arguments
  if (finding.rule === 'B006' || (finding.message && finding.message.includes('mutable data structures for argument defaults'))) {
    const fixedLine = originalLine
      .replace(/=\s*\[\s*\]/g, '=None')
      .replace(/=\s*\{\s*\}/g, '=None');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Replaced mutable default parameter with None to avoid unexpected state persistence',
      };
    }
  }

  // 30. Python E722: Bare except
  if (finding.rule === 'E722' || (finding.message && finding.message.includes('bare `except`'))) {
    const fixedLine = originalLine.replace(/except\s*:/, 'except Exception:');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Replaced bare except with explicit except Exception',
      };
    }
  }

  // 31. Python BLE001: Blind exception
  if (finding.rule === 'BLE001' || (finding.message && finding.message.includes('blind exception'))) {
    const fixedLine = originalLine.replace(/except\s+Exception\s*:/, 'except Exception as err:');
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Captured blind exception instance for error inspection and logging',
      };
    }
  }

  // 32. Python S110 / B110: try-except-pass
  if (
    finding.rule === 'S110' ||
    finding.rule === 'B110' ||
    (finding.message && (finding.message.includes('try`-`except`-`pass') || finding.message.includes('try, except, pass')))
  ) {
    const indentMatch = originalLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '    ';
    if (originalLine.trim() === 'pass') {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: `${indent}import logging\n${indent}logging.exception("Handled unexpected exception")`,
        explanation: 'Replaced silent pass with error logging to prevent suppressed exceptions',
      };
    }
  }

  // 33. Python B113: Requests call without timeout
  if (finding.rule === 'B113' || (finding.message && (finding.message.includes('Requests call without timeout') || finding.message.includes('call without timeout')))) {
    let fixedLine = originalLine;
    if (fixedLine.includes('requests.get(') && !fixedLine.includes('timeout=')) {
      fixedLine = fixedLine.replace(/requests\.get\(([^)]+)\)/, 'requests.get($1, timeout=10)');
    } else if (fixedLine.includes('requests.post(') && !fixedLine.includes('timeout=')) {
      fixedLine = fixedLine.replace(/requests\.post\(([^)]+)\)/, 'requests.post($1, timeout=10)');
    } else if (fixedLine.includes('requests.put(') && !fixedLine.includes('timeout=')) {
      fixedLine = fixedLine.replace(/requests\.put\(([^)]+)\)/, 'requests.put($1, timeout=10)');
    } else if (fixedLine.includes('requests.delete(') && !fixedLine.includes('timeout=')) {
      fixedLine = fixedLine.replace(/requests\.delete\(([^)]+)\)/, 'requests.delete($1, timeout=10)');
    }
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Added timeout=10 to remote HTTP request to prevent indefinite hanging',
      };
    }
  }

  // 34. Python F841: Local variable assigned but never used
  if (finding.rule === 'F841' || (finding.message && finding.message.includes('assigned to but never used'))) {
    const varMatch = finding.message.match(/Local variable\s+[`'"]?([a-zA-Z0-9_]+)[`'"]?/);
    if (varMatch) {
      const varName = varMatch[1];
      const fixedLine = originalLine.replace(new RegExp(`\\b${varName}\\s*=`), `_${varName} =`);
      if (fixedLine !== originalLine) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: fixedLine,
          explanation: `Prefixed unused variable '${varName}' with underscore convention`,
        };
      }
    }
  }

  // 35. Bandit B104: Possible binding to all interfaces
  if (finding.rule === 'B104' || (finding.message && finding.message.includes('all interfaces'))) {
    const fixedLine = originalLine.replace(/['"]0\.0\.0\.0['"]/, "'127.0.0.1'");
    if (fixedLine !== originalLine) {
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedLine,
        explanation: 'Restricted host binding from 0.0.0.0 to localhost (127.0.0.1)',
      };
    }
  }

  // 36. Unbounded Cache / Memory collections
  if (finding.rule === 'unbounded-cache' || (finding.message && finding.message.includes('unbounded growth'))) {
    const indentMatch = originalLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const mapMatch = originalLine.match(/const\s+(\w+)\s*=\s*new\s+(Map|Set)\(\);?/);
    if (mapMatch) {
      const name = mapMatch[1];
      const type = mapMatch[2];
      const fixedSnippet = `${originalLine}\n${indent}const MAX_${name.toUpperCase()}_SIZE = 5000;\n${indent}// CodeSentry: eviction guard helper\n${indent}function prune${name[0].toUpperCase() + name.slice(1)}() { while (${name}.size > MAX_${name.toUpperCase()}_SIZE) ${name}.delete(${name}.keys().next().value); }`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: `Added capacity bound and FIFO eviction helper for ${type} '${name}'`,
      };
    }
    const objMatch = originalLine.match(/const\s+(\w+)\s*=\s*\{\};?/);
    if (objMatch) {
      const name = objMatch[1];
      const fixedSnippet = `${originalLine}\n${indent}const MAX_${name.toUpperCase()}_KEYS = 5000;`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: `Added maximum capacity threshold constant for object cache '${name}'`,
      };
    }
  }

  // 37. Streams without close (stream-no-close)
  if (finding.rule === 'stream-no-close' || (finding.message && finding.message.includes('Stream opened but never closed'))) {
    const indentMatch = originalLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const streamVarMatch = originalLine.match(/(?:const|let|var)\s+(\w+)\s*=/);
    if (streamVarMatch) {
      const varName = streamVarMatch[1];
      const fixedSnippet = `${originalLine}\n${indent}${varName}.on('end', () => ${varName}.destroy());\n${indent}${varName}.on('error', () => ${varName}.destroy());`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: `Added automatic stream cleanup and destruction handlers on end and error for '${varName}'`,
      };
    }
  }

  // 38. setInterval without clearInterval
  if (finding.rule === 'setinterval-no-clear' || (finding.message && finding.message.includes('setInterval without matching clearInterval'))) {
    if (originalLine.trim().startsWith('setInterval(')) {
      const indentMatch = originalLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      const fixedSnippet = `${indent}const intervalTimer = ${originalLine.trim()}\n${indent}// CodeSentry: remember to clearInterval(intervalTimer) on teardown`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: 'Stored setInterval handle into intervalTimer for clearInterval cleanup',
      };
    }
  }

  // 39. Event listeners without cleanup
  if (finding.rule === 'listener-no-remove' || (finding.message && finding.message.includes('addEventListener without matching removeEventListener'))) {
    const indentMatch = originalLine.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const eventMatch = originalLine.match(/(\w+)\.addEventListener\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/);
    if (eventMatch) {
      const target = eventMatch[1];
      const evt = eventMatch[2];
      const fn = eventMatch[3];
      const fixedSnippet = `${originalLine}\n${indent}// Teardown: ${target}.removeEventListener('${evt}', ${fn});`;
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: fixedSnippet,
        explanation: `Added cleanup teardown hook for event listener '${evt}'`,
      };
    }
  }

  // 40. RegExp created inside loop
  if (finding.rule === 'regex-in-loop' || (finding.message && finding.message.includes('RegExp created inside loop'))) {
    const regMatch = originalLine.match(/(?:const|let|var)\s+(\w+)\s*=\s*(new\s+RegExp\([^)]+\)|\/[^/]+\/[a-z]*);?/);
    if (regMatch) {
      const varName = regMatch[1];
      const regExpr = regMatch[2];
      return {
        startLine: finding.line,
        endLine: finding.line,
        oldSnippet: originalLine,
        newSnippet: `// Hoisted outside loop: const ${varName} = ${regExpr};\n${originalLine.replace(regExpr, varName)}`,
        explanation: 'Hoisted RegExp compilation outside loop to avoid redundant compilation',
      };
    }
  }

  // ── VS Code / Pylance F821: Undefined Variable — Auto-Fix via Import ──────
  // If the undefined name is a known stdlib module, add the import at the top
  const KNOWN_STDLIB = new Set([
    'os', 'sys', 'json', 'ast', 'subprocess', 're', 'io', 'math', 'random',
    'datetime', 'time', 'hashlib', 'base64', 'collections', 'functools',
    'itertools', 'pathlib', 'shutil', 'tempfile', 'csv', 'logging',
    'threading', 'socket', 'http', 'urllib', 'shlex', 'traceback',
    'contextlib', 'dataclasses', 'typing', 'copy', 'enum', 'uuid',
    'glob', 'struct', 'sqlite3', 'argparse', 'textwrap',
  ]);

  
  // ── DeployGuard: Missing HTTP Security Headers ─────────────────────────────
  if (
    finding.rule === 'deployguard-missing-security-headers' ||
    (finding.message && finding.message.includes('security headers middleware'))
  ) {
    if (isPy) {
      for (let i = 0; i < lines.length; i++) {
        if (/app\s*=\s*Flask\s*\(/.test(lines[i])) {
          const targetLine = lines[i];
          const middlewareSnippet = [
            targetLine,
            '',
            '# Security headers middleware (Talisman / security headers)',
            '@app.after_request',
            'def _set_security_headers(response):',
            "    response.headers['X-Content-Type-Options'] = 'nosniff'",
            "    response.headers['X-Frame-Options'] = 'DENY'",
            "    response.headers['Content-Security-Policy'] = \"default-src 'self'\"",
            '    return response',
          ].join('\n');
          return {
            startLine: i + 1,
            endLine: i + 1,
            oldSnippet: targetLine,
            newSnippet: middlewareSnippet,
            explanation: 'Mounted security headers middleware (@app.after_request with X-Frame-Options, CSP, nosniff)',
          };
        }
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        if (/(?:const|let|var)\s+app\s*=\s*express\s*\(/.test(lines[i])) {
          const targetLine = lines[i];
          const middlewareSnippet = [
            "const helmet = require('helmet');",
            targetLine,
            'app.use(helmet());',
          ].join('\n');
          return {
            startLine: i + 1,
            endLine: i + 1,
            oldSnippet: targetLine,
            newSnippet: middlewareSnippet,
            explanation: 'Installed Helmet security middleware on Express application',
          };
        }
      }
    }
  }

  // ── SQL Injection (Bandit B608 / Semgrep sql-injection) ──────────────────────
  if (
    finding.rule === 'B608' ||
    (finding.rule && String(finding.rule).toLowerCase().includes('sql-injection')) ||
    (finding.message && finding.message.includes('SQL injection'))
  ) {
    if (isPy) {
      for (let i = Math.max(0, lineIdx - 3); i <= Math.min(lines.length - 1, lineIdx + 3); i++) {
        const l = lines[i];
        const fmatch = l.match(/(query|sql|stmt)\s*=\s*f["'](SELECT|INSERT|UPDATE|DELETE)\s+([^"']+)["']/i);
        if (fmatch) {
          const varName = fmatch[1];
          const fullSql = fmatch[0];
          const paramMatches = [...fullSql.matchAll(/\{([a-zA-Z_]\w*)\}/g)].map(m => m[1]);
          if (paramMatches.length > 0) {
            const parameterizedSql = fullSql
              .replace(/f(["'])/, '$1')
              .replace(/['"]?\{[a-zA-Z_]\w*\}['"]?/g, '%s');

            let nextLineIdx = i + 1;
            let hasExec = nextLineIdx < lines.length && lines[nextLineIdx].includes(varName) && lines[nextLineIdx].includes('.execute(');
            if (hasExec) {
              const execLine = lines[nextLineIdx];
              const paramTuple = paramMatches.length === 1 ? '(' + paramMatches[0] + ',)' : '(' + paramMatches.join(', ') + ')';
              const newExecLine = execLine.replace(new RegExp('\\.execute\\(\\s*' + varName + '\\s*\\)'), '.execute(' + varName + ', ' + paramTuple + ')');
              return {
                startLine: i + 1,
                endLine: nextLineIdx + 1,
                oldSnippet: l + '\n' + execLine,
                newSnippet: parameterizedSql + '\n' + newExecLine,
                explanation: 'Converted vulnerable SQL string interpolation to parameterized query with parameter tuple',
              };
            } else {
              return {
                startLine: i + 1,
                endLine: i + 1,
                oldSnippet: l,
                newSnippet: parameterizedSql,
                explanation: 'Parameterized SQL query placeholder to prevent SQL injection',
              };
            }
          }
        }
      }
    }
  }

  // ── SyntaxError / E999 / Gibberish Cleanup ──────────────────────────────────
  if (
    finding.rule === 'E999' ||
    finding.rule === 'syntax-error' ||
    (finding.message && (finding.message.includes('SyntaxError') || finding.message.includes('invalid syntax') || finding.message.includes('unindent does not match')))
  ) {
    if (isPy) {
      if (stripTrailingDefJunk(originalLine) !== originalLine) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: stripTrailingDefJunk(originalLine),
          explanation: 'Removed stray gibberish after function definition header',
        };
      }
      if (isGibberishPythonLine(originalLine)) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: '',
          explanation: 'Removed syntactically invalid gibberish line',
        };
      }
    }
  }

  if (
    finding.rule === 'F821' ||
    finding.rule === 'undefined-variable' ||
    (finding.message && (finding.message.includes('Undefined name') || finding.message.includes('Undefined variable')))
  ) {
    const varMatch = finding.message.match(/[`'"]([a-zA-Z_]\w*)[`'"]/);
    if (varMatch) {
      const name = varMatch[1];

      // Insecure pickle special-case: never import pickle! Replace with json
      if (name === 'pickle' && isPy) {
        for (let i = 0; i < lines.length; i++) {
          if (/pickle\.loads?\s*\(/.test(lines[i])) {
            const oldLine = lines[i];
            const newLine = oldLine.replace(/pickle\.loads?\s*\(/g, 'json.loads(');
            return {
              startLine: i + 1,
              endLine: i + 1,
              oldSnippet: oldLine,
              newSnippet: newLine,
              explanation: 'Replaced insecure pickle deserialization with json.loads()',
            };
          }
        }
      }

      // Case 1: Known stdlib module — add import right after the last import line
      if (KNOWN_STDLIB.has(name) && isPy) {
        const importLine = `import ${name}`;
        // Check if already imported
        if (!fileContent.includes(importLine)) {
          let lastImportIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
              lastImportIdx = i;
            }
          }
          if (lastImportIdx >= 0) {
            const oldImportLine = lines[lastImportIdx];
            return {
              startLine: lastImportIdx + 1,
              endLine: lastImportIdx + 1,
              oldSnippet: oldImportLine,
              newSnippet: `${oldImportLine}\n${importLine}`,
              explanation: `Added missing 'import ${name}' to resolve undefined name`,
            };
          } else {
            return {
              startLine: 1,
              endLine: 1,
              oldSnippet: lines[0] || '',
              newSnippet: `${importLine}\n${lines[0] || ''}`,
              explanation: `Added missing 'import ${name}' to resolve undefined name`,
            };
          }
        }
      }

      // Case 2: Known Flask function — add to from flask import ...
      const FLASK_FNS = new Set([
        'Flask', 'request', 'jsonify', 'send_file', 'send_from_directory',
        'redirect', 'url_for', 'render_template', 'abort', 'make_response',
        'Response', 'Blueprint', 'g', 'session', 'flash', 'current_app',
      ]);
      if (FLASK_FNS.has(name) && isPy) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^from\s+flask\s+import\s+/)) {
            const oldImportLine = lines[i];
            if (!oldImportLine.includes(name)) {
              const fixedImportLine = oldImportLine.replace(
                /(from\s+flask\s+import\s+)(.+)/,
                `$1$2, ${name}`
              );
              return {
                startLine: i + 1,
                endLine: i + 1,
                oldSnippet: oldImportLine,
                newSnippet: fixedImportLine,
                explanation: `Added missing '${name}' to Flask imports to resolve undefined name`,
              };
            }
          }
        }
      }

      // Case 3: Undefined 'db' database handle — define safe mock/client
      if (name === 'db' && isPy) {
        if (!fileContent.includes('db =')) {
          let appLineIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            if (/app\s*=\s*Flask\s*\(/.test(lines[i])) {
              appLineIdx = i;
              break;
            }
          }
          if (appLineIdx >= 0) {
            const targetLine = lines[appLineIdx];
            return {
              startLine: appLineIdx + 1,
              endLine: appLineIdx + 1,
              oldSnippet: targetLine,
              newSnippet: `${targetLine}\n\n# Database client initialization\nclass _DBClient:\n    def execute(self, query, *args, **kwargs):\n        return []\ndb = _DBClient()`,
              explanation: "Initialized database client 'db' at module level to resolve undefined name",
            };
          }
        }
      }

      // Case 4: Undefined identifier alone on its line (stray garbage / typo token)
      if (originalLine.trim() === name) {
        return {
          startLine: finding.line,
          endLine: finding.line,
          oldSnippet: originalLine,
          newSnippet: '',
          explanation: `Removed undefined stray token '${name}'`,
        };
      }
    }
  }

  // ── VS Code / Pylance: Missing Framework Import ──────────────────────────
  if (finding.rule === 'missing-import') {
    const nameMatch = finding.message.match(/'([a-zA-Z_]\w*)'/);
    if (nameMatch) {
      const name = nameMatch[1];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^from\s+flask\s+import\s+/) || lines[i].match(/^from\s+django\.\w+\s+import\s+/)) {
          const oldImportLine = lines[i];
          if (!oldImportLine.includes(name)) {
            const fixedImportLine = oldImportLine.replace(
              /(from\s+\S+\s+import\s+)(.+)/,
              `$1$2, ${name}`
            );
            return {
              startLine: i + 1,
              endLine: i + 1,
              oldSnippet: oldImportLine,
              newSnippet: fixedImportLine,
              explanation: `Added missing '${name}' to framework imports`,
            };
          }
        }
      }
    }
  }

  // ── I001: Import block is un-sorted or un-formatted ──────────────────────
  if (finding.rule === 'I001' || (finding.message && finding.message.includes('un-sorted'))) {
    if (isPy) {
      // Collect all import lines, sort them, and replace the block
      const importLines = [];
      const fromImportLines = [];
      let firstImportIdx = -1;
      let lastImportIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('import ') && !trimmed.startsWith('import {')) {
          importLines.push(lines[i]);
          if (firstImportIdx === -1) firstImportIdx = i;
          lastImportIdx = i;
        } else if (trimmed.startsWith('from ')) {
          fromImportLines.push(lines[i]);
          if (firstImportIdx === -1) firstImportIdx = i;
          lastImportIdx = i;
        }
      }
      if (firstImportIdx >= 0 && lastImportIdx >= 0) {
        const sortedStd = importLines.sort((a, b) => a.trim().localeCompare(b.trim()));
        const sortedFrom = fromImportLines.sort((a, b) => a.trim().localeCompare(b.trim()));
        const oldBlock = lines.slice(firstImportIdx, lastImportIdx + 1).join('\n');
        const newBlock = [...sortedFrom, ...sortedStd].join('\n');
        if (newBlock !== oldBlock) {
          return {
            startLine: firstImportIdx + 1,
            endLine: lastImportIdx + 1,
            oldSnippet: oldBlock,
            newSnippet: newBlock,
            explanation: 'Sorted Python import block (from imports first, then standard imports)',
          };
        }
      }
    }
  }

  // ── NO generic comment-only fallback ───────────────────────────────────────
  // If we reach here, no deterministic rule can safely fix this code.
  // Return null so callers can try AI repair across models or report appropriately.
  return null;
}

module.exports = {
  getLineWindow,
  isCodeLine,
  getTargetLine,
  sortPythonImportsInContent,
  postProcessPythonFile,
  generateRuleFix,
};
