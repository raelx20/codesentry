const crypto = require('node:crypto');

const SEVERITIES = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

// Legacy categories (kept for backward compatibility)
const LEGACY_CATEGORIES = ['bug', 'vulnerability', 'code-quality', 'performance', 'resource', 'style'];

// New categories as per prompt requirements
const NEW_CATEGORIES = ['security', 'bugs', 'efficiency', 'resources'];

// All valid categories (both legacy and new)
const CATEGORIES = [...new Set([...LEGACY_CATEGORIES, ...NEW_CATEGORIES])];

// Category mapping from legacy to new
const CATEGORY_MAP = {
  'bug': 'bugs',
  'vulnerability': 'security',
  'code-quality': 'bugs',
  'performance': 'efficiency',
  'resource': 'resources',
  'style': 'bugs',
};

// Reverse mapping from new to legacy
const REVERSE_CATEGORY_MAP = {
  'security': 'vulnerability',
  'bugs': 'bug',
  'efficiency': 'performance',
  'resources': 'resource',
};

const TOOLS = ['eslint', 'typescript', 'ruff', 'bandit', 'semgrep', 'codesentry', 'ai', 'deployguard', 'modelshield'];
const CONFIDENCES = ['high', 'medium', 'low'];

function mapCategory(category) {
  if (NEW_CATEGORIES.includes(category)) {
    return category;
  }
  return CATEGORY_MAP[category] || category;
}

function mapCategoryToLegacy(category) {
  if (LEGACY_CATEGORIES.includes(category)) {
    return category;
  }
  return REVERSE_CATEGORY_MAP[category] || category;
}

function createFinding({
  tool,
  category,
  severity = 'MEDIUM',
  file,
  line = null,
  column = null,
  rule = null,
  ruleId = null,
  message,
  suggestedFix = null,
  confidence = 'medium',
  source = null,
} = {}) {
  if (!tool || !TOOLS.includes(tool)) {
    throw new Error(`Invalid tool: "${tool}". Must be one of: ${TOOLS.join(', ')}`);
  }
  if (!category || !CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: "${category}". Must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`Invalid severity: "${severity}". Must be one of: ${SEVERITIES.join(', ')}`);
  }
  if (!file) {
    throw new Error('Finding must include a file path');
  }
  if (!message) {
    throw new Error('Finding must include a message');
  }
  if (!CONFIDENCES.includes(confidence)) {
    throw new Error(`Invalid confidence: "${confidence}". Must be one of: ${CONFIDENCES.join(', ')}`);
  }

  const normalLine = line != null ? Number(line) : null;
  const normalColumn = column != null ? Number(column) : null;
  
  // Normalize category to new format
  const normalizedCategory = mapCategory(category);

  const resolvedRule = rule || ruleId || null;
  const id = generateId(tool, file, normalLine, resolvedRule);
  const fingerprint = generateFingerprint(file, normalLine, normalizedCategory);

  return {
    id,
    tool,
    category: normalizedCategory,
    legacyCategory: mapCategoryToLegacy(normalizedCategory),
    severity,
    file,
    line: normalLine,
    column: normalColumn,
    rule: resolvedRule,
    ruleId: resolvedRule,
    message,
    suggestedFix,
    confidence,
    fingerprint,
    source: source || { tool, ruleId: resolvedRule, analyzerVersion: null },
  };
}

function generateId(tool, file, line, rule) {
  const raw = `${tool}:${file}:${line}:${rule || 'none'}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function generateFingerprint(file, line, category) {
  const raw = `${file}:${line}:${category}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function isValidFinding(obj) {
  if (!obj || typeof obj !== 'object') return false;
  try {
    if (!obj.id || typeof obj.id !== 'string') return false;
    if (!TOOLS.includes(obj.tool)) return false;
    if (!CATEGORIES.includes(obj.category)) return false;
    if (!SEVERITIES.includes(obj.severity)) return false;
    if (!obj.file || typeof obj.file !== 'string') return false;
    if (!obj.message || typeof obj.message !== 'string') return false;
    if (!obj.fingerprint || typeof obj.fingerprint !== 'string') return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createFinding,
  isValidFinding,
  generateId,
  generateFingerprint,
  mapCategory,
  mapCategoryToLegacy,
  SEVERITIES,
  CATEGORIES,
  LEGACY_CATEGORIES,
  NEW_CATEGORIES,
  CATEGORY_MAP,
  REVERSE_CATEGORY_MAP,
  TOOLS,
  CONFIDENCES,
};
