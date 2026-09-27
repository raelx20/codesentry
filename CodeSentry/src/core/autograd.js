/**
 * AutoGrad: AI-Native Risk Grading, Trend Telemetry & Self-Learning Offline Memory Bank
 *
 * Provides:
 * 1. Continuous Risk Grading (A+, A, B, C, D, F) with multi-category weighting.
 * 2. Historical Trend Telemetry (tracks score delta over consecutive scans).
 * 3. Lightweight Self-Learning Memory: Remembers previously resolved/repaired
 *    patterns offline so identical or similar flaws can be solved with 0ms latency
 *    and zero API calls.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Default config directory in user profile
const GLOBAL_DIR = path.join(os.homedir(), '.codesentry');
const MEMORY_FILE = path.join(GLOBAL_DIR, 'autograd-memory.json');
const HISTORY_FILE = path.join(GLOBAL_DIR, 'autograd-history.json');

// Built-in seed patterns for instant offline resolution
const SEED_LEARNED_PATTERNS = [
  {
    id: 'loose-equality',
    ruleId: 'loose-equality',
    category: 'bugs',
    description: 'Replace loose equality with strict equality',
    matcher: /([a-zA-Z0-9_$.]+)\s*==\s*([a-zA-Z0-9_$.'"]+)/,
    transformer: (line) => line.replace(/==(?!=)/g, '==='),
    explanation: 'Automatically converted loose equality (==) to type-safe strict equality (===) from learned pattern.',
    successCount: 15,
  },
  {
    id: 'loose-inequality',
    ruleId: 'loose-inequality',
    category: 'bugs',
    description: 'Replace loose inequality with strict inequality',
    matcher: /([a-zA-Z0-9_$.]+)\s*!=\s*([a-zA-Z0-9_$.'"]+)/,
    transformer: (line) => line.replace(/!=(?!=)/g, '!=='),
    explanation: 'Automatically converted loose inequality (!=) to strict inequality (!==) from learned pattern.',
    successCount: 12,
  },
  {
    id: 'hardcoded-jwt-secret',
    ruleId: 'hardcoded-secret',
    category: 'security',
    description: 'Extract hardcoded secret to environment variable',
    matcher: /jwt\.sign\([^,]+,\s*['"][^'"]+['"]/,
    transformer: (line) => line.replace(/,\s*['"][^'"]+['"]/, ', process.env.JWT_SECRET || ""'),
    explanation: 'Replaced hardcoded token secret with environment variable configuration.',
    successCount: 9,
  },
  {
    id: 'sqli-string-concat',
    ruleId: 'sql-injection',
    category: 'security',
    description: 'Parameterize concatenated SQL query string',
    matcher: /db\.query\(\s*["']SELECT .+ WHERE \w+\s*=\s*['"]\s*\+\s*([a-zA-Z0-9_$.]+)/,
    transformer: (line) => {
      return line.replace(
        /db\.query\(\s*(["']SELECT .+ WHERE \w+\s*=\s*)['"]\s*\+\s*([a-zA-Z0-9_$.]+)\s*\)/,
        'db.query($1$1", [$2])'
      );
    },
    explanation: 'Converted string concatenation in SQL statement into a parameterized query placeholder.',
    successCount: 8,
  },
  {
    id: 'py-open-resource-leak',
    ruleId: 'resource-leak',
    category: 'resources',
    description: 'Wrap raw file open in with-context manager',
    matcher: /([a-zA-Z0-9_]+)\s*=\s*open\(([^)]+)\)/,
    transformer: (line) => {
      const match = line.match(/([a-zA-Z0-9_]+)\s*=\s*open\(([^)]+)\)/);
      if (!match) return line;
      const indent = line.match(/^\s*/)[0];
      return `${indent}with open(${match[2]}) as ${match[1]}:`;
    },
    explanation: 'Wrapped file descriptor allocation inside a context manager (`with open(...)`) to prevent resource leaks.',
    successCount: 11,
  },
];

class AutoGradEngine {
  constructor() {
    this._ensureStorage();
    this.memory = this._loadMemory();
    this.history = this._loadHistory();
  }

  _ensureStorage() {
    try {
      if (!fs.existsSync(GLOBAL_DIR)) {
        fs.mkdirSync(GLOBAL_DIR, { recursive: true });
      }
    } catch {
      // Fallback silently if home directory is restricted
    }
  }

  _loadMemory() {
    // Always start with built-in seed patterns
    const memory = SEED_LEARNED_PATTERNS.map((seed) => ({ ...seed }));

    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.patterns)) {
          for (const item of parsed.patterns) {
            const seedIdx = memory.findIndex((s) => s.id === item.id);
            if (seedIdx !== -1) {
              if (item.successCount) memory[seedIdx].successCount = item.successCount;
              if (item.lastUsed) memory[seedIdx].lastUsed = item.lastUsed;
            } else if (item.signature) {
              const signature = item.signature;
              const replacement = item.replacement || '';
              memory.push({
                ...item,
                matcher: new RegExp(signature),
                transformer: (line) => line.replace(new RegExp(signature), replacement),
              });
            }
          }
        }
      }
    } catch {
      // Fallback cleanly to seeds on any parse error
    }

    return memory;
  }

  _saveMemory() {
    try {
      this._ensureStorage();
      const serializable = this.memory.map((p) => ({
        id: p.id,
        ruleId: p.ruleId,
        category: p.category,
        description: p.description,
        signature: p.signature || (p.matcher ? p.matcher.source : null),
        replacement: p.replacement || null,
        explanation: p.explanation,
        successCount: p.successCount || 1,
        lastUsed: p.lastUsed || new Date().toISOString(),
      }));
      fs.writeFileSync(MEMORY_FILE, JSON.stringify({ version: '1.0.0', patterns: serializable }, null, 2), 'utf8');
    } catch {
      // Ignore write errors in read-only environments
    }
  }

  _loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // Fallback
    }
    return { scans: [] };
  }

  _saveHistory() {
    try {
      this._ensureStorage();
      // Keep last 50 scans
      if (this.history.scans.length > 50) {
        this.history.scans = this.history.scans.slice(-50);
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2), 'utf8');
    } catch {
      // Ignore
    }
  }

  /**
   * Calculates overall risk score, letter grade, and trend telemetry
   */
  evaluate(findings = [], metadata = {}) {
    const totalFindings = findings.length;
    let penalty = 0;

    const breakdown = {
      security: { count: 0, penalty: 0 },
      bugs: { count: 0, penalty: 0 },
      efficiency: { count: 0, penalty: 0 },
      resources: { count: 0, penalty: 0 },
      modelshield: { count: 0, penalty: 0 },
      deployguard: { count: 0, penalty: 0 },
    };

    for (const f of findings) {
      let p = 1;
      const sev = (f.severity || '').toUpperCase();
      if (sev === 'BLOCKER') p = 25;
      else if (sev === 'HIGH') p = 12;
      else if (sev === 'MEDIUM') p = 5;
      else if (sev === 'LOW') p = 1;

      penalty += p;

      const cat = (f.category || 'bugs').toLowerCase();
      if (breakdown[cat]) {
        breakdown[cat].count++;
        breakdown[cat].penalty += p;
      }
    }

    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

    let grade = 'F';
    if (score >= 95) grade = 'A+';
    else if (score >= 88) grade = 'A';
    else if (score >= 78) grade = 'B';
    else if (score >= 65) grade = 'C';
    else if (score >= 45) grade = 'D';

    // Calculate historical trend
    const projectKey = metadata.targetPath || metadata.projectPath || 'default';
    const pastScans = (this.history.scans || []).filter((s) => s.project === projectKey);
    let trend = null;

    if (pastScans.length > 0) {
      const prev = pastScans[pastScans.length - 1];
      const delta = score - prev.score;
      trend = {
        previousScore: prev.score,
        previousGrade: prev.grade,
        delta,
        direction: delta > 0 ? 'improved' : delta < 0 ? 'degraded' : 'unchanged',
        symbol: delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : '■ 0',
      };
    } else {
      trend = {
        previousScore: score,
        previousGrade: grade,
        delta: 0,
        direction: 'baseline',
        symbol: '● baseline',
      };
    }

    // Record scan in history
    this.history.scans.push({
      project: projectKey,
      timestamp: new Date().toISOString(),
      score,
      grade,
      findingsCount: totalFindings,
    });
    this._saveHistory();

    // Check offline resolvable findings
    const resolvableFindings = [];
    for (const finding of findings) {
      const match = this.matchLearnedFix(finding);
      if (match) {
        finding.autogradLearned = true;
        finding.offlineResolvable = true;
        finding.learnedFix = match;
        resolvableFindings.push(finding);
      }
    }

    return {
      score,
      grade,
      trend,
      breakdown,
      offlineResolvableCount: resolvableFindings.length,
      resolvableFindings,
      summary: `AutoGrad Risk Grade: ${grade} (${score}/100) ${trend.symbol}`,
    };
  }

  /**
   * Matches a finding against learned offline patterns
   */
  matchLearnedFix(finding) {
    const ruleId = (finding.ruleId || '').toLowerCase();
    const message = (finding.message || '').toLowerCase();
    const codeSnippet = finding.codeSnippet || finding.snippet || '';

    for (const pattern of this.memory) {
      // Rule match or category match
      const ruleMatches = pattern.ruleId && ruleId.includes(pattern.ruleId);
      const catMatches = pattern.category && pattern.category === finding.category;

      if (!ruleMatches && !catMatches) continue;

      // Regex / signature test
      if (pattern.matcher && codeSnippet) {
        if (pattern.matcher.test(codeSnippet)) {
          let proposedPatch = null;
          if (typeof pattern.transformer === 'function') {
            try {
              proposedPatch = pattern.transformer(codeSnippet);
            } catch {
              proposedPatch = null;
            }
          }
          return {
            patternId: pattern.id,
            description: pattern.description,
            explanation: pattern.explanation,
            proposedPatch,
            successCount: pattern.successCount || 1,
          };
        }
      } else if (ruleMatches) {
        return {
          patternId: pattern.id,
          description: pattern.description,
          explanation: pattern.explanation,
          proposedPatch: null,
          successCount: pattern.successCount || 1,
        };
      }
    }
    return null;
  }

  /**
   * Learns from a user-approved fix to enrich offline memory
   */
  learnFromFix(finding, originalCode, fixedCode) {
    if (!finding || !originalCode || !fixedCode || originalCode === fixedCode) {
      return false;
    }

    const patternId = `learned-${finding.ruleId || finding.category}-${crypto.randomBytes(3).toString('hex')}`;
    const escapedOrig = originalCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const newPattern = {
      id: patternId,
      ruleId: finding.ruleId || 'custom-fix',
      category: finding.category || 'bugs',
      description: `AutoGrad learned fix for ${finding.ruleId || finding.category}`,
      signature: escapedOrig,
      replacement: fixedCode.trim(),
      matcher: new RegExp(escapedOrig),
      transformer: (line) => line.replace(originalCode.trim(), fixedCode.trim()),
      explanation: `Self-learned resolution remembered from verified fix on ${new Date().toLocaleDateString()}.`,
      successCount: 1,
      lastUsed: new Date().toISOString(),
    };

    // Check if an existing pattern already covers this
    const existingIndex = this.memory.findIndex(
      (p) => p.ruleId === newPattern.ruleId && p.signature === newPattern.signature
    );

    if (existingIndex >= 0) {
      this.memory[existingIndex].successCount = (this.memory[existingIndex].successCount || 1) + 1;
      this.memory[existingIndex].lastUsed = new Date().toISOString();
    } else {
      this.memory.push(newPattern);
    }

    this._saveMemory();
    return true;
  }
}

// Singleton export
const defaultEngine = new AutoGradEngine();

module.exports = {
  AutoGradEngine,
  calculateAutoGrad: (findings, metadata) => defaultEngine.evaluate(findings, metadata),
  matchLearnedFix: (finding) => defaultEngine.matchLearnedFix(finding),
  learnFromFix: (finding, orig, fixed) => defaultEngine.learnFromFix(finding, orig, fixed),
  getAutoGradEngine: () => defaultEngine,
};
