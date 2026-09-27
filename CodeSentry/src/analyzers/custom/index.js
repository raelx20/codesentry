const fs = require('node:fs');
const path = require('node:path');
const { analyzeBugs } = require('./bugs');
const { analyzeEfficiency } = require('./efficiency');
const { analyzeResources } = require('./resources');
const { analyzeSecurity } = require('./security');
const { analyzeModelShield } = require('./modelshield');
const { analyzeDeployGuard } = require('./deployguard');

const ANALYZERS = [
  { name: 'security', analyze: analyzeSecurity },
  { name: 'bugs', analyze: analyzeBugs },
  { name: 'efficiency', analyze: analyzeEfficiency },
  { name: 'resources', analyze: analyzeResources },
];

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const PY_EXTENSIONS = new Set(['.py', '.pyw']);

function isAnalyzable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return JS_EXTENSIONS.has(ext) || PY_EXTENSIONS.has(ext);
}

async function runCustomAnalyzers(discoveryResult, config = {}) {
  const projectPath = config.projectPath || process.cwd();
  const allFiles = discoveryResult.files || [];
  const rawResults = [];

  for (const relativePath of allFiles) {
    const fullPath = path.resolve(projectPath, relativePath);

    if (!isAnalyzable(fullPath)) continue;

    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    for (const analyzer of ANALYZERS) {
      try {
        const findings = analyzer.analyze(relativePath, content);
        for (const finding of findings) {
          rawResults.push({
            file: finding.file,
            line: finding.line,
            column: finding.column,
            rule: finding.rule,
            message: finding.message,
            severity: finding.severity,
            category: finding.category,
            suggestedFix: finding.suggestedFix || null,
            analyzer: analyzer.name,
          });
        }
      } catch {
        // Skip analyzer failures for individual files
      }
    }
  }

  // ModelShield: AI / LLM / Agent Security
  try {
    const modelShieldFindings = analyzeModelShield(allFiles, projectPath);
    for (const f of modelShieldFindings) {
      rawResults.push({
        file: f.file,
        line: f.line,
        column: f.column,
        rule: f.ruleId || f.rule,
        message: f.message,
        severity: f.severity,
        category: f.category || 'security',
        suggestedFix: f.suggestedFix || null,
        analyzer: 'modelshield',
      });
    }
  } catch {
    // Non-fatal
  }

  // DeployGuard: Build, Runtime, Containers & Config Security
  try {
    const deployGuardFindings = analyzeDeployGuard(allFiles, projectPath);
    for (const f of deployGuardFindings) {
      rawResults.push({
        file: f.file,
        line: f.line,
        column: f.column,
        rule: f.ruleId || f.rule,
        message: f.message,
        severity: f.severity,
        category: f.category || 'security',
        suggestedFix: f.suggestedFix || null,
        analyzer: 'deployguard',
      });
    }
  } catch {
    // Non-fatal
  }

  return {
    tool: 'codesentry',
    rawResults,
    available: true,
    errors: [],
    warning: null,
  };
}

module.exports = {
  runCustomAnalyzers,
  ANALYZERS,
  isAnalyzable,
};
