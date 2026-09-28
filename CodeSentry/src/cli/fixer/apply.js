/**
 * Fixer Apply Module
 *
 * Handles snippet replacements, in-memory updates, syntax validation,
 * and safe file writing with AutoSandbox isolation and backup protection.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { executeWithAutoSandbox } = require('../../core/sandbox');
const { learnFromFix } = require('../../core/autograd');

/**
 * Validates syntax of file content before applying fixes.
 * Supports JavaScript (via Node vm) and Python (via python -c "import ast; ...").
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {{ valid: boolean, error?: string, line?: number }}
 */
function validateSyntax(filePath, content) {
  if (!content || typeof content !== 'string') return { valid: true };
  const ext = path.extname(filePath).toLowerCase();

  // JavaScript / CommonJS / ES module validation
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    try {
      new vm.Script(content, { filename: filePath });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: `JavaScript SyntaxError: ${err.message}` };
    }
  }

  // Python validation using python -c "import sys, ast; ast.parse(...)"
  if (ext === '.py' || ext === '.pyw') {
    try {
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      const res = spawnSync(pyCmd, ['-c', 'import sys, ast; ast.parse(sys.stdin.read())'], {
        input: content,
        timeout: 2000,
        encoding: 'utf8',
        windowsHide: true,
      });

      if (res.status === 0) {
        return { valid: true };
      }

      if (res.stderr && res.stderr.includes('SyntaxError')) {
        const matches = [...res.stderr.matchAll(/(?:File\s+["'][^"']+["'],\s+)?line\s+(\d+)/gi)];
        const errLine = matches.length > 0 ? parseInt(matches[matches.length - 1][1], 10) : null;
        const errorLine = res.stderr.trim().split('\n').filter(l => l.includes('SyntaxError')).pop() || res.stderr.trim();
        return { valid: false, error: `Python SyntaxError: ${errorLine}`, line: errLine };
      }
    } catch {
      // If python is not in PATH, do not block disk write
      return { valid: true };
    }
  }

  return { valid: true };
}

/**
 * Applies a code snippet replacement to file content string in-memory.
 * Matches by exact substring, whitespace-tolerant substring, or target line offset.
 * Returns the modified content string, or null if the snippet could not be matched.
 */
function applySnippetToContent(content, oldSnippet, newSnippet, targetLine = 1) {
  if (!oldSnippet || typeof oldSnippet !== 'string' || typeof newSnippet !== 'string') return null;

  // Strategy 1: Exact substring match
  if (content.includes(oldSnippet)) {
    return content.replace(oldSnippet, newSnippet);
  }

  // Strategy 2: Whitespace-normalized match (handles \r\n vs \n, trailing spaces)
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  const normalizedOld = oldSnippet.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');

  if (normalizedContent.includes(normalizedOld)) {
    const lines = content.split('\n');
    const oldLines = oldSnippet.split('\n');
    const targetLineIdx = Math.max(0, (targetLine || 1) - 1);

    for (let searchRadius = 0; searchRadius <= 5; searchRadius++) {
      for (const offset of [0, -searchRadius, searchRadius]) {
        const startIdx = targetLineIdx + offset;
        if (startIdx < 0 || startIdx >= lines.length) continue;

        const candidateSlice = lines.slice(startIdx, startIdx + oldLines.length)
          .join('\n').replace(/\r/g, '').replace(/[ \t]+$/gm, '');
        const normTarget = normalizedOld.replace(/\r/g, '');

        if (candidateSlice === normTarget) {
          const newLines = newSnippet.split('\n');
          lines.splice(startIdx, oldLines.length, ...newLines);
          return lines.join('\n');
        }
      }
    }
  }

  // Strategy 3: Line-based replacement near targetLine
  const lines = content.split('\n');
  const lineIdx = Math.max(0, (targetLine || 1) - 1);
  if (lineIdx >= 0 && lineIdx < lines.length) {
    const currentLine = lines[lineIdx];
    const normalizedCurrent = currentLine.replace(/\r/g, '').trim();
    const normalizedOld = oldSnippet.replace(/\r/g, '').trim();

    if (normalizedCurrent === normalizedOld || currentLine.includes(oldSnippet.trim())) {
      const newLines = newSnippet.split('\n');
      lines.splice(lineIdx, 1, ...newLines);
      return lines.join('\n');
    }
  }

  // Strategy 4: Fallback search anywhere for trimmed single-line snippet
  const trimmedOld = oldSnippet.trim();
  if (trimmedOld.length > 3) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(trimmedOld)) {
        lines[i] = lines[i].replace(trimmedOld, newSnippet.trim());
        return lines.join('\n');
      }
    }
  }

  return null;
}

/**
 * Applies a fix to a file on disk with AutoSandbox safety protection.
 */
function applyFixToFile(projectPath, finding, fix) {
  const fullPath = path.isAbsolute(finding.file) ? finding.file : path.resolve(projectPath, finding.file);

  try {
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${finding.file}` };
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const updated = applySnippetToContent(content, fix.oldSnippet, fix.newSnippet, finding.line);
    if (updated !== null && updated !== content) {
      const sandboxResult = executeWithAutoSandbox({
        projectPath,
        filePath: fullPath,
        originalContent: content,
        proposedContent: updated,
        findings: [finding],
        oldSnippet: fix.oldSnippet,
        newSnippet: fix.newSnippet,
        applyFn: () => {
          fs.writeFileSync(fullPath, updated, 'utf8');
        },
      });

      if (!sandboxResult.success) {
        return {
          success: false,
          sandboxed: sandboxResult.sandboxed,
          error: sandboxResult.error,
        };
      }

      try {
        learnFromFix(finding, fix.oldSnippet, fix.newSnippet);
      } catch {
        // Non-fatal
      }
      return {
        success: true,
        file: finding.file,
        line: finding.line,
        sandboxed: sandboxResult.sandboxed,
      };
    }

    return { success: false, error: 'Could not locate target code in file (content may have changed)' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  validateSyntax,
  applySnippetToContent,
  applyFixToFile,
};
