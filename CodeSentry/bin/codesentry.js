#!/usr/bin/env node

/**
 * CodeSentry CLI entry point
 *
 * Works correctly under all install modes:
 *   npx codesentry scan .              (ephemeral)
 *   npm i -g codesentry && codesentry  (global)
 *   npm link && codesentry             (local dev)
 *   node bin/codesentry.js             (direct)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ── Resolve the package root regardless of how we were invoked ──────────────
// __dirname = <package>/bin  →  packageRoot = <package>
const packageRoot = path.resolve(__dirname, '..');

// ── Load .env from the user's current working directory (the project they
//    are scanning). During test runs, allow falling back to packageRoot .env.
require('dotenv').config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
if (process.env.NODE_ENV === 'test') {
  require('dotenv').config({ path: path.resolve(packageRoot, '.env'), quiet: true });
}

// ── Require modules relative to the package root ────────────────────────────
const auth = require(path.join(packageRoot, 'src', 'cli', 'auth'));
auth.loadGlobalConfig();

const { createCommandParser, COMMANDS } = require(path.join(packageRoot, 'src', 'cli', 'commands'));
const { createOutputHandler, OUTPUT_MODES } = require(path.join(packageRoot, 'src', 'cli', 'output'));
const { createProgressTracker, PROGRESS_STATES } = require(path.join(packageRoot, 'src', 'cli', 'progress'));
const { createFormatter } = require(path.join(packageRoot, 'src', 'cli', 'formatter'));
const { createReportGenerator } = require(path.join(packageRoot, 'src', 'cli', 'report'));
const { Select, promptActionOnTab } = require(path.join(packageRoot, 'src', 'cli', 'components', 'select'));
const { formatStatusIndicator } = require(path.join(packageRoot, 'src', 'cli', 'components', 'status-indicator'));
const fixer = require(path.join(packageRoot, 'src', 'cli', 'fixer'));
const enhancer = require(path.join(packageRoot, 'src', 'cli', 'enhancer'));
const theme = require(path.join(packageRoot, 'src', 'cli', 'theme'));
const { scan } = require(path.join(packageRoot, 'src', 'core', 'scan'));

// ── AI Model Catalog for Interactive Selection ──────────────────────────────
const AI_MODEL_OPTIONS = [
  {
    label: 'MiniMax M3 (minimax/minimax-m3)',
    value: 'minimax/minimax-m3',
    badge: 'RECOMMENDED',
    description: 'Premier code reasoning & automated repair model with high precision synthesis',
  },
  {
    label: 'DeepSeek V3 (deepseek/deepseek-chat)',
    value: 'deepseek/deepseek-chat',
    badge: 'POPULAR',
    description: 'High-precision automated code repair and vulnerability remediation',
  },
  {
    label: 'Qwen 2.5 Coder 32B (qwen/qwen-2.5-coder-32b-instruct)',
    value: 'qwen/qwen-2.5-coder-32b-instruct',
    badge: '#1 CODING',
    description: 'Top-ranking open coding benchmark model (92.7% HumanEval)',
  },
  {
    label: 'Llama 3.3 70B (meta-llama/llama-3.3-70b-instruct)',
    value: 'meta-llama/llama-3.3-70b-instruct',
    badge: '70B PARAMS',
    description: 'State-of-the-art open reasoning and multi-turn refactoring',
  },
  {
    label: 'Qwen 2.5 72B (qwen/qwen-2.5-72b-instruct)',
    value: 'qwen/qwen-2.5-72b-instruct',
    badge: '72B PARAMS',
    description: 'Deep polyglot code reasoning and architectural analysis',
  },
  {
    label: 'MiniMax M2.5 (minimax/minimax-m2.5)',
    value: 'minimax/minimax-m2.5',
    badge: 'FAST',
    description: 'High-speed balanced code inspection and remediation diffs',
  },
  {
    label: 'GLM 5.2 (z-ai/glm-5.2)',
    value: 'z-ai/glm-5.2',
    description: 'High-performance general reasoning and code triage',
  },
  {
    label: 'Cohere North Mini Code (cohere/north-mini-code:free)',
    value: 'cohere/north-mini-code:free',
    badge: 'FREE',
    description: 'Fast Cohere-optimized code structure analysis',
  },
  {
    label: 'Auto (Smart Context-Aware Heuristics)',
    value: 'auto',
    badge: 'AUTO',
    description: 'Dynamically adapts model selection based on project size & complexity',
  },
  {
    label: 'Disable AI (Static Analysis Only)',
    value: 'none',
    description: 'Run static engines (Ruff, Bandit, Semgrep) without cloud AI',
  },
];

// Ctrl+C graceful exit handler
process.on('SIGINT', () => {
  console.log('\n' + theme.colors.cyan('◆') + ' ' + theme.colors.white('CodeSentry session closed.'));
  process.exit(0);
});

async function main() {
  const parser = createCommandParser();
  const parsed = parser.parse(process.argv.slice(2));
  const validation = parser.validate(parsed);

  if (!validation.valid) {
    const output = createOutputHandler({ mode: OUTPUT_MODES.TERMINAL });
    output.printError('Error:');
    for (const error of validation.errors) {
      output.printError(`  ${error}`);
    }
    process.exit(2);
  }

  if (parsed.command === COMMANDS.HELP) {
    const output = createOutputHandler({ mode: OUTPUT_MODES.TERMINAL });
    output.print(theme.renderLogo());
    output.print(parser.getHelp());
    process.exit(0);
  }

  if (parsed.command === COMMANDS.VERSION) {
    const output = createOutputHandler({ mode: OUTPUT_MODES.TERMINAL });
    output.print(parser.getVersion());
    process.exit(0);
  }

  // ── Standalone 'demo' command (Hackathon Showcase) ─────────────────────────
  if (parsed.command === COMMANDS.DEMO) {
    const { runHackathonDemo } = require(path.join(packageRoot, 'src', 'cli', 'demo'));
    await runHackathonDemo();
    process.exit(0);
  }

  // ── Standalone 'auth' command ──────────────────────────────────────────────
  if (parsed.command === COMMANDS.AUTH) {
    await auth.handleAuthCommand();
    process.exit(0);
  }

  // ── Standalone 'model' command ─────────────────────────────────────────────
  if (parsed.command === COMMANDS.MODEL) {
    theme.applyBlackTerminalBackground();
    const output = createOutputHandler({ mode: OUTPUT_MODES.TERMINAL });
    output.print(theme.renderLogo());

    const currentEnvModel = process.env.OPENROUTER_MODEL || 'auto';
    const defaultIdx = Math.max(0, AI_MODEL_OPTIONS.findIndex(m => m.value === currentEnvModel));

    const chosen = await Select({
      label: 'Select Active AI Model for CodeSentry:',
      options: AI_MODEL_OPTIONS,
      defaultIndex: defaultIdx,
    });

    if (chosen) {
      if (chosen === 'none') {
        output.print('\n' + formatStatusIndicator({ status: 'warning', label: 'AI analysis disabled. Static analysis only.' }));
      } else {
        output.print('\n' + formatStatusIndicator({ status: 'online', label: `Active AI model set to: ${theme.colors.cyan(chosen)}` }));
        try {
          auth.saveGlobalConfig({ openrouter_model: chosen });
          const envPath = path.resolve(process.cwd(), '.env');
          let envContent = await fs.promises.access(envPath) ? await fs.promises.readFile(envPath, 'utf8') : '';
          if (/^OPENROUTER_MODEL=.*$/m.test(envContent)) {
            envContent = envContent.replace(/^OPENROUTER_MODEL=.*$/m, `OPENROUTER_MODEL=${chosen}`);
          } else {
            envContent = envContent.trim() ? `${envContent.trim()}\nOPENROUTER_MODEL=${chosen}\n` : `OPENROUTER_MODEL=${chosen}\n`;
          }
          await fs.promises.writeFile(envPath, envContent, 'utf8');
          output.print(theme.colors.gray(`  Saved preference globally to ~/.codesentry/config.json`));
        } catch {}
      }
    }
    process.exit(0);
  }

  // ── 'scan' command with interactive session loop ───────────────────────────
  if (parsed.command === COMMANDS.SCAN || parsed.command === COMMANDS.DEPLOYGUARD || parsed.command === COMMANDS.AUTOGRAD) {
    const jsonMode = parsed.options.json || false;
    const verbose = parsed.options.verbose || false;

    const output = createOutputHandler({
      mode: jsonMode ? OUTPUT_MODES.JSON : OUTPUT_MODES.TERMINAL,
    });

    const formatter = createFormatter();

    // Mutable state for the interactive loop
    let currentModel = parsed.options.aiModel || process.env.OPENROUTER_MODEL || 'auto';
    let currentNoAi = Boolean(parsed.options.noAi || currentModel === 'none');
    let isFirstRun = true;
    let lastReportPath = null;

    // First-boot / auth check: Prompt if no key is configured and AI is not explicitly disabled
    if (!currentNoAi) {
      const authResult = await auth.ensureAuth({
        jsonMode,
        noAi: currentNoAi,
      });
      if (authResult.skipped && !process.env.OPENROUTER_API_KEY) {
        currentNoAi = true;
        currentModel = 'none';
      } else if (authResult.isConfigured) {
        if (!parsed.options.aiModel && authResult.model) {
          currentModel = authResult.model;
        }
      }
    }

    while (true) {
      const progress = createProgressTracker({
        verbose,
        jsonMode,
      });

      if (!jsonMode) {
        theme.applyBlackTerminalBackground();
        if (isFirstRun) {
          output.print(theme.renderLogo());
          isFirstRun = false;
        }
        output.print(theme.renderSessionCard(parsed.projectPath, {
          aiModel: currentNoAi ? 'disabled (static)' : currentModel,
        }));
        output.print('');
      }

      progress.start();

      let result;
      let lastExitCode = 0;

      try {
        progress.update(PROGRESS_STATES.DISCOVERING);

        const scanOptions = {
          projectPath: parsed.projectPath,
          jsonMode,
          verbose,
          aiEnabled: !currentNoAi,
          onProgress: (state) => {
            progress.update(state);
          },
        };

        if (parsed.options.severity) {
          scanOptions.severityThreshold = parsed.options.severity.toUpperCase();
        }

        if (parsed.options.category) {
          scanOptions.categoryFilter = parsed.options.category.toLowerCase();
        }

        if (!currentNoAi && currentModel && currentModel !== 'auto') {
          scanOptions.aiModel = currentModel;
        }

        result = await scan(parsed.projectPath, scanOptions);

        progress.update(PROGRESS_STATES.COMPLETED);
        progress.complete(true);

        if (jsonMode) {
          output.printJSON(result);
        } else {
          output.print('');
          const summaryLines = formatter.formatSummary(result);
          for (const line of summaryLines) {
            output.print(line);
          }

          output.print('');

          const findingLines = formatter.formatFindings(result.findings, {
            limit: 10,
            showDetails: true,
          });
          for (const line of findingLines) {
            output.print(line);
          }
        }

        // CI/CD Deployment Readiness Gate enforcement
        if (parsed.options.gate && result.deployguard && result.deployguard.status === 'BLOCKED') {
          if (!jsonMode) {
            output.print('');
            output.print(theme.colors.red(theme.bold(`❌ [DEPLOYGUARD GATE FAILED] ${result.deployguard.message}`)));
          }
          process.exit(1);
        }

        // Generate report by default (disable with --no-report)
        if (!parsed.options.noReport) {
          try {
            const reportGen = createReportGenerator({
              outputDir: parsed.projectPath,
              filename: parsed.options.reportFile || null,
            });
            const reportPath = reportGen.generate(result);
            lastReportPath = reportPath;

            if (!jsonMode) {
              output.print('');
              const fileName = path.basename(reportPath);
              const relPath = path.relative(process.cwd(), reportPath) || fileName;
              const displayRelPath = relPath.length > 50 ? '...' + relPath.slice(-47) : relPath;
              const clickableReportName = theme.createClickableLink(reportPath, theme.colors.brightWhite(fileName));
              const clickableRelPath = theme.createClickableLink(reportPath, theme.colors.cyan(displayRelPath));

              const footerLines = [
                `${theme.colors.cyan('■ File')}     ${clickableReportName} ${theme.colors.gray('(Click to open in editor)')}`,
                `${theme.colors.gray('■ Path')}     ${clickableRelPath}`,
                `${theme.colors.gray('■ Status')}   ${theme.colors.green('✔ Audit complete')} ${theme.colors.darkGray('·')} ${theme.colors.white(`${result.metadata.duration}ms`)} ${theme.colors.darkGray('·')} ${theme.colors.cyan(result.languages.join(', ') || 'polyglot')}`,
              ];
              output.print(theme.card(footerLines, {
                title: theme.colors.cyan(theme.bold('AUDIT REPORT')),
                rightTitle: theme.colors.gray('codesentry v0.1.0'),
                width: 72,
              }));
              output.print('');
            }
          } catch (reportErr) {
            if (!jsonMode) {
              output.printError(`\nFailed to generate report: ${reportErr.message}`);
            }
          }
        }

        // Determine exit code
        if (result.metadata.errors.length > 0) {
          lastExitCode = 2;
        } else if (result.aggregation.total > 0) {
          lastExitCode = 1;
        } else {
          lastExitCode = 0;
        }
      } catch (err) {
        progress.error(`Scan failed: ${err.message}`);
        progress.complete(false);

        if (!jsonMode) {
          output.printError(`\nScan failed: ${err.message}\n`);
        } else {
          output.printJSON({
            error: err.message,
            success: false,
          });
        }
        lastExitCode = 2;
      }

      // ── Automated Repair (--fix / --yes) without manual approval ──────────
      if ((parsed.options.fix || parsed.options.yes) && result && result.findings && result.findings.length > 0) {
        output.print('\n' + formatStatusIndicator({
          status: 'online',
          label: `Auto-repair triggered (--fix): Repairing all ${result.findings.length} findings without manual approval...`,
        }));

        let aiClient = null;
        if (!currentNoAi) {
          try {
            const { createAIClient } = require(path.join(packageRoot, 'src', 'analyzers', 'ai', 'client'));
            aiClient = createAIClient({ model: currentModel });
          } catch {}
        }

        const findingsByFile = new Map();
        for (const f of result.findings) {
          const fileKey = f.file || 'unknown';
          if (!findingsByFile.has(fileKey)) {
            findingsByFile.set(fileKey, []);
          }
          findingsByFile.get(fileKey).push(f);
        }

        let appliedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const [filePath, fileFindings] of findingsByFile.entries()) {
          output.print(`\n  ${theme.colors.cyan('➔')} Processing ${theme.colors.brightWhite(filePath)} (${fileFindings.length} issues)...`);

          const batchResult = await fixer.batchFixFile(parsed.projectPath, filePath, fileFindings, {
            aiClient,
            noAi: currentNoAi,
            preferredModel: currentModel,
            onModelSwitch: ({ failedModel, nextModel, error, isTokenExpire }) => {
              let reason = 'Model error';
              if (/free-models-per-day/i.test(error || '')) {
                reason = 'Free daily account limit reached on OpenRouter';
              } else if (/use this slug instead/i.test(error || '')) {
                reason = 'Free slug retired by OpenRouter, using standard model';
              } else if (/timed out/i.test(error || '')) {
                reason = 'Request timed out';
              } else if (isTokenExpire) {
                reason = 'Token limit or quota exhausted';
              }
              output.print(`    ${theme.colors.yellow('⚡')} ${reason} on ${theme.colors.gray(failedModel)} → Switched to ${theme.colors.cyan(nextModel)}`);
            },
          });

          if (batchResult.error) {
            failedCount += fileFindings.length;
            output.print(`    ${theme.colors.red('✘')} Failed ${theme.colors.cyan(filePath)} — ${theme.colors.gray(batchResult.error)}`);
            continue;
          }

          if (batchResult.applied.length > 0) {
            appliedCount += batchResult.applied.length;
            const modelTag = batchResult.modelUsed
              ? (batchResult.switchedFrom
                  ? theme.colors.yellow(` [switched: ${batchResult.modelUsed}]`)
                  : theme.colors.cyan(` [via ${batchResult.modelUsed}]`))
              : theme.colors.green(' [deterministic rule]');

            output.print(`    ${theme.colors.green('✔')} Resolved ${batchResult.applied.length}/${fileFindings.length} issues in ${theme.colors.brightWhite(filePath)}${modelTag}`);
            for (const item of batchResult.applied) {
              const desc = item.fix?.explanation || item.finding?.message || 'Fixed issue';
              output.print(`      ${theme.colors.green('•')} ${theme.colors.gray(desc)}`);
            }
          }

          if (batchResult.skipped.length > 0) {
            skippedCount += batchResult.skipped.length;
            output.print(`    ${theme.colors.yellow('⊘')} ${batchResult.skipped.length} issue(s) remain in ${theme.colors.brightWhite(filePath)} requiring manual review`);
          }
        }

        output.print('\n' + formatStatusIndicator({
          status: appliedCount > 0 ? 'online' : 'warning',
          label: `Fix Summary: ${theme.colors.green(appliedCount + ' applied')}${skippedCount > 0 ? `, ${theme.colors.yellow(skippedCount + ' skipped')}` : ''}${failedCount > 0 ? `, ${theme.colors.red(failedCount + ' failed')}` : ''}`,
        }));

        parsed.options.fix = false;
        parsed.options.yes = false;

        if (appliedCount > 0) {
          output.print(theme.colors.gray('\nRe-scanning codebase to verify fixes...\n'));
          continue;
        }
      }

      // Non-interactive or JSON mode exits immediately (e.g. CI/CD or automation)
      const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY && !jsonMode);
      if (!isInteractive) {
        process.exit(lastExitCode);
      }

      // ── Interactive Post-Scan Menu ─────────────────────────────────────────
      // "dont return the empty terminal get option to scan again with toggle"
      // "only ctrl+c should let me exit the codecentry"
      const actionOptions = [];

      if (result && result.findings && result.findings.length > 0) {
        actionOptions.push({
          label: `Auto-Fix All Issues (Zero manual confirmation required: ${result.findings.length} findings)`,
          value: 'apply_improvements',
          badge: 'AUTO-FIX',
          description: 'Batch repair all security flaws and bugs across your codebase without manual approval',
        });
      } else if (result) {
        actionOptions.push({
          label: 'Ask AI for Proactive Security Suggestions (Codebase Clean)',
          value: 'ai_security_suggestions',
          badge: 'AI',
          description: 'Consult the active AI model for tailored defense-in-depth security hardening recommendations',
        });
      }

      const shortModel = currentNoAi ? 'Static' : (currentModel.split('/')[1]?.split(':')[0] || currentModel);
      actionOptions.push(
        {
          label: `Rescan codebase (${shortModel})`,
          value: 'rescan',
          badge: 'RESCAN',
          description: 'Re-audit the codebase immediately',
        },
        {
          label: 'Toggle / Switch AI Model & Rescan',
          value: 'switch_model',
          badge: 'MODEL',
          description: 'Change AI model and re-scan the codebase',
        }
      );

      if (lastReportPath) {
        actionOptions.push({
          label: `Open Markdown Report (${path.basename(lastReportPath)})`,
          value: 'open_report',
          badge: 'OPEN',
          description: 'Launch audit report file directly in your default editor',
        });
      }

      actionOptions.push({
        label: 'Exit CodeSentry',
        value: 'exit',
        badge: 'EXIT',
        description: 'Close the inspection session and return to terminal',
      });

      const hasFindings = Boolean(result && result.findings && result.findings.length > 0);
      const rightTitle = hasFindings
        ? `${result.findings.length} findings · press Tab for menu`
        : 'clean baseline · press Tab for menu';
      const summaryLabel = hasFindings && result.autograd && result.autograd.offlineResolvableCount > 0
        ? `⚡ ${result.autograd.offlineResolvableCount} issues can be auto-resolved offline instantly`
        : null;

      const action = await promptActionOnTab({
        rightTitle,
        summaryLabel,
        defaultAction: 'rescan',
        selectProps: {
          title: 'ACTIONS & FIXES',
          label: 'Audit session active. What would you like to do next?',
          options: actionOptions,
          defaultIndex: 0,
        },
      });

      if (!action || action === 'exit') {
        process.exit(0);
      }

      if (action === 'apply_improvements') {
        const securityFindings = result.findings.filter(f => f.category === 'security');
        const bugFindings = result.findings.filter(f => f.category === 'bugs');
        const otherFindings = result.findings.filter(f => f.category !== 'security' && f.category !== 'bugs');

        const scopeOptions = [
          {
            label: 'Batch fix all categories (Entire codebase — zero approval required)',
            value: 'whole_codebase',
            badge: 'ALL',
            description: `Automatically correct all ${result.findings.length} auto-repairable flaws across all categories without manual prompts`,
          },
        ];

        if (bugFindings.length > 0) {
          scopeOptions.push({
            label: `Batch resolve all Code Bugs (${bugFindings.length} findings)`,
            value: 'resolve_bugs',
            badge: 'BUGS',
            description: 'Batch fix logic bugs, empty catch blocks, race conditions, type & boundary errors',
          });
        }

        if (securityFindings.length > 0) {
          scopeOptions.push({
            label: `Batch resolve all Security Flaws (${securityFindings.length} findings)`,
            value: 'resolve_security',
            badge: 'SECURITY',
            description: 'Batch fix injection attacks, hardcoded secrets, weak hashes, unsafe configs',
          });
        }

        if (otherFindings.length > 0) {
          scopeOptions.push({
            label: `Batch resolve Efficiency & Resource issues (${otherFindings.length} findings)`,
            value: 'resolve_other',
            badge: 'PERF',
            description: 'Batch fix performance bottlenecks, sync I/O in async, unclosed resources',
          });
        }

        scopeOptions.push(
          {
            label: 'Select specific flaw to preview and fix interactively',
            value: 'specific_bug',
            badge: 'SPECIFIC',
            description: 'Inspect individual finding with diff preview before applying',
          },
          {
            label: '← Back to Main Menu',
            value: 'back',
            description: 'Return to previous menu',
          }
        );

        const scope = await Select({
          label: 'Select Fix Scope:',
          options: scopeOptions,
          defaultIndex: 0,
        });

        if (scope === 'back') {
          continue;
        }

        // Prepare AI client if enabled
        let aiClient = null;
        if (!currentNoAi) {
          try {
            const { createAIClient } = require('../src/analyzers/ai/client');
            aiClient = createAIClient({ model: currentModel });
          } catch {}
        }

        if (scope === 'whole_codebase' || scope === 'resolve_bugs' || scope === 'resolve_security' || scope === 'resolve_other') {
          let targetPool = result.findings;
          let scopeLabel = 'entire codebase';
          if (scope === 'resolve_bugs') {
            targetPool = bugFindings;
            scopeLabel = 'Code Bugs';
          } else if (scope === 'resolve_security') {
            targetPool = securityFindings;
            scopeLabel = 'Security Flaws';
          } else if (scope === 'resolve_other') {
            targetPool = otherFindings;
            scopeLabel = 'Efficiency & Resources';
          }

          output.print('\n' + formatStatusIndicator({ status: 'online', label: `Applying improvements for ${scopeLabel} (${targetPool.length} findings)...` }));

          // Group findings by file for consolidated single-pass repair
          const findingsByFile = new Map();
          const MAX_FINDINGSBYFILE_SIZE = 5000;
          // CodeSentry: eviction guard helper
          function pruneFindingsByFile() { while (findingsByFile.size > MAX_FINDINGSBYFILE_SIZE) findingsByFile.delete(findingsByFile.keys().next().value); }
          for (const f of targetPool) {
            const fileKey = f.file || 'unknown';
            if (!findingsByFile.has(fileKey)) {
              findingsByFile.set(fileKey, []);
            }
            findingsByFile.get(fileKey).push(f);
          }

          let appliedCount = 0;
          let skippedCount = 0;
          let failedCount = 0;

          for (const [filePath, fileFindings] of findingsByFile.entries()) {
            output.print(`\n  ${theme.colors.cyan('➔')} Processing ${theme.colors.brightWhite(filePath)} (${fileFindings.length} issues)...`);

            const batchResult = await fixer.batchFixFile(parsed.projectPath, filePath, fileFindings, {
              aiClient,
              noAi: currentNoAi,
              preferredModel: currentModel,
              onModelSwitch: ({ failedModel, nextModel, error, isTokenExpire }) => {
                let reason = 'Model error';
                if (/free-models-per-day/i.test(error || '')) {
                  reason = 'Free daily account limit reached on OpenRouter';
                } else if (/use this slug instead/i.test(error || '')) {
                  reason = 'Free slug retired by OpenRouter, using standard model';
                } else if (/timed out/i.test(error || '')) {
                  reason = 'Request timed out';
                } else if (isTokenExpire) {
                  reason = 'Token limit or quota exhausted';
                }
                output.print(`    ${theme.colors.yellow('⚡')} ${reason} on ${theme.colors.gray(failedModel)} → Switched to ${theme.colors.cyan(nextModel)}`);
              },
            });

            if (batchResult.error) {
              failedCount += fileFindings.length;
              output.print(`    ${theme.colors.red('✘')} Failed ${theme.colors.cyan(filePath)} — ${theme.colors.gray(batchResult.error)}`);
              continue;
            }

            if (batchResult.applied.length > 0) {
              appliedCount += batchResult.applied.length;
              const modelTag = batchResult.modelUsed
                ? (batchResult.switchedFrom
                    ? theme.colors.yellow(` [switched: ${batchResult.modelUsed}]`)
                    : theme.colors.cyan(` [via ${batchResult.modelUsed}]`))
                : theme.colors.green(' [deterministic rule]');

              output.print(`    ${theme.colors.green('✔')} Resolved ${batchResult.applied.length}/${fileFindings.length} issues in ${theme.colors.brightWhite(filePath)}${modelTag}`);
              for (const item of batchResult.applied) {
                const desc = item.fix.explanation || item.finding?.message || 'Fixed issue';
                output.print(`      ${theme.colors.green('•')} ${theme.colors.gray(desc)}`);
              }
            }

            if (batchResult.skipped.length > 0) {
              skippedCount += batchResult.skipped.length;
              if (batchResult.applied.length === 0) {
                output.print(`    ${theme.colors.yellow('⊘')} Skipped ${batchResult.skipped.length} issues in ${theme.colors.brightWhite(filePath)} — no auto-fix available`);
              } else {
                output.print(`    ${theme.colors.yellow('⊘')} ${batchResult.skipped.length} issue(s) remain in ${theme.colors.brightWhite(filePath)} requiring manual review`);
              }
            }
          }
          output.print('');
          output.print(formatStatusIndicator({
            status: appliedCount > 0 ? 'online' : 'warning',
            label: `Fix Summary: ${theme.colors.green(appliedCount + ' applied')}${skippedCount > 0 ? `, ${theme.colors.yellow(skippedCount + ' skipped')}` : ''}${failedCount > 0 ? `, ${theme.colors.red(failedCount + ' failed')}` : ''}`,
          }));
          if (appliedCount > 0) {
            output.print(theme.colors.gray('\nRe-scanning to verify fixes...\n'));
          } else {
            output.print(theme.colors.gray('\nNo files were modified.\n'));
          }
          continue;
        }

        if (scope === 'specific_bug') {
          const categoryOptions = [];
          if (securityFindings.length > 0) {
            categoryOptions.push({
              label: `Security Flaws (${securityFindings.length} findings)`,
              value: 'security',
              badge: 'SECURITY',
              description: 'Vulnerabilities, injection attacks, hardcoded secrets, unsafe calls',
            });
          }
          if (bugFindings.length > 0) {
            categoryOptions.push({
              label: `Code Bugs (${bugFindings.length} findings)`,
              value: 'bugs',
              badge: 'BUGS',
              description: 'Logic bugs, empty catch blocks, race conditions, type errors',
            });
          }
          if (otherFindings.length > 0) {
            categoryOptions.push({
              label: `Efficiency & Resource Issues (${otherFindings.length} findings)`,
              value: 'other',
              badge: 'PERF',
              description: 'Algorithmic bottlenecks and unclosed handles',
            });
          }

          categoryOptions.push({
            label: `All Categories (${result.findings.length} findings)`,
            value: 'all',
            badge: 'ALL',
            description: 'Show all detected findings without filtering',
          });

          categoryOptions.push({
            label: '← Back',
            value: 'back',
            description: 'Return to previous menu',
          });

          const selectedCategory = await Select({
            label: 'Filter by flaw type:',
            options: categoryOptions,
            defaultIndex: 0,
          });

          if (selectedCategory === 'back') {
            continue;
          }

          let pool = result.findings;
          if (selectedCategory === 'security') pool = securityFindings;
          else if (selectedCategory === 'bugs') pool = bugFindings;
          else if (selectedCategory === 'other') pool = otherFindings;

          if (pool.length === 0) {
            output.print('\n' + formatStatusIndicator({ status: 'warning', label: `No findings under category: ${selectedCategory}\n` }));
            continue;
          }

          const findingOptions = pool.slice(0, 15).map((f, idx) => ({
            label: `[${f.severity}] ${path.basename(f.file)}${f.line ? `:${f.line}` : ''} — ${f.rule || f.message.slice(0, 35)}`,
            value: String(idx),
            badge: f.severity,
            description: `${f.file}${f.line ? `:${f.line}` : ''} · ${f.message}`,
          }));

          findingOptions.push({
            label: '← Cancel',
            value: 'cancel',
            description: 'Return to menu',
          });

          const chosenIdxStr = await Select({
            label: 'Select specific flaw to correct:',
            options: findingOptions,
            defaultIndex: 0,
          });

          if (chosenIdxStr === 'cancel') {
            continue;
          }

          const targetFinding = pool[parseInt(chosenIdxStr, 10)];
          if (targetFinding) {
            output.print('\n' + formatStatusIndicator({ status: 'online', label: 'Generating code improvement...' }));
            const fix = await fixer.generateFix(parsed.projectPath, targetFinding, {
              aiClient,
              noAi: currentNoAi,
              preferredModel: currentModel,
              onModelSwitch: ({ failedModel, nextModel, error, isTokenExpire }) => {
                let reason = 'Model error';
                if (/free-models-per-day/i.test(error || '')) {
                  reason = 'Free daily account limit reached on OpenRouter';
                } else if (/use this slug instead/i.test(error || '')) {
                  reason = 'Free slug retired by OpenRouter, using standard model';
                } else if (/timed out/i.test(error || '')) {
                  reason = 'Request timed out';
                } else if (isTokenExpire) {
                  reason = 'Token limit or quota exhausted';
                }
                output.print(`  ${theme.colors.yellow('⚡')} ${reason} on ${theme.colors.gray(failedModel)} → Switched to ${theme.colors.cyan(nextModel)}`);
              },
            });

            if (!fix || fix.error) {
              output.printError(`Cannot auto-fix: ${fix?.error || 'no fix rule available for this finding'}\n`);
              continue;
            }

            output.print('');
            output.print(fixer.formatDiffPreview(targetFinding, fix));
            output.print('');

            const confirmAction = await Select({
              label: 'Apply this improvement to file?',
              options: [
                {
                  label: 'Yes, apply fix to file',
                  value: 'confirm',
                  badge: 'APPLY',
                  description: `Write changes to ${targetFinding.file}`,
                },
                {
                  label: 'No, skip / cancel',
                  value: 'skip',
                  description: 'Keep original code unchanged',
                },
              ],
              defaultIndex: 0,
            });

            if (confirmAction === 'confirm') {
              const applyRes = fixer.applyFixToFile(parsed.projectPath, targetFinding, fix);
              if (applyRes.success) {
                output.print('\n' + formatStatusIndicator({
                  status: 'online',
                  label: `Successfully updated ${theme.colors.cyan(targetFinding.file)}${targetFinding.line ? `:${targetFinding.line}` : ''}\n`,
                }));
                output.print(theme.colors.gray('Re-initiating scan to verify fix...\n'));
              } else {
                output.printError(`Failed to apply fix: ${applyRes.error}\n`);
              }
            }
          }
          continue;
        }
      }

      if (action === 'ai_security_suggestions') {
        if (currentNoAi || currentModel === 'none') {
          output.print('\n' + formatStatusIndicator({
            status: 'warning',
            label: 'Security suggestions are generated by AI models only. AI analysis is currently disabled.',
          }));
          const enableAi = await Select({
            label: 'Would you like to select an AI model to generate security suggestions?',
            options: [
              { label: 'Yes, select an AI model now', value: 'switch' },
              { label: 'No, return to menu', value: 'cancel' },
            ],
            defaultIndex: 0,
          });
          if (enableAi === 'switch') {
            const chosenModel = await Select({
              label: 'Select AI Model for CodeSentry:',
              options: AI_MODEL_OPTIONS.filter(m => m.value !== 'none'),
              defaultIndex: 0,
            });
            if (chosenModel) {
              currentNoAi = false;
              currentModel = chosenModel;
              auth.saveGlobalConfig({ openrouter_model: chosenModel });
            } else {
              continue;
            }
          } else {
            continue;
          }
        }

        output.print('\n' + formatStatusIndicator({
          status: 'online',
          label: `Consulting AI model (${theme.colors.cyan(currentModel)}) for proactive security hardening...`,
        }));

        try {
          const aiResult = await enhancer.queryAISecuritySuggestions(parsed.projectPath, {
            model: currentModel,
            apiKey: process.env.OPENROUTER_API_KEY,
          });

          output.print('');
          output.print(theme.card([
            `${theme.colors.brightWhite(theme.bold('AI Security Architecture Assessment'))} ${theme.colors.gray(`— ${aiResult.model}`)}`,
            theme.colors.darkGray('─'.repeat(68)),
            theme.colors.gray(aiResult.summary),
          ], {
            title: theme.colors.cyan(theme.bold('AI SECURITY ADVISORY')),
            rightTitle: theme.colors.green('Zero Vulnerabilities'),
            width: 72,
          }));
          output.print('');

          const total = aiResult.suggestions.length;
          for (let i = 0; i < total; i++) {
            output.print(enhancer.formatAISuggestionCard(aiResult.suggestions[i], i, total, aiResult.model));
            output.print('');
          }

          const postAiAction = await Select({
            label: 'AI Security Hardening Suggestions generated. What next?',
            options: [
              {
                label: 'Save AI Security Suggestions to AI-SECURITY-SUGGESTIONS.md',
                value: 'save_md',
                badge: 'EXPORT',
                description: 'Write complete AI hardening guide to project root',
              },
              {
                label: 'Return to Main Menu',
                value: 'menu',
                description: 'Continue audit session',
              },
            ],
            defaultIndex: 0,
          });

          if (postAiAction === 'save_md') {
            const savedPath = enhancer.exportAISuggestionsToMarkdown(parsed.projectPath, aiResult);
            const relSaved = path.relative(process.cwd(), savedPath) || savedPath;
            output.print('\n' + formatStatusIndicator({
              status: 'online',
              label: `Saved AI Security Suggestions to ${theme.colors.cyan(relSaved)}`,
            }) + '\n');
          }
        } catch (aiErr) {
          output.printError(`\nFailed to query AI model: ${aiErr.message}\n`);
        }

        continue;
      }

      if (action === 'open_report' && lastReportPath) {
        try {
          const { exec } = require('node:child_process');
          const openCmd = process.platform === 'win32'
            ? `start "" "${lastReportPath}"`
            : process.platform === 'darwin'
            ? `open "${lastReportPath}"`
            : `xdg-open "${lastReportPath}"`;
          exec(openCmd);
          output.print(theme.colors.green(`\n✔ Opened ${lastReportPath} in editor.\n`));
        } catch (openErr) {
          output.print(theme.colors.yellow(`\nCould not open editor automatically: ${openErr.message}\n`));
        }
        continue;
      }

      if (action === 'switch_model') {
        const chosenModel = await Select({
          label: 'Select AI Model for CodeSentry:',
          options: AI_MODEL_OPTIONS,
          defaultIndex: Math.max(0, AI_MODEL_OPTIONS.findIndex(m => m.value === currentModel)),
        });

        if (chosenModel) {
          auth.saveGlobalConfig({ openrouter_model: chosenModel });
          if (chosenModel === 'none') {
            currentNoAi = true;
            currentModel = 'none';
            output.print('\n' + formatStatusIndicator({ status: 'warning', label: 'AI analysis disabled. Switching to static inspection only.' }));
          } else {
            currentNoAi = false;
            currentModel = chosenModel;
            output.print('\n' + formatStatusIndicator({ status: 'online', label: `AI model toggled to: ${theme.colors.cyan(chosenModel)}` }));
          }
          output.print(theme.colors.gray('Re-initiating codebase inspection...\n'));
        }
      } else if (action === 'rescan') {
        output.print(theme.colors.gray('Re-initiating codebase inspection...\n'));
      } else if (action === 'exit') {
        output.print('\n' + theme.colors.cyan('◆') + ' ' + theme.colors.white('CodeSentry session closed.'));
        process.exit(0);
      }
    }
  }
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Unhandled exception:', err.message);
  process.exit(2);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message || err);
  process.exit(2);
});

main();