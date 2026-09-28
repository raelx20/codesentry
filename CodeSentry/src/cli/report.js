/**
 * CodeSentry Report Generator
 *
 * Produces a well-organized Markdown report from scan results.
 * The report groups findings by severity and file, highlights AI insights,
 * and includes an executive summary with actionable remediation guidance.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ── Severity ordering & display ──────────────────────────────────────────────
const SEVERITY_ORDER = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SEVERITY_EMOJI = {
  BLOCKER: '🔴',
  HIGH:    '🟠',
  MEDIUM:  '🟡',
  LOW:     '🔵',
  INFO:    'ℹ️',
};
const CATEGORY_EMOJI = {
  security:   '🔒',
  bugs:       '🐛',
  efficiency: '⚡',
  resources:  '💧',
};

class ReportGenerator {
  constructor(options = {}) {
    this.outputDir = options.outputDir || process.cwd();
    this.filename  = options.filename  || null; // auto-generated if null
  }

  /**
   * Generate and write a Markdown report from scan results.
   * Returns the absolute path to the written report file.
   */
  generate(result) {
    const md = this._buildMarkdown(result);
    const reportPath = this._resolveOutputPath(result);

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, md, 'utf-8');

    return reportPath;
  }

  // ── Markdown assembly ──────────────────────────────────────────────────────

  _buildMarkdown(result) {
    const sections = [];

    sections.push(this._header(result));
    sections.push(this._executiveSummary(result));
    sections.push(this._scoreCard(result));
    sections.push(this._autogradSection(result));
    sections.push(this._deployguardSection(result));
    sections.push(this._attackGraphSection(result));
    sections.push(this._severityBreakdown(result));
    sections.push(this._categoryBreakdown(result));
    sections.push(this._findingsByFile(result));
    sections.push(this._topRisks(result));
    sections.push(this._aiInsightsSummary(result));
    sections.push(this._remediationPlan(result));
    sections.push(this._footer(result));

    return sections.filter(Boolean).join('\n\n---\n\n');
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  _header(result) {
    const lines = [];
    lines.push(`# 🛡️ CodeSentry Analysis Report`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **Project** | \`${result.project.name}\` |`);
    lines.push(`| **Path** | \`${result.project.path}\` |`);
    lines.push(`| **Files Analyzed** | ${result.filesAnalyzed} |`);
    lines.push(`| **Languages** | ${result.languages.join(', ') || 'none detected'} |`);
    lines.push(`| **Scan Date** | ${new Date(result.metadata.timestamp).toLocaleString()} |`);
    lines.push(`| **Duration** | ${(result.metadata.duration / 1000).toFixed(1)}s |`);
    return lines.join('\n');
  }

  // ── Executive summary ──────────────────────────────────────────────────────

  _executiveSummary(result) {
    const { aggregation, verdict, score } = result;
    const lines = [];

    lines.push(`## 📋 Executive Summary`);
    lines.push('');

    const statusEmoji = verdict.status === 'PASS' ? '✅' : verdict.status === 'FAIL' ? '❌' : '⚠️';
    lines.push(`**Verdict**: ${statusEmoji} **${verdict.status}** — ${verdict.message}`);
    lines.push('');
    lines.push(`**Score**: **${score.value}** / ${score.max}`);
    lines.push('');
    lines.push(`**Total Findings**: ${aggregation.total}`);
    lines.push('');

    // Quick severity stats
    const criticalCount = (aggregation.bySeverity.BLOCKER || 0) + (aggregation.bySeverity.HIGH || 0);
    if (criticalCount > 0) {
      lines.push(`> ⚠️ **${criticalCount} critical/high-severity issues** require immediate attention.`);
    } else {
      lines.push(`> ✅ No critical or high-severity issues detected.`);
    }

    return lines.join('\n');
  }

  // ── Score card ─────────────────────────────────────────────────────────────

  _scoreCard(result) {
    const { score } = result;
    const lines = [];

    lines.push(`## 📊 Score Card`);
    lines.push('');

    // Visual progress bar
    const filled = Math.round(score.value / score.max * 20);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    lines.push(`\`${bar}\` **${score.value}/${score.max}**`);
    lines.push('');

    if (score.breakdown) {
      lines.push(`| Severity | Penalty |`);
      lines.push(`|----------|---------|`);
      for (const [sev, pen] of Object.entries(score.breakdown)) {
        lines.push(`| ${SEVERITY_EMOJI[sev] || ''} ${sev} | -${pen} |`);
      }
    }

    return lines.join('\n');
  }

  // ── AutoGrad Risk Intelligence ─────────────────────────────────────────────

  _autogradSection(result) {
    if (!result.autograd) return null;
    const ag = result.autograd;
    const lines = [];
    lines.push(`## 🧠 AutoGrad Risk Intelligence & Self-Learning Telemetry`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| **AutoGrad Grade** | **${ag.grade}** |`);
    lines.push(`| **Risk Score** | ${ag.score} / 100 |`);
    lines.push(`| **Trend** | ${ag.trend ? ag.trend.symbol + ' (' + ag.trend.direction + ')' : 'Baseline'} |`);
    lines.push(`| **Offline-Resolvable Flaws** | ${ag.offlineResolvableCount} issues can be solved immediately offline from learned memory |`);
    return lines.join('\n');
  }

  // ── DeployGuard Readiness ──────────────────────────────────────────────────

  _deployguardSection(result) {
    if (!result.deployguard) return null;
    const dg = result.deployguard;
    const lines = [];
    lines.push(`## 🚀 DeployGuard: Pre-Deployment & Readiness Gate`);
    lines.push('');
    lines.push(`**Gate Status**: \`${dg.status}\` — ${dg.message}`);
    lines.push('');
    lines.push(`**Readiness Score**: **${dg.readinessScore}%**`);
    lines.push('');
    lines.push(`| Infrastructure / Config Check | Status | Count |`);
    lines.push(`|---|---|---|`);
    lines.push(`| Deployment Blockers | ${dg.metrics.blockers > 0 ? '❌ BLOCKED' : '✅ CLEAN'} | ${dg.metrics.blockers} |`);
    lines.push(`| High Priority Risks | ${dg.metrics.high > 0 ? '⚠️ WARNING' : '✅ CLEAN'} | ${dg.metrics.high} |`);
    lines.push(`| Medium/Low Config Flaws | ℹ️ INFO | ${dg.metrics.medium + dg.metrics.low} |`);
    return lines.join('\n');
  }

  // ── Software Risk Graph & AttackGraph ──────────────────────────────────────

  _attackGraphSection(result) {
    if (!result.riskGraph) return null;
    const lines = [];
    lines.push(`## 🕸️ Software Risk Graph & Exploitable Attack Paths`);
    lines.push('');
    lines.push(`CodeTwin modeled **${result.riskGraph.summary.nodeCount} components** and correlated **${result.riskGraph.summary.attackPaths.length} attack path(s)** across codebase entrypoints and sinks.`);
    lines.push('');
    lines.push(result.riskGraph.mermaidOutput);
    return lines.join('\n');
  }

  // ── Severity breakdown ─────────────────────────────────────────────────────

  _severityBreakdown(result) {
    const { aggregation } = result;
    const lines = [];

    lines.push(`## 🎯 Findings by Severity`);
    lines.push('');
    lines.push(`| Severity | Count |`);
    lines.push(`|----------|-------|`);

    for (const sev of SEVERITY_ORDER) {
      const count = aggregation.bySeverity[sev] || 0;
      if (count > 0) {
        lines.push(`| ${SEVERITY_EMOJI[sev]} **${sev}** | ${count} |`);
      }
    }

    return lines.join('\n');
  }

  // ── Category breakdown ─────────────────────────────────────────────────────

  _categoryBreakdown(result) {
    const { aggregation } = result;
    const lines = [];

    lines.push(`## 📁 Findings by Category`);
    lines.push('');
    lines.push(`| Category | Count |`);
    lines.push(`|----------|-------|`);

    for (const [cat, count] of Object.entries(aggregation.byCategory)) {
      const emoji = CATEGORY_EMOJI[cat] || '📌';
      lines.push(`| ${emoji} **${cat.charAt(0).toUpperCase() + cat.slice(1)}** | ${count} |`);
    }

    return lines.join('\n');
  }

  // ── Findings grouped by file ───────────────────────────────────────────────

  _findingsByFile(result) {
    const { findings } = result;
    if (!findings || findings.length === 0) {
      return '## 📂 Findings by File\n\nNo findings detected. 🎉';
    }

    const lines = [];
    lines.push(`## 📂 Detailed Findings by File`);
    lines.push('');

    // Group by file
    const byFile = {};
    for (const f of findings) {
      const file = f.file || 'unknown';
      if (!byFile[file]) byFile[file] = [];
      byFile[file].push(f);
    }

    // Sort files by count of high-severity findings (descending)
    const sortedFiles = Object.entries(byFile).sort((a, b) => {
      const aHigh = a[1].filter(f => f.severity === 'HIGH' || f.severity === 'BLOCKER').length;
      const bHigh = b[1].filter(f => f.severity === 'HIGH' || f.severity === 'BLOCKER').length;
      return bHigh - aHigh;
    });

    for (const [file, fileFindings] of sortedFiles) {
      // Sort findings within file by severity then line
      fileFindings.sort((a, b) => {
        const ai = SEVERITY_ORDER.indexOf(a.severity);
        const bi = SEVERITY_ORDER.indexOf(b.severity);
        if (ai !== bi) return ai - bi;
        return (a.line || 0) - (b.line || 0);
      });

      lines.push(`### \`${file}\``);
      lines.push('');

      for (const finding of fileFindings) {
        const emoji = SEVERITY_EMOJI[finding.severity] || '';
        const lineRef = finding.line ? `:${finding.line}` : '';
        const ruleTag = finding.rule ? ` \`${finding.rule}\`` : '';
        const toolTag = finding.tool ? ` *(${finding.tool})*` : '';

        lines.push(`#### ${emoji} ${finding.severity}${ruleTag}${toolTag} — Line${lineRef}`);
        lines.push('');
        lines.push(`> ${finding.message}`);
        lines.push('');

        if (finding.suggestedFix) {
          lines.push(`**Fix**: ${finding.suggestedFix}`);
          lines.push('');
        }

        if (finding.aiAnalysis) {
          lines.push(`<details>`);
          lines.push(`<summary>🤖 AI Analysis (${finding.aiAnalysis.model || 'unknown model'})</summary>`);
          lines.push('');
          lines.push(`| Metric | Value |`);
          lines.push(`|--------|-------|`);
          if (finding.aiAnalysis.confidence != null) {
            lines.push(`| Confidence | ${Math.round(finding.aiAnalysis.confidence * 100)}% |`);
          }
          if (finding.aiAnalysis.falsePositiveProbability != null) {
            lines.push(`| False-Positive Probability | ${Math.round(finding.aiAnalysis.falsePositiveProbability * 100)}% |`);
          }
          lines.push('');
          if (finding.aiAnalysis.explanation) {
            lines.push(`**Explanation**: ${finding.aiAnalysis.explanation}`);
            lines.push('');
          }
          if (finding.aiAnalysis.impact) {
            lines.push(`**Impact**: ${finding.aiAnalysis.impact}`);
            lines.push('');
          }
          if (finding.aiAnalysis.suggestedFix) {
            lines.push(`**Recommended Fix**: ${finding.aiAnalysis.suggestedFix}`);
            lines.push('');
          }
          lines.push(`</details>`);
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  // ── Top risks (highest severity + highest confidence) ──────────────────────

  _topRisks(result) {
    const { findings } = result;
    if (!findings || findings.length === 0) return null;

    const lines = [];
    lines.push(`## 🚨 Top Risks`);
    lines.push('');

    // Find HIGH/BLOCKER findings with AI analysis, sorted by confidence
    const critical = findings
      .filter(f => (f.severity === 'HIGH' || f.severity === 'BLOCKER') && f.aiAnalysis)
      .sort((a, b) => (b.aiAnalysis.confidence || 0) - (a.aiAnalysis.confidence || 0))
      .slice(0, 5);

    if (critical.length === 0) {
      // Fall back to highest severity findings without AI
      const highSev = findings
        .filter(f => f.severity === 'HIGH' || f.severity === 'BLOCKER')
        .slice(0, 5);

      if (highSev.length === 0) {
        lines.push('No high-severity findings detected. ✅');
        return lines.join('\n');
      }

      lines.push(`| # | File | Line | Rule | Message |`);
      lines.push(`|---|------|------|------|---------|`);
      highSev.forEach((f, i) => {
        lines.push(`| ${i + 1} | \`${f.file}\` | ${f.line || '?'} | \`${f.rule || '-'}\` | ${f.message.substring(0, 80)} |`);
      });
      return lines.join('\n');
    }

    lines.push(`| # | File | Line | Rule | Confidence | Impact |`);
    lines.push(`|---|------|------|------|------------|--------|`);

    critical.forEach((f, i) => {
      const conf = Math.round((f.aiAnalysis.confidence || 0) * 100);
      const impact = (f.aiAnalysis.impact || f.message).substring(0, 60);
      lines.push(`| ${i + 1} | \`${f.file}\` | ${f.line || '?'} | \`${f.rule || '-'}\` | ${conf}% | ${impact} |`);
    });

    return lines.join('\n');
  }

  // ── AI Insights Summary ────────────────────────────────────────────────────

  _aiInsightsSummary(result) {
    const { findings } = result;
    const aiFindings = (findings || []).filter(f => f.aiAnalysis);

    if (aiFindings.length === 0) return null;

    const lines = [];
    lines.push(`## 🤖 AI Analysis Summary`);
    lines.push('');

    // Model usage stats
    const modelCounts = {};
    for (const f of aiFindings) {
      const model = f.aiAnalysis.model || 'unknown';
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    }

    lines.push(`**${aiFindings.length}** findings analyzed by AI across **${Object.keys(modelCounts).length}** model(s):`);
    lines.push('');
    for (const [model, count] of Object.entries(modelCounts)) {
      lines.push(`- \`${model}\`: ${count} finding(s)`);
    }
    lines.push('');

    // Confidence distribution
    const highConf  = aiFindings.filter(f => (f.aiAnalysis.confidence || 0) >= 0.8).length;
    const medConf   = aiFindings.filter(f => (f.aiAnalysis.confidence || 0) >= 0.5 && (f.aiAnalysis.confidence || 0) < 0.8).length;
    const lowConf   = aiFindings.filter(f => (f.aiAnalysis.confidence || 0) < 0.5).length;

    lines.push(`### Confidence Distribution`);
    lines.push('');
    lines.push(`| Confidence Level | Count |`);
    lines.push(`|------------------|-------|`);
    lines.push(`| 🟢 High (≥80%) | ${highConf} |`);
    lines.push(`| 🟡 Medium (50-79%) | ${medConf} |`);
    lines.push(`| 🔴 Low (<50%) | ${lowConf} |`);
    lines.push('');

    // False positive candidates
    const fpCandidates = aiFindings
      .filter(f => (f.aiAnalysis.falsePositiveProbability || 0) > 0.3)
      .sort((a, b) => (b.aiAnalysis.falsePositiveProbability || 0) - (a.aiAnalysis.falsePositiveProbability || 0));

    if (fpCandidates.length > 0) {
      lines.push(`### Likely False Positives`);
      lines.push('');
      lines.push(`The following findings have a **>30% false-positive probability** per AI assessment and may warrant manual review before acting:`);
      lines.push('');
      lines.push(`| File | Line | Rule | FP Probability |`);
      lines.push(`|------|------|------|----------------|`);
      for (const f of fpCandidates.slice(0, 10)) {
        const fp = Math.round((f.aiAnalysis.falsePositiveProbability || 0) * 100);
        lines.push(`| \`${f.file}\` | ${f.line || '?'} | \`${f.rule || '-'}\` | ${fp}% |`);
      }
    }

    return lines.join('\n');
  }

  // ── Remediation plan ───────────────────────────────────────────────────────

  _remediationPlan(result) {
    const { findings, aiSecuritySuggestions } = result;
    if (!findings || findings.length === 0) {
      if (aiSecuritySuggestions && aiSecuritySuggestions.length > 0) {
        const lines = [
          '## 🤖 AI Proactive Security Hardening Suggestions',
          '',
          `The codebase is clean. The following proactive hardening suggestions were generated by **${result.aiModel || 'OpenRouter AI'}**:`,
          '',
        ];
        for (const s of aiSecuritySuggestions) {
          lines.push(`### 🛡️ ${s.title || 'Security Recommendation'} [${s.priority || 'RECOMMENDED'}]`);
          lines.push('');
          lines.push(s.explanation || '');
          lines.push('');
          if (s.suggestedFix) {
            lines.push(`**Recommendation**: ${s.suggestedFix}`);
            lines.push('');
          }
          if (s.codeExample) {
            lines.push('```javascript');
            lines.push(s.codeExample);
            lines.push('```');
            lines.push('');
          }
        }
        return lines.join('\n');
      }

      return [
        '## 🤖 AI Proactive Security Hardening',
        '',
        'Your codebase is clean with **0 known vulnerabilities or flaws detected**! 🎉',
        '',
        '> **AI Hardening**: To generate architecture-level defense-in-depth suggestions from our AI models, run `codesentry scan .` and select **"Ask AI for Proactive Security Suggestions"** in the interactive session.',
      ].join('\n');
    }

    const lines = [];
    lines.push(`## 🔧 Remediation Plan`);
    lines.push('');
    lines.push(`Prioritized action items based on severity and AI confidence:`);
    lines.push('');

    // Group by severity, pick top items with fixes
    let itemNum = 0;
    for (const sev of ['BLOCKER', 'HIGH', 'MEDIUM']) {
      const sevFindings = findings.filter(f => f.severity === sev);
      if (sevFindings.length === 0) continue;

      lines.push(`### ${SEVERITY_EMOJI[sev]} ${sev} Priority`);
      lines.push('');

      // Deduplicate by rule to avoid repeating the same fix
      const seenRules = new Set();
      for (const f of sevFindings) {
        const key = `${f.rule || ''}-${f.file}`;
        if (seenRules.has(key)) continue;
        seenRules.add(key);
        itemNum++;

        const fix = f.aiAnalysis?.suggestedFix || f.suggestedFix || 'Manual review required';
        const loc = `\`${f.file}${f.line ? ':' + f.line : ''}\``;

        lines.push(`${itemNum}. **${loc}** — ${f.message.substring(0, 100)}`);
        lines.push(`   - **Fix**: ${fix}`);
        lines.push('');

        if (itemNum >= 20) break; // Cap at 20 items
      }
      if (itemNum >= 20) break;
    }

    return lines.join('\n');
  }

  // ── Footer ─────────────────────────────────────────────────────────────────

  _footer(result) {
    let pkgVersion = '0.2.0';
    try { pkgVersion = require('../../package.json').version; } catch {}
    const lines = [];
    lines.push(`## ℹ️ Report Metadata`);
    lines.push('');
    lines.push(`| Field | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Generated by | CodeSentry v${pkgVersion} |`);
    lines.push(`| Timestamp | ${result.metadata.timestamp} |`);
    lines.push(`| Duration | ${result.metadata.duration}ms |`);
    lines.push(`| AI Provider | OpenRouter |`);

    if (result.metadata.errors && result.metadata.errors.length > 0) {
      lines.push('');
      lines.push(`### ⚠️ Scan Warnings`);
      lines.push('');
      for (const err of result.metadata.errors) {
        lines.push(`- **${err.stage}**: ${err.message}`);
      }
    }

    if (result.metadata.analyzerWarnings && result.metadata.analyzerWarnings.length > 0) {
      lines.push('');
      lines.push(`### Analyzer Warnings`);
      lines.push('');
      for (const w of result.metadata.analyzerWarnings) {
        lines.push(`- **${w.tool}**: ${w.warning || w.error}`);
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*Report generated by [CodeSentry](https://github.com/codesentry/codesentry) — AI-powered code analysis.*');

    return lines.join('\n');
  }

  // ── Output path resolution ─────────────────────────────────────────────────

  _resolveOutputPath(result) {
    if (this.filename) {
      return path.resolve(this.outputDir, this.filename);
    }

    return path.resolve(this.outputDir, 'codesentry-report.md');
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

function createReportGenerator(options = {}) {
  return new ReportGenerator(options);
}

module.exports = {
  ReportGenerator,
  createReportGenerator,
};
