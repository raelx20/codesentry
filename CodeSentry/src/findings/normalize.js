const { createFinding } = require('./schema');

const SEVERITY_MAP = {
  'error': 'BLOCKER',
  'warning': 'HIGH',
  'info': 'LOW',
  'suggestion': 'LOW',
  2: 'BLOCKER',
  1: 'HIGH',
  0: 'LOW',
};

const BANDIT_SEVERITY_MAP = {
  'HIGH': 'HIGH',
  'MEDIUM': 'MEDIUM',
  'LOW': 'LOW',
};

const BANDIT_CONFIDENCE_MAP = {
  'HIGH': 'high',
  'MEDIUM': 'medium',
  'LOW': 'low',
};

const RUFF_SEVERITY_MAP = {
  'E': 'MEDIUM',
  'W': 'LOW',
  'F': 'HIGH',
  'C': 'LOW',
  'I': 'LOW',
  'N': 'LOW',
  'D': 'LOW',
  'S': 'HIGH',
  'B': 'MEDIUM',
  'A': 'MEDIUM',
  'T': 'HIGH',
  'U': 'MEDIUM',
};

function normalizeEslint(results) {
  if (!Array.isArray(results)) return [];
  const findings = [];
  for (const r of results) {
    if (r.severity === 0) continue;
    try {
      const severity = SEVERITY_MAP[r.severity] || SEVERITY_MAP[r.severityName?.toLowerCase()] || 'MEDIUM';
      const msgObj = r.message && typeof r.message === 'object' ? r.message : null;
      const message = msgObj?.message ? String(msgObj.message) : String(r.message || '');
      if (!message) continue;
      const file = r.filePath || r.file;
      if (!file) continue;
      findings.push(createFinding({
        tool: 'eslint',
        category: mapEslintCategory(r),
        severity,
        file,
        line: r.line ?? r.locations?.[0]?.start?.line ?? null,
        column: r.column ?? r.locations?.[0]?.start?.column ?? null,
        rule: r.ruleId || r.rule,
        message,
        suggestedFix: r.fix && typeof r.fix === 'string' ? r.fix : null,
      }));
    } catch {
      continue;
    }
  }
  return findings;
}

function mapEslintCategory(result) {
  const ruleId = (result.ruleId || result.rule || '').toLowerCase();
  if (ruleId.includes('no-unused') || ruleId.includes('no-undef') || ruleId.includes('no-unreachable')) return 'bug';
  if (ruleId.includes('no-eval') || ruleId.includes('no-implied') || ruleId.includes('security')) return 'vulnerability';
  if (ruleId.includes('complexity') || ruleId.includes('max-lines') || ruleId.includes('max-depth')) return 'performance';
  return 'code-quality';
}

function normalizeTypescript(diagnostics) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.map(d => {
    const severity = d.category === 'error' ? 'HIGH' : d.category === 'warning' ? 'MEDIUM' : 'LOW';
    const fileObj = d.file && typeof d.file === 'object' ? d.file : null;
    const file = fileObj?.fileName ?? d.file ?? 'unknown';
    return createFinding({
      tool: 'typescript',
      category: 'code-quality',
      severity,
      file,
      line: d.start?.line ?? d.line ?? null,
      column: d.start?.character ?? d.column ?? null,
      rule: `TS${d.code}`,
      message: d.messageText ?? d.message ?? '',
      suggestedFix: null,
    });
  });
}

function normalizeRuff(results) {
  if (!Array.isArray(results)) return [];
  return results.map(r => {
    const code = r.code || '';
    const prefix = code.charAt(0);
    const severity = RUFF_SEVERITY_MAP[prefix] || 'MEDIUM';
    return createFinding({
      tool: 'ruff',
      category: mapRuffCategory(prefix),
      severity,
      file: r.filename ?? r.file ?? 'unknown',
      line: r.location?.row ?? r.line ?? null,
      column: r.location?.column ?? r.column ?? null,
      rule: code,
      message: r.message ?? r.text ?? '',
      suggestedFix: r.fix && typeof r.fix === 'string' ? r.fix : null,
    });
  });
}

function mapRuffCategory(prefix) {
  if (prefix === 'S') return 'vulnerability';
  if (prefix === 'F' || prefix === 'E') return 'bug';
  return 'code-quality';
}

function normalizeBandit(results) {
  if (!Array.isArray(results)) return [];
  return results.map(r => {
    const severity = BANDIT_SEVERITY_MAP[r.issue_severity] || 'MEDIUM';
    const confidence = BANDIT_CONFIDENCE_MAP[r.issue_confidence] || 'medium';
    const file = r.filename ?? r.file ?? 'unknown';
    const line = r.line_number ?? r.line ?? null;
    return createFinding({
      tool: 'bandit',
      category: 'vulnerability',
      severity,
      file,
      line,
      column: null,
      rule: r.test_id ?? r.testid ?? r.id,
      message: r.issue_text ?? r.message ?? '',
      suggestedFix: null,
      confidence,
    });
  });
}

function normalizeSemgrep(results) {
  if (!Array.isArray(results)) return [];
  return results.map(r => {
    const severity = r.severity ? String(r.severity).toUpperCase() : 'MEDIUM';
    const file = r.path ?? r.file ?? 'unknown';
    const line = r.start?.line ?? r.line ?? null;
    const column = r.start?.col ?? r.column ?? null;
    const extra = r.extra && typeof r.extra === 'object' ? r.extra : null;
    return createFinding({
      tool: 'semgrep',
      category: mapSemgrepCategory(r),
      severity: ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(severity) ? severity : 'MEDIUM',
      file,
      line,
      column,
      rule: r.check_id ?? r.rule ?? r.id,
      message: extra?.message ?? extra?.metavars ?? r.message ?? '',
      suggestedFix: null,
    });
  });
}

function mapSemgrepCategory(result) {
  const checkId = (result.check_id || result.rule || '').toLowerCase();
  if (checkId.includes('security') || checkId.includes('vuln') || checkId.includes('injection')) return 'vulnerability';
  if (checkId.includes('error') || checkId.includes('bug')) return 'bug';
  if (checkId.includes('perf') || checkId.includes('slow')) return 'performance';
  return 'code-quality';
}

function normalizeDirect(results) {
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    if (r && r.id && r.tool && r.category && r.severity) return r;
    return createFinding(r);
  });
}

const NORMALIZERS = {
  eslint: normalizeEslint,
  typescript: normalizeTypescript,
  ruff: normalizeRuff,
  bandit: normalizeBandit,
  semgrep: normalizeSemgrep,
  codesentry: normalizeDirect,
  deployguard: normalizeDirect,
  modelshield: normalizeDirect,
};

function normalize(tool, rawResults) {
  const normalizer = NORMALIZERS[tool];
  if (!normalizer) {
    throw new Error(`No normalizer registered for tool: "${tool}". Supported: ${Object.keys(NORMALIZERS).join(', ')}`);
  }
  try {
    return normalizer(rawResults);
  } catch (err) {
    throw new Error(`Normalization failed for tool "${tool}": ${err.message}`);
  }
}

function registerNormalizer(tool, normalizerFn) {
  if (typeof normalizerFn !== 'function') {
    throw new Error('Normalizer must be a function');
  }
  NORMALIZERS[tool] = normalizerFn;
}

module.exports = {
  normalize,
  registerNormalizer,
  normalizeEslint,
  normalizeTypescript,
  normalizeRuff,
  normalizeBandit,
  normalizeSemgrep,
  SEVERITY_MAP,
};
