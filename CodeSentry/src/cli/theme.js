/**
 * CodeSentry Aesthetic Theme & Typography Engine
 *
 * Features:
 * - 3D block pixel typography header with drop shadow (Horizontally Centered)
 * - True Deep Black background cards (ANSI 48;2;14;14;18m solid fill)
 * - Electric cyan and severity-coded left accent bars (▎)
 * - Dark-tinted pill badges ([ HIGH ], [ SECURITY ], [ AI TRIAGE ])
 * - Source code snippet context cards with active line marker
 * - Perfectly centered cards & hint lines matching viewport
 * - Automatic ANSI truecolor support with graceful fallback
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ── Color Detection ──────────────────────────────────────────────────────────
const isColorSupported = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === '2' || process.env.FORCE_COLOR === '3') return true;
  if (process.env.WT_SESSION || process.env.VSCODE_PID || process.env.COLORTERM) return true;
  if (process.env.TERM && process.env.TERM !== 'dumb') return true;
  if (process.stdout && process.stdout.isTTY) return true;
  if (process.env.CI) return true;
  return false;
})();

// ── ANSI Escape Generators ───────────────────────────────────────────────────
const esc = (code) => (isColorSupported ? `\x1b[${code}` : '');
const reset = esc('0m');

// Text styles
const bold = (s) => `${esc('1m')}${s}${reset}`;
const dim = (s) => `${esc('2m')}${s}${reset}`;
const italic = (s) => `${esc('3m')}${s}${reset}`;
const underline = (s) => `${esc('4m')}${s}${reset}`;

// 24-bit Truecolor foreground & background
const fgRgb = (r, g, b) => (s) => `${esc(`38;2;${r};${g};${b}m`)}${s}${reset}`;
const bgRgb = (r, g, b) => (s) => `${esc(`48;2;${r};${g};${b}m`)}${s}${reset}`;

// ── CodeSentry Palette ─────────────────────────────────────────────────────────
const colors = {
  // Brand / Accents
  cyan: fgRgb(56, 189, 248),        // #38bdf8 electric cyan
  sky: fgRgb(14, 165, 233),         // #0ea5e9
  blue: fgRgb(96, 165, 250),        // #60a5fa
  teal: fgRgb(45, 212, 191),        // #2dd4bf
  purple: fgRgb(192, 132, 252),     // #c084fc
  magenta: fgRgb(217, 70, 239),    // #d946ef

  // Grayscale & Typography
  white: fgRgb(244, 244, 245),      // #f4f4f5 zinc-100
  brightWhite: fgRgb(255, 255, 255),// #ffffff
  lightGray: fgRgb(161, 161, 170),  // #a1a1aa zinc-400
  gray: fgRgb(113, 113, 122),       // #71717a zinc-500
  darkGray: fgRgb(63, 63, 70),      // #3f3f46 zinc-700
  charcoal: fgRgb(39, 39, 42),      // #27272a zinc-800

  // Status & Severities
  green: fgRgb(52, 211, 153),       // #34d399 emerald
  yellow: fgRgb(251, 191, 36),      // #fbbf24 amber
  orange: fgRgb(251, 146, 60),      // #fb923c orange
  red: fgRgb(248, 113, 113),        // #f87171 rose-red
  rose: fgRgb(244, 63, 94),         // #f43f5e

  // Card Background: deep black / near-black container fill
  cardBgCode: esc('48;2;14;14;18m'),
};

// ── ANSI Utilities & Centering ───────────────────────────────────────────────
function stripAnsi(str) {
  return String(str || '')
    .replace(/\x1b\]8;;[^\x1b\x07]*(\x1b\\|\x07)/g, '') // OSC 8 hyperlink tags
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')   // OSC commands
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')            // CSI sequences
    .replace(/\x1b[=><]/g, '');
}

function createClickableLink(targetPath, text = null) {
  const displayText = text || targetPath;
  if (!isColorSupported) return displayText;
  try {
    const absPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
    const normalized = absPath.replace(/\\/g, '/');
    const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
    // OSC 8 escape sequence for terminal clickable link (supported by VS Code, Windows Terminal, iTerm)
    return `\x1b]8;;${fileUrl}\x1b\\${displayText}\x1b]8;;\x1b\\`;
  } catch {
    return displayText;
  }
}

function visibleWidth(str) {
  return stripAnsi(str).length;
}

function getTerminalWidth() {
  const cols = process.stdout && process.stdout.columns ? process.stdout.columns : 80;
  return Math.max(80, cols);
}

function center(text, termWidth = getTerminalWidth()) {
  const lines = text.split('\n');
  return lines.map(line => {
    const w = visibleWidth(line);
    if (w >= termWidth) return line;
    const pad = Math.floor((termWidth - w) / 2);
    return ' '.repeat(pad) + line;
  }).join('\n');
}

// ── CodeSentry 3D Pixel Typography Header (Centered) ───────────────────────────
/**
 * Renders the CodeSentry logo in chunky pixel-art typography with a
 * shaded drop shadow, centered horizontally.
 */
function renderLogo() {
  const termWidth = getTerminalWidth();

  if (!isColorSupported) {
    const plainLogo = [
      '==================================================',
      '                   CODESENTRY                     ',
      '==================================================',
    ].join('\n');
    return center(plainLogo, termWidth);
  }

  const w = colors.brightWhite;
  const c = colors.cyan;
  const s = colors.darkGray;
  const g = colors.gray;

  const line1 =
    w(' █▀▀█ █▀▀█ █▀▀▄ █▀▀ ') +
    c('█▀▀█ ') +
    w('█▀▀ █▄ █ ▀█▀ █▀▀█ █  █');

  const line2 =
    w(' █    █  █ █  █ █▀▀ ') +
    c(' ▀▀▄ ') +
    w('█▀▀ █ ▀█  █  █▄▄▀ ▀▄▄█');

  const line3 =
    w(' ▀▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀ ') +
    c('▀▀▀▀ ') +
    w('▀▀▀ ▀  ▀  ▀  ▀  ▀  ▄▄█');

  const line4 =
    s('  ▀▀   ▀▀   ▀▀   ▀▀   ▀▀   ▀▀  ▀▀  ▀▀  ▀▀   ▀▀');

  const subtitle =
    g('DevSecOps & AI Code Inspection Engine') +
    s('  ·  ') +
    c('v0.1.0');

  const logoLines = ['', line1, line2, line3, line4, '', subtitle, ''];
  return logoLines.map(line => {
    const len = visibleWidth(line);
    const pad = Math.max(0, Math.floor((termWidth - len) / 2));
    return ' '.repeat(pad) + line;
  }).join('\n');
}

// ── Pill Badges ──────────────────────────────────────────────────────────────
function pill(text, variant = 'gray') {
  if (!isColorSupported) return `[${text}]`;

  const configs = {
    blocker: { bg: [136, 19, 55],  fg: [254, 205, 211] }, // deep rose bg + pink fg
    high:    { bg: [124, 45, 18],  fg: [254, 215, 170] }, // deep orange bg + peach fg
    medium:  { bg: [113, 63, 18],  fg: [254, 240, 138] }, // deep amber bg + yellow fg
    low:     { bg: [12, 74, 110],  fg: [186, 230, 253] }, // deep sky bg + cyan fg
    info:    { bg: [39, 39, 42],   fg: [228, 228, 231] }, // zinc bg + light zinc fg
    pass:    { bg: [6, 78, 59],    fg: [167, 243, 208] }, // deep emerald bg + mint fg
    warn:    { bg: [113, 63, 18],  fg: [254, 240, 138] },
    fail:    { bg: [136, 19, 55],  fg: [254, 205, 211] },
    cyan:    { bg: [8, 51, 68],    fg: [186, 230, 253] },
    purple:  { bg: [88, 28, 135],  fg: [243, 232, 255] },
    gray:    { bg: [39, 39, 42],   fg: [212, 212, 216] },
  };

  const cfg = configs[variant.toLowerCase()] || configs.gray;
  const bg = bgRgb(cfg.bg[0], cfg.bg[1], cfg.bg[2]);
  const fg = fgRgb(cfg.fg[0], cfg.fg[1], cfg.fg[2]);

  return bg(fg(` ${text} `));
}

function severityBadge(severity) {
  const sev = (severity || 'INFO').toUpperCase();
  const variants = {
    BLOCKER: 'blocker',
    HIGH:    'high',
    MEDIUM:  'medium',
    LOW:     'low',
    INFO:    'info',
  };
  return pill(sev, variants[sev] || 'info');
}

function categoryBadge(category) {
  const cat = (category || 'bugs').toLowerCase();
  const variants = {
    security:   'purple',
    bugs:       'high',
    efficiency: 'cyan',
    resources:  'low',
  };
  return pill(cat.toUpperCase(), variants[cat] || 'gray');
}

function getSeverityColor(severity) {
  const sev = (severity || 'INFO').toUpperCase();
  switch (sev) {
    case 'BLOCKER': return colors.red;
    case 'HIGH':    return colors.orange;
    case 'MEDIUM':  return colors.yellow;
    case 'LOW':     return colors.cyan;
    default:        return colors.gray;
  }
}

// ── Word Wrapping ────────────────────────────────────────────────────────────
function wrapText(str, maxWidth) {
  if (visibleWidth(str) <= maxWidth) return [str];

  // Only bypass word-wrapping for standalone file URLs / report paths
  if (str.includes('■ File') || str.includes('■ Path') || str.includes('■ Report') || str.startsWith('file:///')) {
    return [str];
  }

  const words = str.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (visibleWidth(testLine) <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      if (visibleWidth(word) > maxWidth) {
        let remainder = word;
        while (visibleWidth(remainder) > maxWidth) {
          lines.push(remainder.slice(0, maxWidth));
          remainder = remainder.slice(maxWidth);
        }
        currentLine = remainder;
      } else {
        currentLine = word;
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ── CodeSentry Dark Container / Card (Centered + Solid Black Fill) ─────────────
function card(lines, options = {}) {
  const {
    accentColor = colors.cyan,
    borderColor = colors.darkGray,
    title = '',
    rightTitle = '',
    width: requestedWidth,
  } = options;

  const termWidth = getTerminalWidth();

  // Defensive flattening: split any line containing \n so borders never misalign
  const flattened = (lines || []).flatMap(l => String(l || '').split('\n'));

  // Clean compact 72-column standard width
  const defaultWidth = 72;
  const targetWidth = requestedWidth || defaultWidth;
  const width = Math.max(40, Math.min(termWidth - 2, targetWidth));

  const leftIndent = ' '.repeat(Math.max(0, Math.floor((termWidth - width) / 2)));

  if (!isColorSupported) {
    const divider = leftIndent + '─'.repeat(width);
    return [
      divider,
      title ? `${leftIndent} ${title}` : '',
      ...flattened.map(l => leftIndent + l),
      divider,
    ].filter(Boolean).join('\n');
  }

  const border = (char) => borderColor(char);
  const bar = accentColor('▎');
  const cardBg = colors.cardBgCode;

  const result = [];

  // Top border with optional title
  const topTitle = title ? ` ${title} ` : '';
  const rightBadge = rightTitle ? ` ${rightTitle} ` : '';
  const titleLen = visibleWidth(topTitle);
  const rightLen = visibleWidth(rightBadge);
  const middleFill = Math.max(0, width - 4 - titleLen - rightLen);

  const topBorder =
    leftIndent +
    border('╭─') +
    topTitle +
    border('─'.repeat(middleFill)) +
    rightBadge +
    border('─╮');
  result.push(topBorder);

  // Expand lines with word wrapping
  const maxContentWidth = width - 6;
  const wrappedLines = [];
  for (const l of flattened) {
    if (visibleWidth(l) > maxContentWidth) {
      wrappedLines.push(...wrapText(l, maxContentWidth));
    } else {
      wrappedLines.push(l);
    }
  }

  // Content lines with monospace padding AND persistent deep black background
  for (const rawLine of wrappedLines) {
    const cleanWidth = visibleWidth(rawLine);
    const pad = Math.max(0, maxContentWidth - cleanWidth);
    const innerContent = ` ${bar} ${rawLine}${' '.repeat(pad)} `;

    // Re-apply background after any inner \x1b[0m reset code to guarantee solid black fill
    const styledInner = cardBg + innerContent.replace(/\x1b\[0m/g, reset + cardBg) + reset;
    result.push(leftIndent + border('│') + styledInner + border('│'));
  }

  // Bottom border
  const bottomBorder = leftIndent + border('╰' + '─'.repeat(width - 2) + '╯');
  result.push(bottomBorder);

  return result.join('\n');
}

// ── Status Bar / Hint Line (Centered) ────────────────────────────────────────
function hintLine(hints = [], width = 76) {
  const termWidth = getTerminalWidth();
  const text = hints.filter(Boolean).join('   ');
  const pad = Math.max(0, Math.floor((termWidth - visibleWidth(text)) / 2));
  return colors.gray(' '.repeat(pad) + text);
}

// ── Progress Bar Gauge ───────────────────────────────────────────────────────
function progressBar(value, max = 100, length = 20) {
  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * length);
  const empty = length - filled;

  let barColor = colors.green;
  if (value < 60) barColor = colors.red;
  else if (value < 80) barColor = colors.yellow;

  if (!isColorSupported) {
    return `[${'#'.repeat(filled)}${'-'.repeat(empty)}] ${value}/${max}`;
  }

  const filledBar = barColor('█'.repeat(filled));
  const emptyBar = colors.charcoal('░'.repeat(empty));

  return `${filledBar}${emptyBar} ${bold(colors.white(`${value}/${max}`))}`;
}

// ── Code Snippet Extraction ───────────────────────────────────────────────────
function getCodeSnippet(filePath, targetLine, radius = 2) {
  if (!filePath || !targetLine || typeof targetLine !== 'number') return null;
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(absPath)) return null;
    const content = fs.readFileSync(absPath, 'utf-8');
    const allLines = content.split(/\r?\n/);
    const startIdx = Math.max(0, targetLine - 1 - radius);
    const endIdx = Math.min(allLines.length, targetLine + radius);

    const lines = [];
    for (let i = startIdx; i < endIdx; i++) {
      const lineNum = i + 1;
      const isTarget = lineNum === targetLine;
      const text = allLines[i];
      lines.push({ lineNum, isTarget, text });
    }
    return lines;
  } catch {
    return null;
  }
}

// ── CodeSentry Header Session Card ─────────────────────────────────────────────
function renderSessionCard(projectPath, options = {}) {
  const { aiModel = 'auto', languages = [] } = options;
  const langStr = languages.length > 0 ? languages.join(' · ') : 'auto-detect';

  // Format path gracefully so it stays on one neat line
  const displayPath = visibleWidth(projectPath) > 50
    ? '...' + projectPath.slice(-47)
    : projectPath;

  const lines = [
    `${colors.gray('■ Target ')} ${colors.brightWhite(displayPath)}`,
    `${colors.gray('■ Engines')} ${colors.white('Ruff')} ${colors.darkGray('·')} ${colors.white('Bandit')} ${colors.darkGray('·')} ${colors.white('Semgrep')} ${colors.darkGray('·')} ${colors.white('Custom')}`,
    `${colors.gray('■ AI     ')} ${colors.cyan('OpenRouter')} ${colors.darkGray('·')} ${colors.white(aiModel)} ${colors.green('● active')}`,
  ];

  const renderedCard = card(lines, {
    title: colors.cyan(bold('SESSION')),
    rightTitle: colors.gray(langStr),
  });

  const hints = hintLine(['--no-ai fast mode', '--report-file <path>', 'codesentry --help'], 88);

  return [renderedCard, hints].join('\n');
}

function applyBlackTerminalBackground() {
  if (!isColorSupported) return;
  try {
    // OSC 11 sets the window/terminal background color to deep black (#0c0c0e) in Windows Terminal, VS Code, iTerm, etc.
    process.stdout.write('\x1b]11;#0c0c0e\x07');
    // Set standard ANSI background to Black (40)
    process.stdout.write('\x1b[40m');
  } catch {}
}

module.exports = {
  isColorSupported,
  colors,
  bold,
  dim,
  italic,
  underline,
  stripAnsi,
  createClickableLink,
  visibleWidth,
  getTerminalWidth,
  center,
  renderLogo,
  pill,
  severityBadge,
  categoryBadge,
  getSeverityColor,
  card,
  hintLine,
  progressBar,
  getCodeSnippet,
  renderSessionCard,
  applyBlackTerminalBackground,
};
