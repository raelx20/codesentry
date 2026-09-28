/**
 * Fixer Module Entry Point
 */

'use strict';

const { formatDiffPreview } = require('./diff');
const {
  getLineWindow,
  isCodeLine,
  getTargetLine,
  sortPythonImportsInContent,
  postProcessPythonFile,
  generateRuleFix,
} = require('./rules');
const {
  validateSyntax,
  applySnippetToContent,
  applyFixToFile,
} = require('./apply');
const {
  generateFix,
  batchFixFile,
} = require('./batch');

module.exports = {
  generateRuleFix,
  generateFix,
  formatDiffPreview,
  applySnippetToContent,
  applyFixToFile,
  batchFixFile,
  validateSyntax,
  getLineWindow,
  isCodeLine,
  getTargetLine,
  sortPythonImportsInContent,
  postProcessPythonFile,
};
