/**
 * Static Analyzer Availability Cache
 *
 * Caches tool availability detection once per scan session to avoid
 * repeated shell executions (`npx`, `python`, `pip`) on every run or per file type.
 */

'use strict';

// In-memory availability cache keyed by tool identifier
const availabilityCache = new Map();

/**
 * Returns the current cache map (for inspection or debugging).
 */
function getAvailabilityCache() {
  return availabilityCache;
}

/**
 * Clears the availability cache (e.g., between distinct sessions or in tests).
 */
function clearAvailabilityCache() {
  availabilityCache.clear();
}

/**
 * Checks and caches a tool's availability.
 * If already checked in this session, returns the cached result immediately.
 * Concurrency-safe: caches the inflight Promise so concurrent checks don't spawn duplicate processes.
 *
 * @param {string} toolName - Name of the tool (e.g. 'eslint', 'bandit', 'ruff', 'semgrep', 'typescript')
 * @param {Function} checkFn - Async function returning boolean
 * @param {Object} [options] - Options
 * @param {boolean} [options.forceCheck=false] - If true, bypasses cache and re-executes checkFn
 * @param {string} [options.cacheKey] - Custom cache key (e.g. including project path)
 * @returns {Promise<boolean>}
 */
async function checkCachedAvailability(toolName, checkFn, options = {}) {
  const cacheKey = options.cacheKey || toolName;
  const force = options.forceCheck === true;

  if (!force && availabilityCache.has(cacheKey)) {
    return availabilityCache.get(cacheKey);
  }

  // Store promise to avoid concurrent race conditions
  const checkPromise = Promise.resolve()
    .then(() => checkFn())
    .then((result) => Boolean(result))
    .catch(() => false);

  availabilityCache.set(cacheKey, checkPromise);

  const resolved = await checkPromise;
  // Replace promise with resolved boolean for clean memory
  availabilityCache.set(cacheKey, resolved);
  return resolved;
}

module.exports = {
  checkCachedAvailability,
  getAvailabilityCache,
  clearAvailabilityCache,
};
