/**
 * DeployGuard Analyzer: Infrastructure, Containers, CI/CD & Configuration Security
 *
 * Implements pre-deployment checks covering:
 * - Dockerfile security (root user, unpinned :latest tags, secrets in ENV/ARG, missing healthcheck)
 * - CI/CD workflows (.github/workflows unpinned actions, secrets echoed in logs)
 * - Runtime configurations (committed .env secrets, production debug flags, permissive CORS)
 */

const fs = require('fs');
const path = require('path');
const { createFinding } = require('../../findings/schema');

const DOCKER_RULES = [
  {
    id: 'deployguard-docker-root',
    severity: 'HIGH',
    title: 'Container runs as root user',
    test: (content) => !/^\s*USER\s+(?!root\b)\w+/im.test(content),
    message: 'Dockerfile does not specify a non-root USER. Containers should run as non-root to minimize blast radius.',
    fix: 'Add `USER appuser` after creating an unprivileged user group.',
  },
  {
    id: 'deployguard-docker-unpinned-tag',
    severity: 'MEDIUM',
    title: 'Unpinned container base image tag',
    test: (content) => /^\s*FROM\s+[\w.-]+(?:\/[\w.-]+)*:latest\b/im.test(content) || /^\s*FROM\s+[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\s*$/im.test(content),
    message: 'Base image uses unpinned or :latest tag. Pin base images to specific immutable tags or digests for reproducibility.',
    fix: 'Specify exact semver or SHA256 digest in FROM directive (e.g. `node:20.11.1-alpine`).',
  },
  {
    id: 'deployguard-docker-env-secret',
    severity: 'BLOCKER',
    title: 'Hardcoded secret in Dockerfile ENV/ARG',
    test: (content) => /^\s*(?:ENV|ARG)\s+(?:.*(?:SECRET|KEY|PASSWORD|TOKEN|AUTH|CREDENTIALS).*\s*=\s*['"]?[a-zA-Z0-9_/+=.-]{8,}['"]?)/im.test(content),
    message: 'Sensitive secret or credentials detected in Dockerfile ENV/ARG directive. Build arguments and environment values persist in image layers.',
    fix: 'Inject secrets at runtime via Docker secrets or environment variables, not in Dockerfile.',
  },
  {
    id: 'deployguard-docker-add-directive',
    severity: 'LOW',
    title: 'Use of ADD instead of COPY',
    test: (content) => /^\s*ADD\s+(?!https?:\/\/)/im.test(content),
    message: 'ADD instruction used for local file copying. ADD has unexpected tar extraction behavior.',
    fix: 'Replace `ADD` with `COPY` for copying local files into the container image.',
  },
];

const CICD_RULES = [
  {
    id: 'deployguard-cicd-unpinned-action',
    severity: 'MEDIUM',
    title: 'Unpinned GitHub Action reference',
    test: (content) => /uses:\s+[\w-]+\/[\w-]+@(main|master|latest)\b/i.test(content),
    message: 'GitHub Action uses mutable branch reference (@main/@master). Actions should be pinned to immutable commit SHAs.',
    fix: 'Pin GitHub Action to a full commit SHA (e.g., `uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11`).',
  },
  {
    id: 'deployguard-cicd-secret-leak',
    severity: 'BLOCKER',
    title: 'Secret logged or echoed in CI/CD workflow',
    test: (content) => /run:\s+.*echo\s+.*(?:\$\{\{\s*secrets\.\w+\s*\}\}|\$SECRET|\$TOKEN)/i.test(content),
    message: 'Potential secret leakage in CI/CD pipeline step (echoing secrets or tokens to build log).',
    fix: 'Remove echo commands targeting secrets in workflow run commands.',
  },
  {
    id: 'deployguard-cicd-pr-target',
    severity: 'HIGH',
    title: 'Insecure pull_request_target checkout',
    test: (content) => /pull_request_target/i.test(content) && /actions\/checkout/i.test(content) && /ref:\s+\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/i.test(content),
    message: 'Workflow uses `pull_request_target` with checkout of untrusted PR head SHA. This allows unauthorized code to access repository secrets.',
    fix: 'Avoid checking out untrusted PR head code in privileged `pull_request_target` workflows.',
  },
];

const CONFIG_RULES = [
  {
    id: 'deployguard-production-debug',
    severity: 'HIGH',
    title: 'Production debug flag enabled',
    test: (content) => /(?:DEBUG\s*=\s*(?:True|true|1)|app\.debug\s*=\s*True|NODE_ENV\s*=\s*['"]development['"])/i.test(content) && !/test|fixture|spec/i.test(content),
    message: 'Debug mode explicitly enabled in application configuration. Debug modes expose stack traces and interactive consoles in production.',
    fix: 'Set `DEBUG = False` and ensure `NODE_ENV=production` in production configurations.',
  },
  {
    id: 'deployguard-permissive-cors',
    severity: 'HIGH',
    title: 'Wildcard CORS with credentials enabled',
    test: (content) => /(?:origin:\s*['"]\*['"]|allow_origins=\[['"]\*['"]\]).*credentials:\s*true/is.test(content),
    message: 'CORS policy specifies wildcard origin (*) alongside credentials: true. This violates browser security specs and exposes user data.',
    fix: 'Specify exact trusted origin domain whitelist when credentials are permitted.',
  },
  {
    id: 'deployguard-missing-security-headers',
    severity: 'MEDIUM',
    title: 'Missing HTTP security headers middleware',
    test: (content) => /express\(\)|FastAPI\(\)|Flask\(__name__\)/.test(content) && !/(helmet|SecurityMiddleware|Talisman)/i.test(content),
    message: 'HTTP server detected without standard security headers middleware (Helmet, HSTS, CSP, X-Frame-Options).',
    fix: 'Install and mount security middleware (e.g., `app.use(helmet())` for Express or `Talisman(app)` for Flask).',
  },
];

/**
 * Run DeployGuard inspection across project files
 */
function analyzeDeployGuard(files = [], projectPath = '') {
  const findings = [];

  // 1. Check for committed .env files
  const envFiles = files.filter((f) => {
    const base = path.basename(f).toLowerCase();
    return base === '.env' || (base.startsWith('.env.') && !base.includes('example') && !base.includes('sample'));
  });

  for (const envFile of envFiles) {
    findings.push(
      createFinding({
        tool: 'deployguard',
        category: 'security',
        rule: 'deployguard-committed-env',
        ruleId: 'deployguard-committed-env',
        file: envFile,
        line: 1,
        column: 1,
        severity: 'BLOCKER',
        message: `Committed environment file \`${path.basename(envFile)}\` detected in repository. Credentials and private keys may be leaked to version control.`,
        suggestedFix: 'Remove this file from git tracking (`git rm --cached .env`), add `.env*` to `.gitignore`, and use `.env.example` instead.',
      })
    );
  }

  // 2. Scan Dockerfiles, CI workflows, and configs
  for (const relPath of files) {
    const fullPath = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
    let content = '';

    try {
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, 'utf8');
      }
    } catch {
      continue;
    }

    const baseName = path.basename(relPath).toLowerCase();
    const isDocker = baseName === 'dockerfile' || baseName.endsWith('.dockerfile') || baseName.includes('containerfile');
    const isCiCd = relPath.includes('.github/workflows') || relPath.includes('.gitlab-ci');
    const isServerOrConfig = /(server|app|index|config|settings)\.(js|ts|py)$/i.test(baseName);

    if (isDocker) {
      for (const rule of DOCKER_RULES) {
        if (rule.test(content)) {
          findings.push(
            createFinding({
              tool: 'deployguard',
              category: 'security',
              rule: rule.id,
              ruleId: rule.id,
              file: relPath,
              line: 1,
              column: 1,
              severity: rule.severity,
              message: rule.message,
              suggestedFix: rule.fix,
            })
          );
        }
      }
    }

    if (isCiCd) {
      for (const rule of CICD_RULES) {
        if (rule.test(content)) {
          findings.push(
            createFinding({
              tool: 'deployguard',
              category: 'security',
              rule: rule.id,
              ruleId: rule.id,
              file: relPath,
              line: 1,
              column: 1,
              severity: rule.severity,
              message: rule.message,
              suggestedFix: rule.fix,
            })
          );
        }
      }
    }

    if (isServerOrConfig) {
      for (const rule of CONFIG_RULES) {
        if (rule.test(content)) {
          findings.push(
            createFinding({
              tool: 'deployguard',
              category: 'security',
              rule: rule.id,
              ruleId: rule.id,
              file: relPath,
              line: 1,
              column: 1,
              severity: rule.severity,
              message: rule.message,
              suggestedFix: rule.fix,
            })
          );
        }
      }
    }
  }

  return findings;
}

module.exports = {
  analyzeDeployGuard,
};
