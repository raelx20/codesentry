/**
 * CodeSentry Automated Code Repair & Improvement Engine
 *
 * Modular facade re-exporting from ./fixer/
 * - fixer/diff.js: Diff formatting and colorized preview cards
 * - fixer/rules.js: Deterministic AST & regex-based rule transformations
 * - fixer/apply.js: Safe snippet replacement, syntax validation & AutoSandbox execution
 * - fixer/batch.js: Multi-issue batch repair loop & model-fallback orchestrator
 */

'use strict';

module.exports = require('./fixer/index');
