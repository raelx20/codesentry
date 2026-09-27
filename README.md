# CodeSentry

> **Zero-Dependency DevSecOps & AI Code Inspection Engine**  
> Fast deterministic SAST analysis combined with contextual OpenRouter AI verification and automated code repairs.

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Pure Node](https://img.shields.io/badge/Docker-Not%20Required-success.svg)](#zero-docker-required)
[![Architecture & Workflow](https://img.shields.io/badge/Architecture-workflow.md-blue.svg)](workflow.md)

CodeSentry inspects JavaScript, TypeScript, and Python codebases for security vulnerabilities, logic bugs, algorithmic bottlenecks, and resource leaks. Built with a terminal-native dark aesthetic and live typewriter progress telemetry, it offers built-in security detection, interactive code repairs, and dynamic AI-powered security hardening.

---

## ⚡ Quick Start (Zero-Install)

Run instantly without cloning or installing dependencies:

```bash
# Run directly from GitHub with zero install:
npx github:raelx20/codesentry scan .

# Or install globally from npm:
npm install -g codesentry-ai
codesentry scan .

# Or install directly from GitHub:
npm install -g github:raelx20/codesentry
```

> **Note**: Both `codesentry` and `codesentry-ai` command aliases work identically in your shell.

On first run, CodeSentry interactively configures your free OpenRouter API key and saves it to `~/.codesentry/config.json`. Subsequent runs never prompt again.

---

## 🌟 Key Capabilities

### 1. 🛠️ Interactive Post-Scan Fix Engine
After any scan, CodeSentry provides an interactive improvement menu:
- **Whole Codebase Mode**: Batch-repairs all detected vulnerabilities and bugs across the entire project.
- **Specific Flaw Mode**: Two-tier category filter (`Security Flaws`, `Code Bugs`, `Efficiency`) to select and preview individual issues.
- **Safe Diff Preview**: Color-coded diff card (`- red` / `+ green`) showing the exact file, line, and proposed change.
- **Confirmation Guard**: Requires explicit approval (`Yes, apply fix to file`) before writing to disk.
- **Auto-Verification**: Re-initiates scan immediately after fixes are written to confirm the issue is resolved.

### 2. 🛡️ Native Built-in Security Detection
Runs out-of-the-box with zero configuration and **no external tools or Docker required**:
- **SQL Injection**: Detects template literals, string concatenation, Python f-strings, and `%` formatting in queries across JavaScript and Python (`db.query`, `cursor.execute`, and query assignments).
- **Code Injection**: Flags dangerous dynamic code execution (`eval()`, `new Function()`, Python `exec()`).
- **Command Injection**: Detects unquoted shell commands and vulnerable `child_process.exec` invocations.
- **Hardcoded Secrets**: Identifies hardcoded API tokens, private keys, and credential literals.
- **Path Traversal & XSS**: Inspects unsanitized file paths in `fs.readFile`/`res.sendFile` and `dangerouslySetInnerHTML`.
- **Insecure Cryptography**: Flags deprecated hashing algorithms (MD5, SHA-1).

### 3. 🤖 AI-Only Proactive Security Suggestions
When a codebase is clean (**0 vulnerabilities / 0 bugs / perfect**):
- **100% AI-Driven**: No static hardcoded bullet points. CodeSentry inspects your project context (manifests, frameworks like Express, Fastify, Flask, Django, and structure) and queries the active OpenRouter AI model.
- **Architecture-Level Hardening**: The AI model provides custom recommendations covering HTTP security headers (Helmet / CSP), rate limiting (DoS mitigation), token flags (HttpOnly/SameSite), and boundary validation.
- **One-Click Export**: Save the AI suggestions directly to `AI-SECURITY-SUGGESTIONS.md` in your project root.

### 4. 🔑 Global Authentication & Persistent Preferences
- **Global Config**: Stored in `~/.codesentry/config.json` (`C:\Users\<user>\.codesentry\config.json` on Windows).
- **`codesentry auth`**: Dedicated dashboard to view masked keys (`sk-or-v1-••••••••••••9339`), update tokens, or toggle between AI models.
- **`codesentry model`**: Select from top-tier free AI models (`poolside/laguna-s-2.1:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `minimax/minimax-m2.5:free`, etc.) with changes persisted globally.

### 5. 📊 AutoGrad: Continuous Risk Grading & Offline Self-Learning
- **Continuous Grade**: Computes unified security & quality grade (`A+`, `A`, `B`, `C`, `D`, `F`) and 0–100 score weighted across security, bugs, efficiency, and resource risks.
- **Historical Trend Tracking**: Compares against previous scans (`▲ +4% improved`, `▼ -2% degraded`) persisted locally in `~/.codesentry/autograd-history.json`.
- **Self-Learning Offline Memory**: Remembers applied fixes locally in `~/.codesentry/autograd-memory.json`. When identical or similar patterns reappear, AutoGrad resolves them offline with **0ms latency** and **zero API calls or quota consumption**.

### 6. 🚀 DeployGuard: Pre-Deployment Readiness & Infrastructure Gate
- **Deployment Readiness Score**: Evaluates readiness percentage (0–100%) and determines deployment gate verdict: `PASSED`, `WARNING`, or `BLOCKED`.
- **Container & Docker Checks**: Flags root users in containers, unpinned `:latest` tags, secrets in `ENV`/`ARG`, and insecure `ADD` directives.
- **CI/CD Security**: Detects unpinned GitHub Actions (requiring commit SHAs), secrets echoed to build logs, and untrusted `pull_request_target` workflows.
- **Config & Secrets Guard**: Intercepts committed `.env` files, production debug flags (`DEBUG=True`), permissive wildcard CORS with credentials, and missing HTTP security headers.
- **Dedicated Command**: Run `codesentry deployguard .` or enforce in CI with `codesentry scan . --gate`.

### 7. 🧠 ModelShield: AI / LLM / RAG & Agent Security Engine
- **Prompt Injection Defense**: Flags direct, un-sanitized user input concatenated into LLM system or chat prompts.
- **Model Deserialization Protection**: Intercepts insecure weight loading using `pickle` or unconstrained `torch.load(..., weights_only=False)` vulnerable to arbitrary code execution.
- **Agent Sandbox Guards**: Flags AI agent tools that execute dynamic shell or eval code directly on model outputs.
- **LLM Data Leakage**: Prevents transmitting credentials, API keys, or sensitive secrets in model prompt payloads.
- **RAG Vector Injection**: Scans for un-sanitized query strings interpolated into vector database queries.

### 8. 🕸️ Software Risk Graph & AttackGraph Multi-Step Tracing
- **CodeTwin Architectural Modeling**: Automatically discovers external HTTP entrypoints, database sinks, shell execution points, and AI prompt interfaces.
- **Multi-Step Attack Paths**: Correlates static findings to construct end-to-end exploit chains (e.g. `[Route: /api/query] ──▶ [Vulnerability: SQL Injection] ──▶ [Sink: db.query]`).
- **Terminal & Report Visuals**: Renders color-coded ANSI attack chain cards in terminal output and interactive Mermaid diagrams in Markdown audit reports.

---

## 🚀 Installation Options

### Option A: Global CLI Install
```bash
npm install -g codesentry-ai

# Now available globally from any terminal
codesentry scan .
codesentry auth
codesentry model
```

### Option B: Project Dev Dependency
```bash
npm install --save-dev codesentry

# Run via npx
npx codesentry scan .
```

### Option C: Clone & Run from Source
```bash
git clone https://github.com/raelx20/codesentry.git
cd codesentry/CodeSentry
npm install
npm link # or node bin/codesentry.js scan .
```

---

## 💻 CLI Commands & Options

```bash
# Basic scan
codesentry scan .

# Fast static mode (skips cloud AI triage)
codesentry scan . --no-ai

# Pre-deployment readiness analysis & infrastructure gate
codesentry deployguard .

# Enforce strict CI/CD gate (exits with failure if gate is BLOCKED)
codesentry scan . --gate

# Automatic code repair
codesentry scan . --fix

# Configure or check OpenRouter API credentials
codesentry auth

# Interactively toggle AI reasoning models
codesentry model

# CLI help & documentation
codesentry --help
```

---

## 🧠 OpenRouter AI Model Catalog

CodeSentry uses OpenRouter's free-tier AI models with automated fallback chaining:

| Model ID | Provider | Recommended Use |
|---|---|---|
| `poolside/laguna-s-2.1:free` | Poolside | **Default**: Fast, precise syntax & logic analysis |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | NVIDIA | **Complex**: Deep polyglot & DevSecOps reasoning |
| `minimax/minimax-m2.5:free` | MiniMax | High-speed code triage fallback |
| `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA | Balanced code review |
| `mimo/mimo-2.5:free` | Mimo | Fast fallback |
| `cohere/north-mini-code:free` | Cohere | Specialized code model |
| `openrouter/auto` | OpenRouter | **Ultimate Fallback**: Auto-routes to available free model |

---

## 🚫 Ignore Configuration (`.codesentryignore`)

Add `.codesentryignore` to your project root to exclude directories from audits:

```text
node_modules/
dist/
build/
coverage/
*.min.js
*.bundle.js
__pycache__/
.env*
```

*Note: CodeSentry automatically ignores test fixtures (`tests/fixtures/`) and build caches when scanning user codebases.*

---

## 🔄 CI/CD Security Gate (GitHub Actions)

Fail pull requests if high-severity vulnerabilities are introduced:

```yaml
name: CodeSentry Security Gate

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

jobs:
  security-audit:
    name: CodeSentry SAST Inspection
    runs-on: ubuntu-latest
    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Run CodeSentry Scan
        run: npx github:raelx20/codesentry scan . --severity HIGH
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

### Exit Codes
| Exit Code | Meaning | CI Impact |
|:---:|:---|:---|
| **`0`** | Clean scan (0 issues above threshold) | Pass ✅ |
| **`1`** | Violations detected | Fail ❌ |
| **`2`** | Fatal runtime or syntax error | Fail ❌ |

---

## 🐳 Zero Docker Required

CodeSentry is a **pure Node.js CLI tool**. It has no native compile steps, requires no Docker daemon, and runs on Windows, macOS, and Linux out-of-the-box.

---

## 🧪 Testing & Verification

CodeSentry contains a comprehensive test suite (97 tests across 30 suites):

```bash
# Run all unit, analyzer, and integration tests
npm test

# Run unit tests only
npm run test:unit

# Run analyzer tests only
npm run test:analyzers
```
