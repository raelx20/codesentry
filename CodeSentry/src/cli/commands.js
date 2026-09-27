const COMMANDS = {
  SCAN: 'scan',
  DEPLOYGUARD: 'deployguard',
  AUTOGRAD: 'autograd',
  DEMO: 'demo',
  MODEL: 'model',
  AUTH: 'auth',
  LOGIN: 'login',
  VERSION: 'version',
  HELP: 'help',
};

const OPTIONS = {
  JSON: '--json',
  VERBOSE: '--verbose',
  SEVERITY: '--severity',
  CATEGORY: '--category',
  NO_AI: '--no-ai',
  AI_MODEL: '--ai-model',
  NO_REPORT: '--no-report',
  REPORT_FILE: '--report-file',
  FIX: '--fix',
  AUTO_FIX: '--auto-fix',
  YES: '--yes',
  GATE: '--gate',
  DEPLOYGUARD: '--deployguard',
  HELP: '--help',
  VERSION: '--version',
};

class CommandParser {
  constructor() {
    this.commands = COMMANDS;
    this.options = OPTIONS;
  }

  parse(args) {
    const result = {
      command: null,
      projectPath: null,
      options: {},
      errors: [],
    };

    if (!args || args.length === 0) {
      result.command = COMMANDS.HELP;
      return result;
    }

    let i = 0;
    
    // Parse command
    const command = args[i];
    if (command === COMMANDS.LOGIN || command === COMMANDS.AUTH) {
      result.command = COMMANDS.AUTH;
      i++;
    } else if (Object.values(COMMANDS).includes(command)) {
      result.command = command;
      i++;
    } else if (command.startsWith('-')) {
      // It's an option, default to scan command
      result.command = COMMANDS.SCAN;
    } else {
      result.command = COMMANDS.SCAN;
      result.projectPath = command;
      i++;
    }

    // Parse remaining arguments
    while (i < args.length) {
      const arg = args[i];
      
      if (arg === OPTIONS.JSON) {
        result.options.json = true;
        i++;
      } else if (arg === OPTIONS.VERBOSE) {
        result.options.verbose = true;
        i++;
      } else if (arg === OPTIONS.HELP || arg === '-h') {
        result.command = COMMANDS.HELP;
        i++;
      } else if (arg === OPTIONS.VERSION) {
        result.command = COMMANDS.VERSION;
        i++;
      } else if (arg === OPTIONS.FIX || arg === OPTIONS.AUTO_FIX || arg === '--fix' || arg === '--auto-fix') {
        result.options.fix = true;
        i++;
      } else if (arg === OPTIONS.YES || arg === '-y' || arg === '--yes') {
        result.options.yes = true;
        result.options.fix = true;
        i++;
      } else if (arg === OPTIONS.GATE || arg === '--gate') {
        result.options.gate = true;
        i++;
      } else if (arg === OPTIONS.DEPLOYGUARD || arg === '--deployguard') {
        result.options.deployguard = true;
        i++;
      } else if (arg === OPTIONS.SEVERITY) {
        if (i + 1 < args.length) {
          result.options.severity = args[i + 1];
          i += 2;
        } else {
          result.errors.push('Missing value for --severity');
          i++;
        }
      } else if (arg === OPTIONS.CATEGORY) {
        if (i + 1 < args.length) {
          result.options.category = args[i + 1];
          i += 2;
        } else {
          result.errors.push('Missing value for --category');
          i++;
        }
      } else if (arg === OPTIONS.NO_AI) {
        result.options.noAi = true;
        i++;
      } else if (arg === OPTIONS.AI_MODEL) {
        if (i + 1 < args.length) {
          result.options.aiModel = args[i + 1];
          i += 2;
        } else {
          result.errors.push('Missing value for --ai-model');
          i++;
        }
      } else if (arg === OPTIONS.NO_REPORT) {
        result.options.noReport = true;
        i++;
      } else if (arg === OPTIONS.REPORT_FILE) {
        if (i + 1 < args.length) {
          result.options.reportFile = args[i + 1];
          i += 2;
        } else {
          result.errors.push('Missing value for --report-file');
          i++;
        }
      } else if (!arg.startsWith('-') && !result.projectPath) {
        result.projectPath = arg;
        i++;
      } else if (!arg.startsWith('-') && result.projectPath) {
        // Support unquoted paths that contain spaces (e.g. "codesenty bt-")
        result.projectPath += ` ${arg}`;
        i++;
      } else {
        result.errors.push(`Unknown argument: ${arg}`);
        i++;
      }
    }

    // Default project path
    if (!result.projectPath && result.command === COMMANDS.SCAN) {
      result.projectPath = process.cwd();
    }

    return result;
  }

  validate(parsed) {
    const errors = [...parsed.errors];
    
    if (parsed.command === COMMANDS.SCAN) {
      if (!parsed.projectPath) {
        errors.push('Project path is required');
      }
      
      if (parsed.options.severity) {
        const validSeverities = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
        if (!validSeverities.includes(parsed.options.severity.toUpperCase())) {
          errors.push(`Invalid severity: "${parsed.options.severity}". Must be one of: ${validSeverities.join(', ')}`);
        }
      }
      
      if (parsed.options.category) {
        const validCategories = ['security', 'bugs', 'efficiency', 'resources'];
        if (!validCategories.includes(parsed.options.category.toLowerCase())) {
          errors.push(`Invalid category: "${parsed.options.category}". Must be one of: ${validCategories.join(', ')}`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getHelp() {
    return `
Usage: codesentry <command> [options]

Commands:
  scan [path]         Scan a project (defaults to current directory)
  deployguard [path]  Pre-deployment risk analysis & production readiness gate
  demo                Instant live hackathon showcase (AutoGrad, DeployGuard, ModelShield & Healing)
  model               Interactively switch or select the active AI model
  auth                Configure or view OpenRouter API key & credentials
  version             Show version
  help                Show this help message

AI analysis and Markdown report generation are ON by default.

Options:
  --json              Output results as JSON
  --verbose           Show detailed progress information
  --gate              CI/CD readiness gate (fails with exit code 1 if status is BLOCKED)
  --deployguard       Focus analysis on containers, CI/CD, and deployment configs
  --fix, --auto-fix   Automatically repair all detected issues across the codebase
  --yes, -y           Apply all automated fixes without manual approval prompts
  --severity <level>  Filter by severity (BLOCKER, HIGH, MEDIUM, LOW, INFO)
  --category <cat>    Filter by category (security, bugs, efficiency, resources)
  --ai-model <model>  Override the AI model (default: auto-selected)
  --report-file <path>  Set custom report output filename
  --no-ai             Disable AI-powered analysis
  --no-report         Disable Markdown report generation
  --help, -h          Show this help message
  --version           Show version

Examples:
  codesentry scan                                    Full scan with AI + report
  codesentry scan . --fix                            Auto-repair all issues in codebase
  codesentry scan . --fix --yes                      Auto-repair without any confirmation
  codesentry scan ./my-project                       Scan a specific project
  codesentry scan . --severity high                  Only show high+ findings
  codesentry scan . --category security              Security findings only
  codesentry scan . --ai-model deepseek/deepseek-chat  Use DeepSeek V3 code repair
  codesentry scan . --report-file audit.md           Custom report filename
  codesentry auth                                    Configure or view API credentials
  codesentry model                                   Switch AI model
  codesentry scan . --no-ai                          Fast scan, no AI
  codesentry scan . --no-ai --no-report              Static analysis only
  codesentry scan . --json                           Machine-readable output
`;
  }

  getVersion() {
    const pkg = require('../../package.json');
    return `codesentry v${pkg.version}`;
  }
}

function createCommandParser() {
  return new CommandParser();
}

module.exports = {
  COMMANDS,
  OPTIONS,
  CommandParser,
  createCommandParser,
};