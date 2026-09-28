/**
 * CodeSentry RepoMap: Architectural Context & Component Extractor
 *
 * Extracts architecture components (routes, controllers, sinks, exports)
 * and caches results in ~/.codesentry/repo-map.json keyed by file mtimes
 * to ensure 0ms latency on repeat scans.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CACHE_DIR = path.join(os.homedir(), '.codesentry');
const CACHE_FILE = path.join(CACHE_DIR, 'repo-map.json');

/**
 * Extracts architectural components from a single file's content.
 *
 * @param {string} file - Relative file path
 * @param {string} content - File text content
 * @returns {Array<{ id: string, type: string, label: string, file: string, line: number, details?: string }>}
 */
function extractComponents(file, content) {
  if (!content || typeof content !== 'string') return [];
  const components = [];
  const lines = content.split('\n');
  const ext = path.extname(file).toLowerCase();
  const isPy = ext === '.py' || ext === '.pyw';

  const exportsList = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // 1. Detect HTTP Entrypoints
    const routeMatch = line.match(/(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/i) ||
                       line.match(/@(?:app|blueprint|router)\.route\(\s*['"]([^'"]+)['"]/i);
    if (routeMatch) {
      const method = (routeMatch[1] || 'GET').toUpperCase();
      const routePath = routeMatch[2] || routeMatch[1];
      components.push({
        id: `entry-${file}-${lineNum}`,
        type: 'ENTRYPOINT',
        label: `${method} ${routePath}`,
        file,
        line: lineNum,
      });
    }

    // 2. Detect Controllers / Route Handlers
    if (/(?:function\s+\w+Controller|class\s+\w+(?:Controller|View|Handler)|def\s+\w+_view|def\s+\w+_controller)/i.test(line)) {
      const match = line.match(/(?:function|class|def)\s+([a-zA-Z0-9_]+)/);
      if (match) {
        components.push({
          id: `ctrl-${file}-${lineNum}`,
          type: 'CONTROLLER',
          label: match[1],
          file,
          line: lineNum,
        });
      }
    }

    // 3. Detect Database Sinks
    if (/db\.(?:query|execute|run|collection|find)|cursor\.execute|Session\.query|prisma\.\w+\.(?:find|create|update|delete)|mongoose\.model/i.test(line)) {
      components.push({
        id: `dbsink-${file}-${lineNum}`,
        type: 'DATA_SINK',
        label: 'Database Sink',
        file,
        line: lineNum,
      });
    }

    // 4. Detect Shell / Execution Sinks
    if (/child_process|exec\(|eval\(|subprocess\.(?:run|Popen|call)|os\.system/i.test(line)) {
      components.push({
        id: `execsink-${file}-${lineNum}`,
        type: 'EXEC_SINK',
        label: 'Dynamic Code/Shell Sink',
        file,
        line: lineNum,
      });
    }

    // 5. Detect AI / LLM Invocations
    if (/openai\.|anthropic\.|openrouter|chat\.completions|llm\.predict|transformers\./i.test(line)) {
      components.push({
        id: `aisink-${file}-${lineNum}`,
        type: 'AI_SINK',
        label: 'LLM Prompt Call',
        file,
        line: lineNum,
      });
    }

    // 6. Detect Exports
    if (!isPy) {
      const modExpMatch = line.match(/module\.exports\s*=\s*(?:\{([^}]+)\}|([a-zA-Z0-9_]+))/);
      if (modExpMatch) {
        if (modExpMatch[1]) {
          modExpMatch[1].split(',').forEach(s => {
            const sym = s.trim().split(':')[0].trim();
            if (sym) exportsList.push(sym);
          });
        } else if (modExpMatch[2]) {
          exportsList.push(modExpMatch[2]);
        }
      }
      const esExpMatch = line.match(/export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([a-zA-Z0-9_]+)/);
      if (esExpMatch && esExpMatch[1]) {
        exportsList.push(esExpMatch[1]);
      }
    } else {
      const pyFuncMatch = line.match(/^def\s+([a-zA-Z0-9_]+)\s*\(/);
      if (pyFuncMatch && !pyFuncMatch[1].startsWith('_')) {
        exportsList.push(pyFuncMatch[1]);
      }
      const pyClassMatch = line.match(/^class\s+([a-zA-Z0-9_]+)/);
      if (pyClassMatch && !pyClassMatch[1].startsWith('_')) {
        exportsList.push(pyClassMatch[1]);
      }
    }
  }

  if (exportsList.length > 0) {
    components.push({
      id: `exports-${file}`,
      type: 'EXPORTS',
      label: [...new Set(exportsList)].slice(0, 8).join(', '),
      file,
      line: 1,
    });
  }

  return components;
}

class RepoMap {
  constructor(customCachePath = null) {
    this.cachePath = customCachePath || CACHE_FILE;
    this.fileComponents = new Map(); // relPath -> Component[]
    this.cache = this._loadCache();
  }

  _loadCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && parsed.files ? parsed : { version: 1, files: {} };
      }
    } catch {}
    return { version: 1, files: {} };
  }

  _saveCache() {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(this.cachePath, 0o600);
      } catch {}
    } catch {}
  }

  /**
   * Builds the component map across project files with incremental mtime caching.
   *
   * @param {string[]} files - List of relative file paths
   * @param {string} projectPath - Root directory
   */
  build(files = [], projectPath = '') {
    this.fileComponents.clear();
    let cacheUpdated = false;

    for (const relPath of files) {
      const fullPath = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
      let mtime = 0;
      try {
        const stat = fs.statSync(fullPath);
        mtime = Math.floor(stat.mtimeMs);
      } catch {
        continue;
      }

      const cached = this.cache.files[relPath];
      if (cached && cached.mtime === mtime && Array.isArray(cached.components)) {
        this.fileComponents.set(relPath, cached.components);
        continue;
      }

      // Rebuild for modified or new file
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const components = extractComponents(relPath, content);
        this.fileComponents.set(relPath, components);
        this.cache.files[relPath] = { mtime, components };
        cacheUpdated = true;
      } catch {}
    }

    if (cacheUpdated) {
      this._saveCache();
    }

    return this.fileComponents;
  }

  /**
   * Renders the architecture map into ~15-30 compact lines.
   *
   * @param {number} [maxLines=30]
   * @returns {string} Compact text summary
   */
  toSummary(maxLines = 30) {
    if (this.fileComponents.size === 0) {
      return '';
    }

    const lines = [];
    lines.push('Architectural Component Map:');

    for (const [file, components] of this.fileComponents.entries()) {
      if (!components || components.length === 0) continue;

      const types = [];
      let exportsStr = '';

      for (const c of components) {
        if (c.type === 'EXPORTS') {
          exportsStr = c.label;
        } else {
          types.push(`${c.type}: ${c.label}`);
        }
      }

      if (types.length === 0 && !exportsStr) continue;

      const desc = types.length > 0 ? `[${types.slice(0, 3).join(' · ')}]` : '';
      const expDesc = exportsStr ? ` -> exports: ${exportsStr}` : '';
      lines.push(`- ${file} ${desc}${expDesc}`);

      if (lines.length >= maxLines) break;
    }

    return lines.join('\n');
  }
}

module.exports = {
  extractComponents,
  RepoMap,
};
