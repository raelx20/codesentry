const { runEslint } = require('./eslint');
const { runTypescript } = require('./typescript');
const { runRuff } = require('./ruff');
const { runBandit } = require('./bandit');
const { runSemgrep } = require('./semgrep');

const ANALYZERS = {
  eslint: { run: runEslint, languages: ['javascript', 'typescript'] },
  typescript: { run: runTypescript, languages: ['typescript'] },
  ruff: { run: runRuff, languages: ['python'] },
  bandit: { run: runBandit, languages: ['python'] },
  semgrep: { run: runSemgrep, languages: ['javascript', 'typescript', 'python'] },
};

async function runStaticAnalyzers(discoveryResult, config = {}) {
  const results = [];
  const enabledAnalyzers = config.enabledAnalyzers || Object.keys(ANALYZERS);
  const allFiles = discoveryResult.files || [];
  const languages = discoveryResult.languages || [];

  const runnerPromises = [];

  for (const toolName of enabledAnalyzers) {
    const analyzer = ANALYZERS[toolName];
    if (!analyzer) continue;

    const applicableLanguages = analyzer.languages.filter(lang => languages.includes(lang));
    if (applicableLanguages.length === 0 && toolName !== 'semgrep') continue;

    const promise = runSingleAnalyzer(toolName, analyzer, allFiles, config)
      .then(result => ({ tool: toolName, ...result }))
      .catch(err => ({
        tool: toolName,
        available: false,
        results: [],
        errors: [`Analyzer ${toolName} failed: ${err.message}`],
        warning: null,
      }));

    runnerPromises.push(promise);
  }

  const outcomes = await Promise.allSettled(runnerPromises);

  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') {
      const { tool, available, results: rawResults, errors, warning } = outcome.value;
      results.push({
        tool,
        rawResults,
        available,
        errors,
        warning,
      });
    }
  }

  return results;
}

async function runSingleAnalyzer(toolName, analyzer, files, config) {
  const projectPath = config.projectPath || process.cwd();
  return analyzer.run(files, { ...config, projectPath });
}

const { getAvailabilityCache, clearAvailabilityCache } = require('./availability');

module.exports = {
  runStaticAnalyzers,
  ANALYZERS,
  getAvailabilityCache,
  clearAvailabilityCache,
};
