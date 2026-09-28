/**
 * CodeSentry CLI Authentication & Global Configuration
 *
 * Provides a proper CLI experience (similar to gh, vercel, or aws CLI):
 * - Stores user configuration globally in ~/.codesentry/config.json
 * - Detects first-time boot when no OPENROUTER_API_KEY is configured
 * - Interactively prompts for API key and saves it locally
 * - Masks API keys for safe display in logs and status screens
 * - Provides 'codesentry auth' commands to inspect or update credentials
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const theme = require('./theme');
const { Select } = require('./components/select');
const { formatStatusIndicator } = require('./components/status-indicator');

/**
 * Returns the global configuration directory path: ~/.codesentry
 */
function getGlobalConfigDir() {
  return path.join(os.homedir(), '.codesentry');
}

/**
 * Returns the global config file path: ~/.codesentry/config.json
 */
function getGlobalConfigPath() {
  return path.join(getGlobalConfigDir(), 'config.json');
}

/**
 * Reads and parses the global config JSON file.
 * Returns an empty object if the file doesn't exist or is invalid.
 */
function readGlobalConfig(customPath = null) {
  const filePath = customPath || getGlobalConfigPath();
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {}
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
  * Merges updates into the global config JSON file and writes it to disk.
  * Creates the ~/.codesentry directory if it doesn't exist with 0o700 permissions
  * and writes config.json with 0o600 (owner read/write only).
  */
function saveGlobalConfig(updates = {}, customPath = null) {
  const filePath = customPath || getGlobalConfigPath();
  const dirPath = path.dirname(filePath);

  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }

    const existing = readGlobalConfig(filePath);
    const merged = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    if (!merged.created_at) {
      merged.created_at = new Date().toISOString();
    }

    // Write file with user-only permissions (0o600) and enforce chmod
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {}

    return merged;
  } catch (err) {
    return null;
  }
}

/**
 * Loads global config and injects OPENROUTER_API_KEY and OPENROUTER_MODEL
 * into process.env if they are not already set.
 */
function loadGlobalConfig(customPath = null) {
  const config = readGlobalConfig(customPath);

  if (!process.env.OPENROUTER_API_KEY && config.openrouter_api_key) {
    process.env.OPENROUTER_API_KEY = config.openrouter_api_key;
  }

  if (!process.env.OPENROUTER_MODEL && config.openrouter_model) {
    process.env.OPENROUTER_MODEL = config.openrouter_model;
  }

  if (!process.env.AGENTROUTER_API_KEY && (config.agentrouter_api_key || config.omniroute_api_key)) {
    process.env.AGENTROUTER_API_KEY = config.agentrouter_api_key || config.omniroute_api_key;
  }

  if (!process.env.AGENTROUTER_BASE_URL && (config.agentrouter_base_url || config.omniroute_base_url)) {
    process.env.AGENTROUTER_BASE_URL = config.agentrouter_base_url || config.omniroute_base_url;
  }

  if (!process.env.OPENAI_API_KEY && config.openai_api_key) {
    process.env.OPENAI_API_KEY = config.openai_api_key;
  }

  if (!process.env.OPENAI_MODEL && config.openai_model) {
    process.env.OPENAI_MODEL = config.openai_model;
  }

  if (!process.env.CODESENTRY_AI_PROVIDER && config.ai_provider) {
    process.env.CODESENTRY_AI_PROVIDER = config.ai_provider;
  }

  const activeProvider = (
    process.env.CODESENTRY_AI_PROVIDER ||
    config.ai_provider ||
    (process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY ? 'openai' : 'openrouter')
  ).toLowerCase();

  let resolvedApiKey = process.env.OPENROUTER_API_KEY || null;
  if (activeProvider === 'openai') {
    resolvedApiKey = process.env.OPENAI_API_KEY || null;
  } else if (activeProvider === 'agentrouter') {
    resolvedApiKey = process.env.AGENTROUTER_API_KEY || null;
  }

  return {
    config,
    provider: activeProvider,
    apiKey: resolvedApiKey,
    openrouterKey: process.env.OPENROUTER_API_KEY || null,
    openaiKey: process.env.OPENAI_API_KEY || null,
    agentrouterKey: process.env.AGENTROUTER_API_KEY || null,
    model: process.env.OPENAI_MODEL || process.env.OPENROUTER_MODEL || config.openrouter_model || 'gpt-4o-mini',
    isConfigured: Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.AGENTROUTER_API_KEY),
  };
}

/**
 * Masks an API key for safe display: e.g. "sk-or-v1-••••••••9339"
 */
function maskApiKey(key) {
  if (!key || typeof key !== 'string') {
    return '(not configured)';
  }
  const trimmed = key.trim();
  if (trimmed.length <= 12) {
    return '••••••••';
  }
  if (trimmed.startsWith('sk-or-v1-')) {
    const suffix = trimmed.slice(-4);
    return `sk-or-v1-••••••••••••${suffix}`;
  }
  const prefix = trimmed.slice(0, 6);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••••••${suffix}`;
}

/**
 * Interactive prompt to read input from terminal using readline.
 */
function promptInput(promptText = '> ') {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      resolve('');
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(promptText, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

/**
 * First-boot authentication check.
 * If OPENROUTER_API_KEY is missing and running in an interactive TTY,
 * displays the setup wizard, prompts the user, and persists the key locally.
 */
async function ensureAuth(options = {}) {
  const { jsonMode = false, forcePrompt = false, noAi = false } = options;

  // If user explicitly passed --no-ai, respect it without prompting
  if (noAi) {
    return { isConfigured: false, skipped: true };
  }

  // Check if we already have an API key (from env, .env, or ~/.codesentry/config.json)
  const activeProvider = (process.env.CODESENTRY_AI_PROVIDER || 'openai').toLowerCase();
  const currentKey = activeProvider === 'openai'
    ? (process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.AGENTROUTER_API_KEY)
    : (process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.AGENTROUTER_API_KEY);

  if (currentKey && !forcePrompt) {
    return {
      isConfigured: true,
      apiKey: currentKey,
      model: activeProvider === 'openai'
        ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
        : (process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'),
    };
  }

  // In non-interactive environments (CI/CD, pipes, JSON mode), do not block
  const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY && !jsonMode);
  if (!isInteractive) {
    return {
      isConfigured: false,
      apiKey: null,
      skipped: true,
    };
  }

  // ── Render First-Time Setup Welcome Card ──────────────────────────────────
  const setupLines = [
    `${theme.colors.cyan('▎')} ${theme.colors.brightWhite(theme.bold('Welcome to CodeSentry!'))}`,
    `${theme.colors.cyan('▎')}`,
    `${theme.colors.cyan('▎')} CodeSentry uses OpenRouter AI for DevSecOps vulnerability triage,`,
    `${theme.colors.cyan('▎')} remediation diff generation, and architecture security checks.`,
    `${theme.colors.cyan('▎')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.cyan('•')} ${theme.colors.white('Free tier models supported out of the box (Laguna S 2.1, Nemotron)')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.cyan('•')} ${theme.colors.white('Get a free API key at:')} ${theme.colors.cyan('https://openrouter.ai/keys')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.cyan('•')} ${theme.colors.white('Keys are saved locally to:')} ${theme.colors.gray('~/.codesentry/config.json')}`,
  ];

  console.log('');
  console.log(theme.card(setupLines, {
    title: theme.colors.cyan(theme.bold('FIRST-TIME SETUP')),
    rightTitle: theme.colors.gray('codesentry v0.1.0'),
    width: 72,
  }));
  console.log('');

  const choices = [
    {
      label: 'Enter OpenRouter API Key now (Recommended)',
      value: 'enter_key',
      badge: 'RECOMMENDED',
      description: 'Save key locally to unlock AI deep security triage and fixes',
    },
    {
      label: 'Continue with Static Rules only (Skip AI for now)',
      value: 'skip',
      description: 'Run static engines (Ruff, Bandit, Semgrep) without cloud AI',
    },
  ];

  const choice = await Select({
    label: 'Select setup option:',
    options: choices,
    defaultIndex: 0,
  });

  if (choice === 'enter_key') {
    console.log('\n' + theme.colors.cyan('▎') + ' ' + theme.colors.white('Paste your OpenRouter API key below (starts with sk-or-):'));
    const inputKey = await promptInput(theme.colors.cyan('  OpenRouter API Key: '));

    if (inputKey && inputKey.length >= 8) {
      const defaultModel = process.env.OPENROUTER_MODEL || 'poolside/laguna-s-2.1:free';
      saveGlobalConfig({
        openrouter_api_key: inputKey,
        openrouter_model: defaultModel,
      });

      process.env.OPENROUTER_API_KEY = inputKey;
      process.env.OPENROUTER_MODEL = defaultModel;

      console.log('');
      console.log(formatStatusIndicator({
        status: 'online',
        label: `OpenRouter API key saved locally to ${theme.colors.gray('~/.codesentry/config.json')}`,
      }));
      console.log(theme.colors.gray(`  Key: ${maskApiKey(inputKey)} · Model: ${defaultModel}\n`));

      return {
        isConfigured: true,
        apiKey: inputKey,
        model: defaultModel,
      };
    } else {
      console.log('\n' + formatStatusIndicator({
        status: 'warning',
        label: 'No valid key entered. Continuing with static analysis only.',
      }));
      console.log(theme.colors.gray("  Run 'codesentry auth' anytime to configure your key.\n"));
      return { isConfigured: false, skipped: true };
    }
  }

  // User chose to skip
  console.log('\n' + formatStatusIndicator({
    status: 'warning',
    label: 'Proceeding with static analysis only (AI disabled).',
  }));
  console.log(theme.colors.gray("  Run 'codesentry auth' anytime to configure your key.\n"));

  return {
    isConfigured: false,
    skipped: true,
  };
}

/**
 * Interactive 'codesentry auth' dashboard handler
 */
async function handleAuthCommand(options = {}) {
  theme.applyBlackTerminalBackground();
  console.log(theme.renderLogo());

  const currentConfig = readGlobalConfig();
  const activeProvider = (process.env.CODESENTRY_AI_PROVIDER || currentConfig.ai_provider || (currentConfig.openai_api_key ? 'openai' : 'openrouter')).toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY || currentConfig.openai_api_key || null;
  const openrouterKey = process.env.OPENROUTER_API_KEY || currentConfig.openrouter_api_key || null;
  const agentrouterKey = process.env.AGENTROUTER_API_KEY || currentConfig.agentrouter_api_key || currentConfig.omniroute_api_key || null;
  const agentrouterUrl = process.env.AGENTROUTER_BASE_URL || currentConfig.agentrouter_base_url || 'https://agentrouter.org/v1';
  const currentModel = activeProvider === 'openai'
    ? (process.env.OPENAI_MODEL || currentConfig.openai_model || 'gpt-4o-mini')
    : (process.env.OPENROUTER_MODEL || currentConfig.openrouter_model || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
  const configPath = getGlobalConfigPath();

  const isConfigured = Boolean(openrouterKey || agentrouterKey || openaiKey);

  let activeProviderLabel = 'OpenRouter';
  if (activeProvider === 'openai') activeProviderLabel = 'OpenAI';
  else if (activeProvider === 'agentrouter') activeProviderLabel = 'AgentRouter';

  const statusLines = [
    `${theme.colors.cyan('▎')} ${theme.colors.brightWhite(theme.bold('Authentication Status'))}`,
    `${theme.colors.cyan('▎')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.white('Status:')}          ${isConfigured ? theme.colors.green('● Configured & Ready') : theme.colors.yellow('○ Not configured (Static mode only)')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.white('Active Provider:')} ${theme.colors.cyan('● ' + activeProviderLabel)}`,
    `${theme.colors.cyan('▎')} ${theme.colors.white('OpenAI:')}           ${openaiKey ? theme.colors.green(maskApiKey(openaiKey)) : theme.colors.gray('(not configured)')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.white('OpenRouter:')}       ${openrouterKey ? theme.colors.green(maskApiKey(openrouterKey)) : theme.colors.gray('(not configured)')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.white('AgentRouter:')}      ${agentrouterKey ? theme.colors.cyan(maskApiKey(agentrouterKey)) + theme.colors.gray(` · ${agentrouterUrl}`) : theme.colors.gray('(not configured)')}`,
    `${theme.colors.cyan('▎')} ${theme.colors.white('Active Model:')}     ${theme.colors.brightWhite(currentModel)}`,
    `${theme.colors.cyan('▎')} ${theme.colors.white('Config:')}           ${theme.colors.gray(configPath)}`,
  ];

  console.log(theme.card(statusLines, {
    title: theme.colors.cyan(theme.bold('CODESENTRY AUTH')),
    rightTitle: theme.colors.gray('codesentry v0.1.0'),
    width: 72,
  }));
  console.log('');

  const menuOptions = [
    {
      label: 'Switch Active Provider (OpenAI / OpenRouter / AgentRouter)',
      value: 'switch_provider',
      badge: activeProvider.toUpperCase(),
      description: `Toggle active engine (Currently: ${activeProvider.toUpperCase()})`,
    },
    {
      label: openaiKey ? 'Update OpenAI API Key' : 'Configure OpenAI API Key',
      value: 'update_openai',
      badge: 'OPENAI',
      description: 'Enter and save an OpenAI API key (sk-proj-... / sk-...)',
    },
    {
      label: openrouterKey ? 'Update OpenRouter API Key' : 'Configure OpenRouter API Key',
      value: 'update_openrouter',
      badge: 'OPENROUTER',
      description: 'Enter and save an OpenRouter key to ~/.codesentry/config.json',
    },
    {
      label: agentrouterKey ? 'Update AgentRouter Credentials' : 'Configure AgentRouter (Key & Proxy)',
      value: 'update_agentrouter',
      badge: 'AGENTROUTER',
      description: 'Configure AgentRouter API key and custom gateway/proxy endpoint',
    },
    {
      label: 'Switch Active AI Model',
      value: 'switch_model',
      badge: 'MODEL',
      description: 'Select your preferred AI model for vulnerability analysis',
    },
  ];

  if (isConfigured) {
    menuOptions.push({
      label: 'Remove All Credentials (Logout / Static mode)',
      value: 'logout',
      badge: 'LOGOUT',
      description: 'Delete stored keys from ~/.codesentry/config.json',
    });
  }

  menuOptions.push({
    label: 'Done / Exit',
    value: 'exit',
    description: 'Return to terminal',
  });

  const action = await Select({
    label: 'Manage CodeSentry Authentication:',
    options: menuOptions,
    defaultIndex: 0,
  });

  if (action === 'switch_provider') {
    const { Select: SelectComponent } = require('./components/select');
    const providerOptions = [
      {
        label: 'OpenAI (Official GPT-4o / o3-mini API)',
        value: 'openai',
        badge: openaiKey ? 'READY' : 'NEEDS KEY',
        description: 'Connect directly to OpenAI API (api.openai.com)',
      },
      {
        label: 'OpenRouter (Multi-model Cloud Gateway)',
        value: 'openrouter',
        badge: openrouterKey ? 'READY' : 'NEEDS KEY',
        description: 'Connect directly to OpenRouter cloud models (openrouter.ai)',
      },
      {
        label: 'AgentRouter (Anthropic relay / Local proxy)',
        value: 'agentrouter',
        badge: agentrouterKey ? 'READY' : 'NEEDS KEY',
        description: 'Route requests to AgentRouter or local proxy (agentrouter.org / localhost:7187)',
      },
    ];

    let defaultIdx = 0;
    if (activeProvider === 'openrouter') defaultIdx = 1;
    else if (activeProvider === 'agentrouter') defaultIdx = 2;

    const chosenProvider = await SelectComponent({
      label: 'Select Active AI Provider:',
      options: providerOptions,
      defaultIndex: defaultIdx,
    });

    if (chosenProvider) {
      saveGlobalConfig({ ai_provider: chosenProvider });
      process.env.CODESENTRY_AI_PROVIDER = chosenProvider;
      console.log('\n' + formatStatusIndicator({
        status: 'online',
        label: `Active AI provider switched to ${theme.colors.cyan(chosenProvider.toUpperCase())}\n`,
      }));
    }
  } else if (action === 'update_openai') {
    console.log('\n' + theme.colors.cyan('▎') + ' ' + theme.colors.white('Paste your OpenAI API key below (https://platform.openai.com/api-keys):'));
    const inputKey = await promptInput(theme.colors.cyan('  OpenAI API Key: '));

    if (inputKey && inputKey.length >= 8) {
      saveGlobalConfig({
        openai_api_key: inputKey,
        openai_model: currentConfig.openai_model || 'gpt-4o-mini',
        ai_provider: 'openai',
      });
      process.env.OPENAI_API_KEY = inputKey;
      process.env.CODESENTRY_AI_PROVIDER = 'openai';

      console.log('\n' + formatStatusIndicator({
        status: 'online',
        label: `OpenAI API key saved locally to ${theme.colors.gray('~/.codesentry/config.json')}`,
      }));
      console.log(theme.colors.gray(`  Key: ${maskApiKey(inputKey)} · Provider: OPENAI · Model: ${currentConfig.openai_model || 'gpt-4o-mini'}\n`));
    } else {
      console.log('\n' + formatStatusIndicator({
        status: 'warning',
        label: 'No changes made.',
      }) + '\n');
    }
  } else if (action === 'update_openrouter') {
    console.log('\n' + theme.colors.cyan('▎') + ' ' + theme.colors.white('Paste your OpenRouter API key below (https://openrouter.ai/keys):'));
    const inputKey = await promptInput(theme.colors.cyan('  OpenRouter API Key: '));

    if (inputKey && inputKey.length >= 8) {
      saveGlobalConfig({
        openrouter_api_key: inputKey,
        openrouter_model: currentModel,
      });
      process.env.OPENROUTER_API_KEY = inputKey;

      console.log('\n' + formatStatusIndicator({
        status: 'online',
        label: `OpenRouter API key updated in ${theme.colors.gray('~/.codesentry/config.json')}`,
      }));
      console.log(theme.colors.gray(`  Key: ${maskApiKey(inputKey)}\n`));
    } else {
      console.log('\n' + formatStatusIndicator({
        status: 'warning',
        label: 'No changes made.',
      }) + '\n');
    }
  } else if (action === 'update_agentrouter') {
    console.log('\n' + theme.colors.cyan('▎') + ' ' + theme.colors.white('Enter AgentRouter API Key (sk-...):'));
    const inputKey = await promptInput(theme.colors.cyan(`  AgentRouter API Key [${maskApiKey(agentrouterKey)}]: `));
    const effectiveKey = inputKey || agentrouterKey;

    console.log('\n' + theme.colors.cyan('▎') + ' ' + theme.colors.white('Enter AgentRouter Base URL (e.g. https://agentrouter.org/v1 or http://localhost:7187/v1):'));
    const inputUrl = await promptInput(theme.colors.cyan(`  Endpoint URL [${agentrouterUrl}]: `));
    const effectiveUrl = inputUrl || agentrouterUrl;

    if (effectiveKey && effectiveKey.length >= 8) {
      saveGlobalConfig({
        agentrouter_api_key: effectiveKey,
        agentrouter_base_url: effectiveUrl,
      });
      process.env.AGENTROUTER_API_KEY = effectiveKey;
      process.env.AGENTROUTER_BASE_URL = effectiveUrl;

      console.log('\n' + formatStatusIndicator({
        status: 'online',
        label: `AgentRouter configuration saved to ${theme.colors.gray('~/.codesentry/config.json')}`,
      }));
      console.log(theme.colors.gray(`  Key: ${maskApiKey(effectiveKey)} · Endpoint: ${effectiveUrl}\n`));
    } else {
      console.log('\n' + formatStatusIndicator({
        status: 'warning',
        label: 'No changes made.',
      }) + '\n');
    }
  } else if (action === 'switch_model') {
    const { Select: SelectComponent } = require('./components/select');
    const modelOptions = [
      {
        label: 'NVIDIA Nemotron 3 Nano Omni (nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free)',
        value: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        badge: 'ACTIVE FREE',
        description: 'Verified live zero-cost model for reasoning and automated code repair',
      },
      {
        label: 'NVIDIA Nemotron 3.5 Lightning (nvidia/nemotron-3.5-lightning:free)',
        value: 'nvidia/nemotron-3.5-lightning:free',
        badge: 'ACTIVE FREE',
        description: 'High-speed verified live zero-cost model for rapid triage',
      },
      {
        label: 'Cohere North Mini Code (cohere/north-mini-code:free)',
        value: 'cohere/north-mini-code:free',
        badge: 'ACTIVE FREE',
        description: 'Fast Cohere-optimized code structure analysis (free tier)',
      },
      {
        label: 'MiniMax M3 (minimax/minimax-m3)',
        value: 'minimax/minimax-m3',
        badge: 'PAID TIER',
        description: 'Premier code reasoning & automated repair model with high precision synthesis',
      },
      {
        label: 'DeepSeek V3 (deepseek/deepseek-chat)',
        value: 'deepseek/deepseek-chat',
        badge: 'PAID TIER',
        description: 'High-precision automated code repair and vulnerability remediation',
      },
      {
        label: 'Qwen 2.5 Coder 32B (qwen/qwen-2.5-coder-32b-instruct)',
        value: 'qwen/qwen-2.5-coder-32b-instruct',
        badge: 'PAID TIER',
        description: 'Top-ranking open coding benchmark model (92.7% HumanEval)',
      },
      {
        label: 'Llama 3.3 70B (meta-llama/llama-3.3-70b-instruct)',
        value: 'meta-llama/llama-3.3-70b-instruct',
        badge: 'PAID TIER',
        description: 'State-of-the-art open reasoning and multi-turn refactoring',
      },
      {
        label: 'Auto (Smart Context-Aware Heuristics with Free Fallback)',
        value: 'auto',
        badge: 'AUTO',
        description: 'Dynamically adapts model selection based on project size & complexity',
      },
      {
        label: 'Disable AI (Static Analysis Only)',
        value: 'none',
        description: 'Run static engines (Ruff, Bandit, Semgrep) without cloud AI',
      },
    ];

    let effectiveModelOptions = modelOptions;
    if (activeProvider === 'openai') {
      effectiveModelOptions = [
        {
          label: 'GPT-4o Mini (gpt-4o-mini)',
          value: 'gpt-4o-mini',
          badge: 'RECOMMENDED',
          description: 'Fast, highly capable, and cost-effective default for code analysis & repair',
        },
        {
          label: 'GPT-4o (gpt-4o)',
          value: 'gpt-4o',
          badge: 'FLAGSHIP',
          description: 'High-intelligence flagship model with deep vulnerability reasoning',
        },
        {
          label: 'o3-mini (o3-mini)',
          value: 'o3-mini',
          badge: 'REASONING',
          description: 'Cutting-edge STEM & coding reasoning model with chain-of-thought',
        },
        {
          label: 'GPT-4 Turbo (gpt-4-turbo)',
          value: 'gpt-4-turbo',
          badge: 'PAID TIER',
          description: 'Broad general knowledge and high-precision code repair',
        },
        {
          label: 'Disable AI (Static Analysis Only)',
          value: 'none',
          description: 'Run static engines (Ruff, Bandit, Semgrep) without cloud AI',
        },
      ];
    }

    const chosenModel = await SelectComponent({
      label: 'Select Active AI Model:',
      options: effectiveModelOptions,
      defaultIndex: 0,
    });

    if (chosenModel) {
      if (activeProvider === 'openai') {
        saveGlobalConfig({ openai_model: chosenModel });
        process.env.OPENAI_MODEL = chosenModel;
      } else {
        saveGlobalConfig({ openrouter_model: chosenModel });
        process.env.OPENROUTER_MODEL = chosenModel;
      }
      console.log('\n' + formatStatusIndicator({
        status: 'online',
        label: `Active model saved to global config: ${theme.colors.cyan(chosenModel)}\n`,
      }));
    }
  } else if (action === 'logout') {
    saveGlobalConfig({
      openrouter_api_key: null,
      openai_api_key: null,
      agentrouter_api_key: null,
      omniroute_api_key: null,
    });
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AGENTROUTER_API_KEY;
    console.log('\n' + formatStatusIndicator({
      status: 'warning',
      label: 'API credentials removed from local config. Running in static mode.\n',
    }));
  }

  process.exit(0);
}

module.exports = {
  getGlobalConfigDir,
  getGlobalConfigPath,
  readGlobalConfig,
  saveGlobalConfig,
  loadGlobalConfig,
  maskApiKey,
  promptInput,
  ensureAuth,
  handleAuthCommand,
};
