/**
 * CodeSentry Interactive Select Component
 *
 * Usage:
 *   const { Select } = require('./components/select');
 *   // or import { Select } from './components/select';
 *
 *   await Select({
 *     label: 'Select AI Model',
 *     options: [
 *       { label: 'Laguna S 2.1', value: 'poolside/laguna-s-2.1:free', description: 'Fast & accurate code reasoning' },
 *       { label: 'Nemotron 3 Ultra', value: 'nvidia/nemotron-3-ultra-550b-a55b:free', description: 'Deep DevSecOps analysis' },
 *       ...
 *     ],
 *     onSelect: (item) => console.log(item),
 *   });
 */

'use strict';

const readline = require('node:readline');
const theme = require('../theme');

/**
 * Normalizes options to { label, value, description, badge }
 */
function normalizeOptions(options) {
  return options.map((opt) => {
    if (typeof opt === 'string') {
      return { label: opt, value: opt, description: '', badge: '' };
    }
    return {
      label: opt.label || opt.name || String(opt.value),
      value: opt.value !== undefined ? opt.value : opt.label,
      description: opt.description || opt.desc || '',
      badge: opt.badge || '',
      disabled: Boolean(opt.disabled),
    };
  });
}

/**
 * Render the select UI frame to ANSI string
 */
function renderSelectView({ label, items, activeIndex, width = 76, title = 'SELECTOR' }) {
  const c = theme.colors;
  const lines = [];

  if (label) {
    lines.push(`${c.cyan('◆')} ${c.brightWhite(theme.bold(label))}`);
    lines.push('');
  }

  items.forEach((item, index) => {
    const isActive = index === activeIndex;
    const bullet = isActive ? c.cyan('▸ (●)') : c.darkGray('  ( )');

    // Ensure label + badge fits on one line inside card
    const maxLabelLen = width - 16 - (item.badge ? item.badge.length + 4 : 0);
    let rawLabel = item.label;
    if (rawLabel.length > maxLabelLen && maxLabelLen > 20) {
      rawLabel = rawLabel.slice(0, maxLabelLen - 1) + '…';
    }

    const labelText = isActive
      ? c.brightWhite(theme.bold(rawLabel))
      : item.disabled
      ? c.darkGray(rawLabel + ' (disabled)')
      : c.lightGray(rawLabel);

    const badgeText = item.badge
      ? ` ${c.cyan(theme.pill(item.badge, 'cyan'))}`
      : '';

    lines.push(`  ${bullet} ${labelText}${badgeText}`);
    if (item.description) {
      lines.push(`        ${c.gray(item.description)}`);
    }
  });

  const cardContent = theme.card(lines, {
    title: c.cyan(theme.bold(title)),
    rightTitle: c.gray(`${activeIndex + 1}/${items.length}`),
    width,
  });

  const hints = theme.hintLine(
    ['[Tab/↑/↓] Navigate', '[Enter] Select', '[Esc] Close', '[Ctrl+C] Exit'],
    width
  );

  return `${cardContent}\n${hints}\n`;
}

/**
 * Interactive Select Prompt (runs in terminal raw mode)
 */
function Select(props = {}) {
  const {
    label = 'Select an option',
    options = [],
    items = options,
    title = 'SELECTOR',
    onSelect = null,
    defaultIndex = 0,
    width = 76,
  } = props;

  const normalized = normalizeOptions(items);
  if (normalized.length === 0) {
    if (onSelect) onSelect(null);
    return Promise.resolve(null);
  }

  // If not running in an interactive TTY, return default immediately
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const selected = normalized[defaultIndex] || normalized[0];
    if (onSelect) onSelect(selected.value);
    return Promise.resolve(selected.value);
  }

  return new Promise((resolve) => {
    let activeIndex = Math.max(
      0,
      Math.min(defaultIndex, normalized.length - 1)
    );
    let previousLineCount = 0;

    // Ensure raw mode is enabled
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch {}

    // Hide cursor
    process.stdout.write('\x1b[?25l');

    function erasePrevious() {
      if (previousLineCount > 0) {
        // Move cursor up previousLineCount lines and clear
        process.stdout.write(`\x1b[${previousLineCount}A\r\x1b[0J`);
      }
    }

    function render() {
      erasePrevious();
      const output = renderSelectView({
        label,
        items: normalized,
        activeIndex,
        title,
        width,
      });
      previousLineCount = output.split('\n').length - 1;
      process.stdout.write(output);
    }

    function cleanup() {
      try {
        process.stdin.removeListener('keypress', onKeypress);
        if (process.stdin.setRawMode && !wasRaw) {
          process.stdin.setRawMode(false);
        }
      } catch {}
      // Show cursor again
      process.stdout.write('\x1b[?25h');
    }

    function onKeypress(str, key) {
      if (!key) return;

      // Ctrl+C
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.stdout.write('\n');
        process.exit(0);
      }

      // Escape -> close menu without selection
      if (key.name === 'escape') {
        cleanup();
        erasePrevious();
        if (onSelect) onSelect(null);
        resolve(null);
        return;
      }

      // Shift+Tab or Up arrow or 'k'
      if ((key.name === 'tab' && key.shift) || key.name === 'up' || key.name === 'k') {
        let next = activeIndex - 1;
        if (next < 0) next = normalized.length - 1;
        while (normalized[next].disabled && next !== activeIndex) {
          next--;
          if (next < 0) next = normalized.length - 1;
        }
        activeIndex = next;
        render();
        return;
      }

      // Tab or Down arrow or 'j'
      if (key.name === 'tab' || key.name === 'down' || key.name === 'j') {
        let next = activeIndex + 1;
        if (next >= normalized.length) next = 0;
        while (normalized[next].disabled && next !== activeIndex) {
          next++;
          if (next >= normalized.length) next = 0;
        }
        activeIndex = next;
        render();
        return;
      }

      // Enter
      if (key.name === 'return' || key.name === 'enter') {
        const selected = normalized[activeIndex];
        cleanup();
        erasePrevious();
        if (onSelect) {
          onSelect(selected.value);
        }
        resolve(selected.value);
      }
    }

    process.stdin.on('keypress', onKeypress);
    render();
  });
}

/**
 * Post-Scan Tab-Triggered Action Prompt
 *
 * Displays a clean prompt bar inviting the user to press [Tab] to reveal the dropdown actions.
 * Only opens the interactive Select dropdown when [Tab] is pressed in the terminal.
 */
function promptActionOnTab({
  selectProps = {},
  defaultAction = 'rescan',
  rightTitle = 'press Tab for menu',
  summaryLabel = null,
} = {}) {
  // If not running in an interactive TTY, return default immediately
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(defaultAction);
  }

  return new Promise((resolve) => {
    const c = theme.colors;
    let previousLineCount = 0;

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch {}

    process.stdout.write('\x1b[?25l');

    function eraseBar() {
      if (previousLineCount > 0) {
        process.stdout.write(`\x1b[${previousLineCount}A\r\x1b[0J`);
        previousLineCount = 0;
      }
    }

    function renderBar() {
      eraseBar();
      const lines = [];
      const promptLine = `  ${c.cyan('⌨')}  ${c.brightWhite(theme.bold('Press [Tab]'))} ${c.lightGray('to open Actions & Fixes')}   ${c.darkGray('·')}   ${c.brightWhite(theme.bold('[Enter]'))} ${c.lightGray('Rescan')}   ${c.darkGray('·')}   ${c.darkGray('[q] Exit')}`;
      lines.push(promptLine);
      if (summaryLabel) {
        lines.push(`     ${c.gray(summaryLabel)}`);
      }

      const barCard = theme.card(lines, {
        title: c.cyan(theme.bold('READY')),
        rightTitle: c.gray(rightTitle),
        width: selectProps.width || 76,
      });

      const output = `\n${barCard}\n`;
      previousLineCount = output.split('\n').length - 1;
      process.stdout.write(output);
    }

    function cleanup() {
      try {
        process.stdin.removeListener('keypress', onKeypress);
        if (process.stdin.setRawMode && !wasRaw) {
          process.stdin.setRawMode(false);
        }
      } catch {}
      process.stdout.write('\x1b[?25h');
    }

    async function openDropdown() {
      cleanup();
      eraseBar();

      // Launch full Select dropdown
      const choice = await Select({
        ...selectProps,
      });

      // If user closed with Esc (choice === null), re-render the waiting bar
      if (choice === null) {
        readline.emitKeypressEvents(process.stdin);
        try {
          process.stdin.setRawMode(true);
        } catch {}
        process.stdout.write('\x1b[?25l');
        process.stdin.on('keypress', onKeypress);
        renderBar();
        return;
      }

      resolve(choice);
    }

    function onKeypress(str, key) {
      if (!key) return;

      // Ctrl+C or 'q' to exit
      if ((key.ctrl && key.name === 'c') || key.name === 'q') {
        cleanup();
        eraseBar();
        process.stdout.write('\n');
        process.exit(0);
      }

      // Tab -> Open the dropdown menu!
      if (key.name === 'tab') {
        openDropdown();
        return;
      }

      // Enter -> Direct rescan
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        eraseBar();
        resolve(defaultAction);
        return;
      }

      // 'f' or 'F' -> Fast Auto-Fix shortcut
      if (str === 'f' || str === 'F') {
        cleanup();
        eraseBar();
        resolve('apply_improvements');
        return;
      }

      // 'r' or 'R' -> Fast Rescan shortcut
      if (str === 'r' || str === 'R') {
        cleanup();
        eraseBar();
        resolve('rescan');
        return;
      }
    }

    process.stdin.on('keypress', onKeypress);
    renderBar();
  });
}

// Attach static helper for Promise usage
Select.prompt = Select;

module.exports = {
  Select,
  promptActionOnTab,
  normalizeOptions,
  renderSelectView,
};
