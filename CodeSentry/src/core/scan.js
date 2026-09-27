const path = require('node:path');
const fs = require('node:fs');
const { createConfig } = require('./config');
const { normalize, registerNormalizer } = require('../findings/normalize');
const { deduplicate } = require('../findings/dedupe');
const { aggregate } = require('./aggregation');
const { score } = require('./scoring');
const { verdict } = require('./verdict');
const { SEVERITIES } = require('../findings/schema');
const { discover: realDiscover } = require('../discovery/discover');
const { runStaticAnalyzers } = require('../analyzers/static');
const { runCustomAnalyzers } = require('../analyzers/custom');
const { createAIClient } = require('../analyzers/ai/client');
const { createPromptGenerator } = require('../analyzers/ai/prompt');
const { calculateAutoGrad } = require('./autograd');
const { evaluateDeployReadiness } = require('./deployguard');
const { buildRiskGraph } = require('./risk-graph');

registerNormalizer('codesentry', normalizeCodesentry);

function normalizeCodesentry(rawResults) {
  if (!Array.isArray(rawResults)) return [];
  const { createFinding } = require('../findings/schema');
  return rawResults.map(r => {
    try {
      return createFinding({
        tool: 'codesentry',
        category: r.category || 'bugs',
        severity: r.severity || 'MEDIUM',
        file: r.file || 'unknown',
        line: r.line || null,
        column: r.column || null,
        rule: r.rule || null,
        message: r.message || '',
        suggestedFix: r.suggestedFix || null,
      });
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function scan(projectPath, overrides = {}) {
  const startTime = Date.now();
  const errors = [];

  const config = createConfig({ projectPath, ...overrides, validatePath: false });

  const onProgress = typeof overrides.onProgress === 'function' ? overrides.onProgress : null;

  if (onProgress) onProgress('discovering');
  let discoveryResult;
  try {
    discoveryResult = await realDiscover(config);
  } catch (err) {
    errors.push({ stage: 'discovery', message: err.message });
    discoveryResult = { files: [], languages: [], fileMap: {}, projectPath: config.projectPath };
  }

  if (onProgress) onProgress('analyzing');
  let staticResults = [];
  try {
    staticResults = await runStaticAnalyzers(discoveryResult, config);
  } catch (err) {
    errors.push({ stage: 'static-analyzers', message: err.message });
  }

  let customResult = null;
  try {
    customResult = await runCustomAnalyzers(discoveryResult, config);
  } catch (err) {
    errors.push({ stage: 'custom-analyzers', message: err.message });
  }

  if (onProgress) onProgress('processing');
  const allRawResults = [...staticResults];
  if (customResult && customResult.rawResults.length > 0) {
    allRawResults.push(customResult);
  }

  let allFindings = [];
  for (const result of allRawResults) {
    try {
      const normalized = normalize(result.tool, result.rawResults);
      allFindings = allFindings.concat(normalized);
    } catch (err) {
      errors.push({ stage: 'normalize', tool: result.tool, message: err.message });
    }
  }

  const dedupedFindings = deduplicate(allFindings);

  let filteredFindings = dedupedFindings;
  if (config.severityThreshold) {
    const severityIndex = SEVERITIES.indexOf(config.severityThreshold);
    if (severityIndex !== -1) {
      const allowedSeverities = SEVERITIES.slice(0, severityIndex + 1);
      filteredFindings = dedupedFindings.filter(f => allowedSeverities.includes(f.severity));
    }
  }

  if (config.categoryFilter) {
    filteredFindings = filteredFindings.filter(f => f.category === config.categoryFilter);
  }

  if (config.aiEnabled && filteredFindings.length > 0) {
    if (onProgress) onProgress('ai_analysis');
    try {
      filteredFindings = await analyzeWithAI(filteredFindings, discoveryResult, config);
    } catch (err) {
      errors.push({ stage: 'ai-analysis', message: err.message });
    }
  }

  const aggregationResult = aggregate(filteredFindings);
  const scoreResult = score(aggregationResult);
  const verdictResult = verdict(scoreResult);
  const autogradResult = calculateAutoGrad(filteredFindings, { targetPath: config.projectPath, projectPath: config.projectPath });
  const deployguardResult = evaluateDeployReadiness(filteredFindings, discoveryResult.files);
  const riskGraphResult = buildRiskGraph(discoveryResult.files, filteredFindings, config.projectPath);
  const duration = Date.now() - startTime;

  return {
    project: {
      path: config.projectPath,
      name: path.basename(config.projectPath),
    },
    filesAnalyzed: discoveryResult.files.length,
    languages: discoveryResult.languages,
    findings: filteredFindings,
    aggregation: aggregationResult,
    score: scoreResult,
    verdict: verdictResult,
    autograd: autogradResult,
    deployguard: deployguardResult,
    riskGraph: riskGraphResult,
    metadata: {
      duration,
      timestamp: new Date().toISOString(),
      errors,
      analyzerWarnings: collectWarnings(staticResults, customResult),
    },
  };
}

function collectWarnings(staticResults, customResult) {
  const warnings = [];
  for (const r of staticResults) {
    if (r.warning) warnings.push({ tool: r.tool, warning: r.warning });
    if (r.errors && r.errors.length > 0) {
      for (const e of r.errors) warnings.push({ tool: r.tool, error: e });
    }
  }
  if (customResult && customResult.warning) {
    warnings.push({ tool: 'codesentry', warning: customResult.warning });
  }
  return warnings;
}

async function analyzeWithAI(findings, discoveryResult, config) {
  const client = createAIClient({
    provider: config.aiProvider,
    model: config.aiModel,
    scanContext: {
      files: discoveryResult.files,
      languages: discoveryResult.languages,
    },
  });

  const promptGenerator = createPromptGenerator();
  const analyzedFindings = [];

  const maxFindings = parseInt(process.env.AI_MAX_FINDINGS || '10', 10);
  const findingsToAnalyze = findings.slice(0, maxFindings);

  for (const finding of findingsToAnalyze) {
    try {
      const sourceContext = getSourceContext(finding, discoveryResult);
      const prompt = promptGenerator.generateFindingAnalysisPrompt(finding, sourceContext);
      const aiResult = await client.analyze(prompt);

      analyzedFindings.push({
        ...finding,
        aiAnalysis: {
          explanation: aiResult.explanation,
          confidence: aiResult.confidence,
          falsePositiveProbability: aiResult.falsePositiveProbability,
          impact: aiResult.impact,
          suggestedFix: aiResult.suggestedFix,
          model: client.model,
        },
      });
    } catch (err) {
      analyzedFindings.push(finding);
    }
  }

  const remaining = findings.slice(maxFindings);
  return [...analyzedFindings, ...remaining];
}

function getSourceContext(finding, discoveryResult) {
  if (!finding.file || !discoveryResult.fileMap) return null;

  const filePath = finding.file;
  const fullPath = discoveryResult.fileMap[filePath];
  if (!fullPath) return null;

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, (finding.line || 1) - 11);
    const end = Math.min(lines.length, (finding.line || 1) + 10);
    return lines.slice(start, end).join('\n');
  } catch {
    return null;
  }
}

module.exports = {
  scan,
  normalizeCodesentry,
};
