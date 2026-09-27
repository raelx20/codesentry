/**
 * CodeSentry Scan Result Formatter
 * Terminal Design System & Dark Card Typography
 */

'use strict';

const path = require('node:path');
const { SEVERITIES } = require('../findings/schema');
const {
  isColorSupported,
  colors,
  bold,
  dim,
  center,
  pill,
  severityBadge,
  categoryBadge,
  getSeverityColor,
  card,
  progressBar,
  getCodeSnippet,
} = require('./theme');

class ScanResultFormatter {
  constructor(options = {}) {
    this.options = options;
  }

  formatSummary(result) {
    const { project, filesAnalyzed, languages, aggregation, score, verdict } = result;

    if (!isColorSupported) {
      const lines = [];
      lines.push(`Project: ${project.name}`);
      lines.push(`Path: ${project.path}`);
      lines.push(`Files analyzed: ${filesAnalyzed}`);
      lines.push(`Languages: ${languages.join(', ') || 'none detected'}`);
      lines.push('');
      lines.push('Analysis Summary:');
      lines.push(`  Total findings: ${aggregation.total}`);
      lines.push('');
      lines.push('By Category:');
      for (const [category, count] of Object.entries(aggregation.byCategory)) {
        lines.push(`  ${this.capitalizeFirst(category)}: ${count}`);
      }
      lines.push('');
      lines.push('By Severity:');
      for (const severity of SEVERITIES) {
        const count = aggregation.bySeverity[severity] || 0;
        if (count > 0) {
          lines.push(`  ${severity}: ${count}`);
        }
      }
      lines.push('');
      lines.push(`Score: ${score.value}/${score.max}`);
      lines.push(`Verdict: ${verdict.status} — ${verdict.message}`);
      return lines;
    }

    // ── CodeSentry Dark Summary Card ───────────────────────────────────────────
    const cardLines = [];

    // Verdict & Health gauge
    const verdictPill = pill(verdict.status, verdict.status);
    const scoreGauge = progressBar(score.value, score.max, 22);
    cardLines.push(`${verdictPill}  ${scoreGauge}   ${colors.gray(verdict.message)}`);
    cardLines.push('');

    // Target metrics
    const langStr = languages.join(', ') || 'none';
    cardLines.push(
      `${colors.gray('Target:')} ${colors.brightWhite(project.name)}   ` +
      `${colors.gray('Files:')} ${colors.white(String(filesAnalyzed))}   ` +
      `${colors.gray('Languages:')} ${colors.white(langStr)}   ` +
      `${colors.gray('Total:')} ${bold(colors.cyan(String(aggregation.total)))}`
    );
    cardLines.push('');

    // Findings breakdown pills
    const sevPills = [];
    for (const sev of SEVERITIES) {
      const count = aggregation.bySeverity[sev] || 0;
      if (count > 0) {
        sevPills.push(pill(`${count} ${sev}`, sev));
      }
    }

    const catPills = [];
    for (const [cat, count] of Object.entries(aggregation.byCategory)) {
      catPills.push(pill(`${count} ${cat.toUpperCase()}`, cat));
    }

    if (sevPills.length > 0) {
      cardLines.push(`${colors.gray('Severities:')}  ${sevPills.join('  ')}`);
    }
    if (catPills.length > 0) {
      cardLines.push(`${colors.gray('Categories:')}  ${catPills.join('  ')}`);
    }

    // AutoGrad Risk Intelligence & Self-Learning Telemetry
    if (result.autograd) {
      cardLines.push('');
      const ag = result.autograd;
      const trendStr = ag.trend ? colors.cyan(ag.trend.symbol) : '';
      cardLines.push(
        `${colors.gray('AutoGrad:')} ${bold(colors.magenta(`Grade ${ag.grade}`))} (${colors.white(String(ag.score))}/100) ${trendStr}   ` +
        (ag.offlineResolvableCount > 0 ? bold(colors.green(`⚡ ${ag.offlineResolvableCount} Offline-Resolvable`)) : '')
      );
    }

    // DeployGuard Production Readiness Gate
    if (result.deployguard) {
      const dg = result.deployguard;
      const statusColor = dg.status === 'PASSED' ? colors.green : dg.status === 'WARNING' ? colors.yellow : colors.red;
      cardLines.push(
        `${colors.gray('DeployGuard:')} ${statusColor(bold(dg.status))} (Readiness: ${colors.white(String(dg.readinessScore))}%)   ` +
        `${colors.gray('Blockers:')} ${dg.metrics.blockers > 0 ? colors.red(bold(String(dg.metrics.blockers))) : colors.green('0')}`
      );
    }

    const renderedCard = card(cardLines, {
      title: colors.cyan(bold('SCAN SUMMARY')),
      rightTitle: colors.gray(`${aggregation.total} findings`),
      width: 76,
    });

    const outputCards = [renderedCard];

    // AttackGraph Exploitable Paths Card
    if (result.riskGraph && result.riskGraph.terminalOutput) {
      outputCards.push('');
      outputCards.push(result.riskGraph.terminalOutput);
    }

    return outputCards;
  }

  formatFindings(findings, options = {}) {
    const { limit = 10, showDetails = true } = options;

    if (!findings || findings.length === 0) {
      if (!isColorSupported) return ['No findings detected. Codebase clean.'];
      return [
        card([
          colors.green(bold('✔ Clean codebase — No vulnerabilities or issues detected!')),
          '',
          `${colors.cyan('🤖 AI Security Hardening Available:')}`,
          `  ${colors.gray('To receive custom, architecture-level security recommendations')}`,
          `  ${colors.gray('tailored to your stack, select')} ${colors.cyan(bold('Ask AI for Security Suggestions'))} ${colors.gray('below.')}`,
        ], {
          title: colors.green(bold('ALL CLEAR — SECURE BASELINE')),
          rightTitle: colors.cyan('AI Hardening Available'),
          width: 76,
        }),
      ];
    }

    const lines = [];
    const displayFindings = findings.slice(0, limit);

    for (const finding of displayFindings) {
      const rendered = this.formatFinding(finding, showDetails);
      if (Array.isArray(rendered)) {
        lines.push(...rendered);
      } else {
        lines.push(rendered);
      }
    }

    if (findings.length > limit) {
      const moreMsg = center(colors.gray(`... and ${findings.length - limit} more findings (see generated report for full audit)`));
      lines.push(moreMsg);
    }

    return lines;
  }

  formatFinding(finding, showDetails = true) {
    if (!isColorSupported) {
      const lines = [];
      const severityTag = `[${finding.severity}]`;
      const categoryTag = finding.category.toUpperCase();
      const location = `${finding.file}:${finding.line || '?'}`;

      lines.push(`${severityTag} ${categoryTag}`);
      lines.push(location);
      lines.push('');

      if (showDetails) {
        if (finding.rule) lines.push(`Rule: ${finding.rule}`);
        if (finding.tool) lines.push(`Detected by: ${this.capitalizeFirst(finding.tool)}`);
        lines.push('');
        lines.push(finding.message);

        if (finding.suggestedFix) {
          lines.push('');
          lines.push('Suggested fix:');
          lines.push(`  ${finding.suggestedFix}`);
        }

        if (finding.aiAnalysis) {
          lines.push('');
          lines.push('AI Analysis:');
          if (finding.aiAnalysis.model) lines.push(`  Model: ${finding.aiAnalysis.model}`);
          if (finding.aiAnalysis.confidence) lines.push(`  Confidence: ${Math.round(finding.aiAnalysis.confidence * 100)}%`);
          if (finding.aiAnalysis.falsePositiveProbability) lines.push(`  False-positive probability: ${Math.round(finding.aiAnalysis.falsePositiveProbability * 100)}%`);
          if (finding.aiAnalysis.explanation) lines.push(`  Explanation: ${finding.aiAnalysis.explanation}`);
          if (finding.aiAnalysis.impact) lines.push(`  Impact: ${finding.aiAnalysis.impact}`);
          if (finding.aiAnalysis.suggestedFix) lines.push(`  Recommended fix: ${finding.aiAnalysis.suggestedFix}`);
        }
      }
      return lines;
    }

    // ── CodeSentry Dark Inspection Card ─────────────────────────────────────────
    const cardLines = [];
    const sevColor = getSeverityColor(finding.severity);

    // Rule & Tool metadata line
    const toolName = finding.tool ? this.capitalizeFirst(finding.tool) : 'Static Analyzer';
    const ruleStr = finding.rule ? `${colors.gray('rule')} ${colors.cyan(finding.rule)}` : '';
    const toolStr = `${colors.gray('engine')} ${colors.white(toolName)}`;
    cardLines.push(`${toolStr}   ${ruleStr}`);
    cardLines.push('');

    // Message line
    cardLines.push(bold(colors.white(finding.message)));

    // Code Context Snippet (Diff-style view)
    if (finding.line && finding.file) {
      const snippet = getCodeSnippet(finding.file, finding.line, 2);
      if (snippet && snippet.length > 0) {
        cardLines.push('');
        cardLines.push(colors.gray('  Source Context:'));
        for (const s of snippet) {
          const numStr = String(s.lineNum).padStart(4, ' ');
          if (s.isTarget) {
            const marker = colors.orange('>');
            const lineNum = colors.orange(numStr);
            const lineText = colors.brightWhite(s.text);
            cardLines.push(`  ${marker} ${lineNum} ${colors.darkGray('│')}  ${lineText}`);
          } else {
            const lineNum = colors.gray(numStr);
            const lineText = colors.lightGray(s.text);
            cardLines.push(`    ${lineNum} ${colors.darkGray('│')}  ${lineText}`);
          }
        }
      }
    }

    // AI Triage Callout Card
    if (finding.aiAnalysis) {
      const ai = finding.aiAnalysis;
      cardLines.push('');
      const modelTag = ai.model ? ` · ${ai.model}` : '';
      cardLines.push(`${colors.cyan('■ AI Triage')}${colors.gray(modelTag)}`);

      const confPercent = ai.confidence != null ? Math.round(ai.confidence * 100) : null;
      const fpPercent = ai.falsePositiveProbability != null ? Math.round(ai.falsePositiveProbability * 100) : null;

      const metrics = [];
      if (confPercent != null) metrics.push(`${colors.gray('Confidence:')} ${colors.green(`${confPercent}%`)}`);
      if (fpPercent != null) metrics.push(`${colors.gray('FP Risk:')} ${fpPercent > 30 ? colors.yellow(`${fpPercent}%`) : colors.green(`${fpPercent}%`)}`);

      if (metrics.length > 0) {
        cardLines.push(`  ${metrics.join('   ')}`);
      }

      if (ai.explanation) {
        cardLines.push(`  ${colors.gray('Why:')}  ${colors.white(ai.explanation)}`);
      }
      if (ai.impact) {
        cardLines.push(`  ${colors.gray('Risk:')} ${colors.orange(ai.impact)}`);
      }
      if (ai.suggestedFix) {
        cardLines.push(`  ${colors.gray('Fix:')}  ${colors.cyan(ai.suggestedFix)}`);
      }
    } else if (finding.suggestedFix) {
      cardLines.push('');
      cardLines.push(`${colors.gray('Suggested Fix:')} ${colors.cyan(finding.suggestedFix)}`);
    }

    // File location badge on the right
    const relFile = path.basename(finding.file);
    const locTag = `${relFile}:${finding.line || '?'}`;
    const headerTitle = `${severityBadge(finding.severity)} ${categoryBadge(finding.category)}`;

    const renderedCard = card(cardLines, {
      accentColor: sevColor,
      title: headerTitle,
      rightTitle: colors.gray(locTag),
      width: 76,
    });

    return [renderedCard, ''];
  }

  formatJSON(result) {
    return JSON.stringify(result, null, 2);
  }

  capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

function createFormatter(options = {}) {
  return new ScanResultFormatter(options);
}

module.exports = {
  ScanResultFormatter,
  createFormatter,
};