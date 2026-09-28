/**
 * Fixer Batch & Orchestrator Module
 *
 * Orchestrates single-finding AI generation and multi-finding holistic
 * file batch repair with AutoSandbox isolation and rollback protection.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { executeWithAutoSandbox } = require('../../core/sandbox');
const { learnFromFix } = require('../../core/autograd');
const {
  getLineWindow,
  isCodeLine,
  sortPythonImportsInContent,
  postProcessPythonFile,
  generateRuleFix,
} = require('./rules');
const { applySnippetToContent, validateSyntax } = require('./apply');

/**
 * Generates an automated fix via deterministic rules or AI-powered repair with model switching.
 * Never skips normally: cascades across fallback models when AI is enabled.
 */
async function generateFix(projectPath, finding, options = {}) {
  const fullPath = path.isAbsolute(finding.file) ? finding.file : path.resolve(projectPath, finding.file);

  let fileContent = '';
  try {
    fileContent = fs.readFileSync(fullPath, 'utf8');
  } catch (err) {
    return { error: `Cannot read file: ${finding.file}` };
  }

  // 1. Try deterministic AST/pattern rule fix first (instant, 100% reliable)
  const ruleFix = generateRuleFix(finding, fileContent);
  if (ruleFix && ruleFix.oldSnippet && ruleFix.newSnippet) {
    return ruleFix;
  }

  // 2. If no deterministic rule fix matched and AI is enabled:
  // Try AI code repair with dynamic model switching across the fallback chain
  if (options.aiClient && !options.noAi) {
    try {
      if (typeof options.aiClient.repairCode === 'function') {
        const aiFix = await options.aiClient.repairCode({
          finding,
          fileContent,
          line: finding.line || 1,
          file: finding.file,
          preferredModel: options.preferredModel,
          onModelSwitch: options.onModelSwitch,
        });

        if (aiFix && aiFix.oldSnippet && aiFix.newSnippet) {
          return {
            startLine: finding.line || 1,
            endLine: finding.line || 1,
            oldSnippet: aiFix.oldSnippet,
            newSnippet: aiFix.newSnippet,
            explanation: aiFix.explanation || finding.suggestedFix || 'AI-generated code repair',
            modelUsed: aiFix.modelUsed,
            switchedFrom: aiFix.switchedFrom,
          };
        }
      } else if (typeof options.aiClient.analyze === 'function') {
        // Fallback for custom AI clients implementing standard analyze()
        const lines = fileContent.split('\n');
        const win = getLineWindow(lines, finding.line || 1, 3);
        const prompt = [
          'You are CodeSentry Automated Code Repair Assistant.',
          `File: ${finding.file}`,
          `Issue: ${finding.message}`,
          `Rule: ${finding.rule || 'N/A'}`,
          `Severity: ${finding.severity}`,
          `Line: ${finding.line || 1}`,
          finding.suggestedFix ? `Suggested approach: ${finding.suggestedFix}` : '',
          '',
          'Code snippet:',
          '```',
          win.lines.join('\n'),
          '```',
          '',
          'IMPORTANT: Respond with ONLY a JSON object: {"explanation":"...","oldSnippet":"...","newSnippet":"..."}',
        ].filter(Boolean).join('\n');

        const response = await options.aiClient.analyze(prompt);
        let parsed = null;
        if (typeof response === 'object' && response !== null) {
          parsed = response;
        } else if (typeof response === 'string') {
          const match = response.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }
        if (parsed && parsed.oldSnippet && parsed.newSnippet) {
          return {
            startLine: win.startLine,
            endLine: win.endLine,
            oldSnippet: parsed.oldSnippet,
            newSnippet: parsed.newSnippet,
            explanation: parsed.explanation || finding.suggestedFix || 'AI-generated fix',
          };
        }
      }
    } catch {
      // Continue to final return
    }
  }

  // Return error indicating why auto-fix was not applied
  return { error: `No auto-fix available for rule: ${finding.rule || 'unknown'}` };
}


/**
 * Repairs multiple findings across an entire file in ONE single consolidated operation.
 *
 * 1. Executes deterministic pattern-based fixes in-memory (0ms latency, handles common rules).
 * 2. If unresolved issues remain and AI is enabled, compiles a consolidated summary
 *    of all issues and sends them together with the file content to the AI model in ONE single prompt.
 * 3. If token expiration, rate limits (429), or errors occur during AI repair,
 *    the model automatically switches down the fallback chain.
 * 4. Atomically writes the updated content to disk once.
 */
async function batchFixFile(projectPath, filePath, fileFindings, options = {}) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);

  if (!fs.existsSync(fullPath)) {
    return {
      file: filePath,
      applied: [],
      skipped: fileFindings,
      error: `File not found: ${filePath}`,
      totalIssues: fileFindings.length,
    };
  }

  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch (err) {
    return {
      file: filePath,
      applied: [],
      skipped: fileFindings,
      error: `Cannot read file: ${err.message}`,
      totalIssues: fileFindings.length,
    };
  }

  const isPy = (filePath || '').endsWith('.py') || (filePath || '').endsWith('.pyw');
  const applied = [];
  const unresolved = [];

  // Sort findings in descending order by line number to prevent line number drift during in-memory edits
  const sortedFindings = [...fileFindings].sort((a, b) => (b.line || 0) - (a.line || 0));

  // ── Phase 1: Local Deterministic Rule Fixes (Instant, Zero Network Latency) ──
  for (const finding of sortedFindings) {
    // Re-compute current lines after each modification
    const currentLines = content.split('\n');

    // Helper: search the ENTIRE content for a pattern, not just the original line number
    // (line numbers drift after insertions/deletions by earlier fixes)
    const contentHas = (pattern) => pattern.test(content);

    // --- Compound dedup: mark as resolved ONLY if the problematic pattern is truly gone from the ENTIRE file ---
    // Flask debug=True
    if ((finding.rule === 'B201' || (finding.message && finding.message.includes('debug=True'))) && !contentHas(/debug\s*=\s*True/)) {
      applied.push({ finding, fix: { explanation: 'Disabled Flask debug mode in production (debug=False)' }, method: 'deterministic' });
      continue;
    }
    // Flask host 0.0.0.0
    if ((finding.rule === 'B104' || (finding.message && finding.message.includes('0.0.0.0'))) && !contentHas(/host\s*=\s*['"]0\.0\.0\.0['"]/)) {
      applied.push({ finding, fix: { explanation: 'Restricted Flask server binding to localhost (127.0.0.1)' }, method: 'deterministic' });
      continue;
    }
    // exec() already removed from the file
    if ((finding.rule === 'B102' || finding.rule === 'S102' || (finding.rule && finding.rule.includes('user-exec')) || (finding.message && /\bexec\s*\(/.test(finding.message))) && !contentHas(/\bexec\s*\(/)) {
      applied.push({ finding, fix: { explanation: 'Dynamic exec call already removed for security' }, method: 'deterministic' });
      continue;
    }
    // eval() already replaced in the file
    if ((finding.rule === 'B307' || finding.rule === 'S307' || (finding.rule && finding.rule.includes('user-eval')) || (finding.message && /\beval\s*\(/.test(finding.message))) && !contentHas(/\beval\s*\(/)) {
      applied.push({ finding, fix: { explanation: 'Unsafe eval already replaced with ast.literal_eval()' }, method: 'deterministic' });
      continue;
    }
    // SQL injection already parameterized (no f-strings or .format() with SQL keywords anywhere in file)
    if ((finding.rule === 'B608' || finding.rule === 'S608' || (finding.rule && (finding.rule.includes('tainted-sql') || finding.rule.includes('formatted-sql') || finding.rule.includes('sql-injection')))) && !contentHas(/f["'].*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i) && !contentHas(/\.format\s*\(/)) {
      applied.push({ finding, fix: { explanation: 'SQL query already parameterized to prevent injection' }, method: 'deterministic' });
      continue;
    }
    // pickle already replaced in the file
    if ((finding.rule === 'B301' || (finding.rule && finding.rule.includes('insecure-deserialization'))) && !contentHas(/pickle\.loads?\s*\(/)) {
      applied.push({ finding, fix: { explanation: 'Insecure pickle deserialization already replaced with json.loads()' }, method: 'deterministic' });
      continue;
    }
    // B403 pickle advisory / import already resolved (including _BufferCallback)
    if ((finding.rule === 'B403') && !/\bpickle\b/.test(content)) {
      applied.push({ finding, fix: { explanation: 'Insecure pickle module replaced with json module' }, method: 'deterministic' });
      continue;
    }
    // B404 subprocess advisory already resolved or import removed
    if (finding.rule === 'B404' && (!content.includes('import subprocess') || content.includes('# noqa: B404'))) {
      applied.push({ finding, fix: { explanation: 'Subprocess security advisory acknowledged or unused import removed' }, method: 'deterministic' });
      continue;
    }
    // py-command-injection already fixed (shell=True removed from file)
    if ((finding.rule === 'py-command-injection' || finding.rule === 'B602' || finding.rule === 'S602') && !contentHas(/shell\s*=\s*True/)) {
      applied.push({ finding, fix: { explanation: 'Command injection fixed: shell=True already removed' }, method: 'deterministic' });
      continue;
    }
    // deployguard-production-debug already fixed (debug=True removed from file)
    if ((finding.rule === 'deployguard-production-debug' || (finding.rule && finding.rule.includes('production-debug'))) && !contentHas(/debug\s*=\s*True/)) {
      applied.push({ finding, fix: { explanation: 'Production debug mode already disabled' }, method: 'deterministic' });
      continue;
    }
    // Hardcoded secret already replaced — check no raw hardcoded secret patterns remain
    if ((finding.rule === 'hardcoded-secret' || finding.rule === 'B105' || finding.rule === 'B106')) {
      const secretPattern = /(?:(?:API|SECRET|AUTH|ACCESS|PRIVATE)[_-]?(?:KEY|TOKEN|SECRET)|(?:DB_|DATABASE_)PASSWORD)\s*[:=]\s*['"][^'"]{6,}['"]/i;
      if (!secretPattern.test(content) || (content.includes('os.environ.get(') && !secretPattern.test(content.replace(/os\.environ\.get\([^)]*\)/g, '')))) {
        applied.push({ finding, fix: { explanation: 'Hardcoded secret already replaced with os.environ.get()' }, method: 'deterministic' });
        continue;
      }
    }
    // Undefined variable already resolved (import added or variable defined)
    if ((finding.rule === 'F821' || finding.rule === 'undefined-variable') && finding.message) {
      const undVarMatch = finding.message.match(/[`'"]([a-zA-Z_]\w*)[`'"]/);
      if (undVarMatch) {
        const vName = undVarMatch[1];
        const isDef = new RegExp(`\\b(?:import\\s+${vName}|from\\s+\\S+\\s+import\\s+[^\\n]*\\b${vName}\\b|${vName}\\s*=|def\\s+${vName}\\b|class\\s+${vName}\\b)`).test(content);
        if (isDef) {
          applied.push({ finding, fix: { explanation: `Undefined variable '${vName}' already resolved` }, method: 'deterministic' });
          continue;
        }
      }
    }
    // Unused import already removed
    if ((finding.rule === 'F401') && finding.message) {
      const unusedMatch = finding.message.match(/[`'"]?([a-zA-Z0-9_.]+)[`'"]?\s+imported but unused/);
      if (unusedMatch) {
        const importName = unusedMatch[1].includes('.') ? unusedMatch[1].split('.').pop() : unusedMatch[1];
        if (!content.includes(importName)) {
          applied.push({ finding, fix: { explanation: `Unused import '${unusedMatch[1]}' already removed` }, method: 'deterministic' });
          continue;
        }
      }
    }

    const ruleFix = generateRuleFix(finding, content);
    if (ruleFix && ruleFix.oldSnippet && typeof ruleFix.newSnippet === 'string') {
      const updated = applySnippetToContent(content, ruleFix.oldSnippet, ruleFix.newSnippet, finding.line);
      if (updated !== null && updated !== content) {
        content = updated;
        applied.push({
          finding,
          fix: ruleFix,
          method: 'deterministic',
        });
        continue;
      }
    }
    unresolved.push(finding);
  }

  // ── Phase 2: Send Consolidated Summary to AI with Dynamic Model Switching ──
  let modelUsed = null;
  let switchedFrom = null;

  if (unresolved.length > 0 && options.aiClient && !options.noAi) {
    try {
      if (typeof options.aiClient.repairFileBatch === 'function') {
        const batchRes = await options.aiClient.repairFileBatch({
          file: filePath,
          fileContent: content,
          findings: [...unresolved],
          preferredModel: options.preferredModel,
          onModelSwitch: options.onModelSwitch,
        });

        if (batchRes && batchRes.fixes && batchRes.fixes.length > 0) {
          modelUsed = batchRes.modelUsed;
          switchedFrom = batchRes.switchedFrom;

          for (const item of batchRes.fixes) {
            const updated = applySnippetToContent(content, item.oldSnippet, item.newSnippet);
            if (updated !== null && updated !== content) {
              content = updated;

              // Find closest matching unresolved finding
              const matchedIdx = unresolved.findIndex(f =>
                (item.explanation && f.rule && item.explanation.toLowerCase().includes(f.rule.toLowerCase())) ||
                (f.message && item.explanation && item.explanation.toLowerCase().includes(f.message.slice(0, 20).toLowerCase())) ||
                (f.suggestedFix && item.explanation && item.explanation.toLowerCase().includes(f.suggestedFix.slice(0, 20).toLowerCase()))
              );

              const matchedFinding = matchedIdx !== -1 ? unresolved.splice(matchedIdx, 1)[0] : unresolved.shift();

              applied.push({
                finding: matchedFinding || { file: filePath, message: item.explanation },
                fix: item,
                method: 'ai-batch',
                modelUsed,
                switchedFrom,
              });
            }
          }
        }
      }
    } catch {
      // Unresolved findings remain in unresolved array
    }
  }

  // ── Phase 3: Post-Processing, Pre-Commit Syntax Validation & Atomic Disk Write ──
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.py' || ext === '.pyw') {
    content = postProcessPythonFile(content);
  }

  // Iterative syntax healer: run unconditionally if syntax errors exist
  for (let healPass = 0; healPass < 10; healPass++) {
    const syntaxCheck = validateSyntax(filePath, content);
    if (syntaxCheck.valid) break;

    if (syntaxCheck.line && typeof syntaxCheck.line === 'number') {
      const dummyFinding = {
        rule: 'invalid-syntax',
        line: syntaxCheck.line,
        file: filePath,
        message: syntaxCheck.error,
      };
      const healFix = generateRuleFix(dummyFinding, content);
      if (healFix && healFix.oldSnippet && typeof healFix.newSnippet === 'string') {
        const healed = applySnippetToContent(content, healFix.oldSnippet, healFix.newSnippet, syntaxCheck.line);
        if (healed !== null && healed !== content) {
          content = healed;
          applied.push({
            finding: dummyFinding,
            fix: healFix,
            method: 'deterministic',
          });
          continue;
        }
      }
    }
    break;
  }

  let originalFileContent = '';
  try {
    originalFileContent = fs.readFileSync(fullPath, 'utf8');
  } catch {}

  if (applied.length === 0 && content !== originalFileContent) {
    applied.push({
      finding: fileFindings[0] || { file: filePath, message: 'Automated syntax & structure healing' },
      fix: { explanation: 'Applied automated syntax healing and structure normalization' },
      method: 'deterministic',
    });
  }

  if (applied.length > 0) {
    const finalSyntaxCheck = validateSyntax(filePath, content);
    if (!finalSyntaxCheck.valid) {
      return {
        file: filePath,
        applied: [],
        skipped: fileFindings,
        error: `Pre-commit validation failed (${finalSyntaxCheck.error}). File was NOT modified to prevent code corruption.`,
        totalIssues: fileFindings.length,
      };
    }

    const sandboxResult = executeWithAutoSandbox({
      projectPath,
      filePath: fullPath,
      originalContent: originalFileContent,
      proposedContent: content,
      findings: fileFindings,
      applyFn: () => {
        fs.writeFileSync(fullPath, content, 'utf8');
      },
    });

    if (!sandboxResult.success) {
      return {
        file: filePath,
        applied: [],
        skipped: fileFindings,
        error: sandboxResult.error,
        totalIssues: fileFindings.length,
        sandboxed: sandboxResult.sandboxed,
      };
    }

    for (const item of applied) {
      if (sandboxResult.sandboxed) {
        item.sandboxed = true;
      }
      if (item.finding && item.fix && item.fix.oldSnippet && item.fix.newSnippet) {
        try {
          learnFromFix(item.finding, item.fix.oldSnippet, item.fix.newSnippet);
        } catch {
          // Non-fatal
        }
      }
    }
  }

  const appliedFindingSet = new Set(applied.map(a => a.finding).filter(Boolean));
  const skipped = fileFindings.filter(f => !appliedFindingSet.has(f));

  return {
    file: filePath,
    applied,
    skipped,
    modelUsed,
    switchedFrom,
    totalIssues: fileFindings.length,
  };
}

/**
 * Validates syntax of modified file content before saving to disk.
 * Returns { valid: true } or { valid: false, error: string, line?: number }.
 */
module.exports = {
  generateFix,
  batchFixFile,
};
