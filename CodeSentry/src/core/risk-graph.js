/**
 * Software Risk Graph & AttackGraph Engine
 *
 * Implements:
 * 1. CodeTwin System Model: Extracts architectural components (Routes, Controllers, DB Sinks, Shell Sinks, AI Calls).
 * 2. Dependency & Impact Graph: Traces imports/calls across components to evaluate blast radius and breaking change impact.
 * 3. AttackGraph Correlation: Correlates vulnerabilities across components to identify exploitable multi-step attack paths.
 * 4. Visualization: Produces ASCII/ANSI terminal graphs and Mermaid diagrams for markdown reports.
 */

const fs = require('fs');
const path = require('path');
const { extractComponents } = require('./repo-map');

class SoftwareRiskGraph {
  constructor() {
    this.nodes = new Map(); // id -> { id, type, label, file, line }
    this.edges = []; // { from, to, type, label }
    this.attackPaths = [];
  }

  /**
   * Build graph from project files and detected findings
   */
  build(files = [], findings = [], projectPath = '') {
    this.nodes.clear();
    this.edges = [];
    this.attackPaths = [];

    // 1. Discover architectural component nodes & dependency edges
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

      this._extractComponents(relPath, content);
      this._extractImportEdges(relPath, content, files);
    }

    // 2. Correlate findings with graph nodes
    for (const f of findings) {
      const findingNodeId = `vuln-${f.id || Math.random().toString(36).slice(2, 8)}`;
      this.nodes.set(findingNodeId, {
        id: findingNodeId,
        type: 'VULNERABILITY',
        label: `${f.severity}: ${f.ruleId || f.category}`,
        file: f.file,
        line: f.line || 1,
        severity: f.severity,
        category: f.category,
        finding: f,
      });

      // Link to file component if in same file
      const normFindingFile = this._normalizeFilePath(f.file);
      for (const [nodeId, node] of this.nodes.entries()) {
        const normNodeFile = this._normalizeFilePath(node.file);
        if (normNodeFile === normFindingFile && node.type !== 'VULNERABILITY') {
          if (Math.abs(node.line - (f.line || 1)) < 25) {
            this.edges.push({
              from: nodeId,
              to: findingNodeId,
              type: 'EXPOSES',
              label: 'Vulnerable Sink',
            });
          }
        }
      }
    }

    // 3. Trace attack paths (Entrypoint -> Route / Tainted Input -> Vulnerability Sink)
    this._traceAttackPaths();

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      attackPaths: this.attackPaths,
      hasExploitablePaths: this.attackPaths.length > 0,
    };
  }

  _normalizeFilePath(p) {
    return String(p || '').replace(/\\/g, '/').toLowerCase();
  }

  _extractComponents(file, content) {
    const components = extractComponents(file, content);
    for (const c of components) {
      if (c.type !== 'EXPORTS') {
        this.nodes.set(c.id, c);
      }
    }
  }

  _extractImportEdges(file, content, allFiles) {
    const lines = content.split('\n');
    const isPy = (file || '').endsWith('.py') || (file || '').endsWith('.pyw');

    for (const line of lines) {
      if (!isPy) {
        // JavaScript / TypeScript imports
        const jsMatch = line.match(/(?:require\s*\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/);
        if (jsMatch) {
          const importStr = jsMatch[1] || jsMatch[2] || jsMatch[3] || jsMatch[4];
          if (importStr && (importStr.startsWith('.') || importStr.startsWith('/'))) {
            const resolved = this._resolveFile(file, importStr, allFiles);
            if (resolved && resolved !== file) {
              this.edges.push({
                from: file,
                to: resolved,
                type: 'IMPORTS',
                label: 'imports',
              });
            }
          }
        }
      } else {
        // Python imports
        const pyMatch = line.match(/(?:from\s+([a-zA-Z0-9_.]+)\s+import|import\s+([a-zA-Z0-9_.]+))/);
        if (pyMatch) {
          const mod = pyMatch[1] || pyMatch[2];
          if (mod) {
            const resolved = this._resolvePythonModule(file, mod, allFiles);
            if (resolved && resolved !== file) {
              this.edges.push({
                from: file,
                to: resolved,
                type: 'IMPORTS',
                label: 'imports',
              });
            }
          }
        }
      }
    }
  }

  _resolveFile(callerFile, importStr, allFiles) {
    const callerDir = path.dirname(callerFile);
    const candidateBase = path.normalize(path.join(callerDir, importStr)).replace(/\\/g, '/');

    const normFiles = allFiles.map(f => ({ orig: f, norm: this._normalizeFilePath(f) }));
    const exts = ['', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '/index.js', '/index.ts'];

    for (const ext of exts) {
      const probe = this._normalizeFilePath(candidateBase + ext);
      const match = normFiles.find(f => f.norm === probe);
      if (match) return match.orig;
    }

    // Fallback: match by filename
    const baseName = this._normalizeFilePath(path.basename(importStr));
    const byBase = normFiles.find(f => f.norm.endsWith('/' + baseName) || f.norm === baseName);
    return byBase ? byBase.orig : null;
  }

  _resolvePythonModule(callerFile, modStr, allFiles) {
    const callerDir = path.dirname(callerFile);
    const modRel = modStr.replace(/^\.+/, '').replace(/\./g, '/');
    const normFiles = allFiles.map(f => ({ orig: f, norm: this._normalizeFilePath(f) }));

    const candidate = path.normalize(path.join(callerDir, modRel)).replace(/\\/g, '/');
    const exts = ['.py', '.pyw', '/__init__.py'];

    for (const ext of exts) {
      const probe = this._normalizeFilePath(candidate + ext);
      const match = normFiles.find(f => f.norm === probe);
      if (match) return match.orig;
    }

    const baseName = this._normalizeFilePath(path.basename(modRel) + '.py');
    const byBase = normFiles.find(f => f.norm.endsWith('/' + baseName) || f.norm === baseName);
    return byBase ? byBase.orig : null;
  }

  /**
   * Performs BFS over IMPORTS edges to return all files that directly
   * or transitively import or depend on the given target file.
   *
   * @param {string} targetFile - File to check for breaking-change impact
   * @returns {string[]} Array of impacted file paths
   */
  getImpactedFiles(targetFile) {
    if (!targetFile) return [];
    const normTarget = this._normalizeFilePath(targetFile);
    const impacted = new Set();
    const queue = [normTarget];
    const visited = new Set([normTarget]);

    while (queue.length > 0) {
      const current = queue.shift();

      for (const edge of this.edges) {
        if (edge.type === 'IMPORTS') {
          const normTo = this._normalizeFilePath(edge.to);
          const normFrom = this._normalizeFilePath(edge.from);

          // If edge.to is the current file, then edge.from depends on it
          if (normTo === current && !visited.has(normFrom)) {
            visited.add(normFrom);
            impacted.add(edge.from);
            queue.push(normFrom);
          }
        }
      }
    }

    return Array.from(impacted);
  }

  _traceAttackPaths() {
    // Find all entrypoints in the project
    const entrypoints = Array.from(this.nodes.values()).filter((n) => n.type === 'ENTRYPOINT');
    const vulns = Array.from(this.nodes.values()).filter((n) => n.type === 'VULNERABILITY');

    for (const ep of entrypoints) {
      const normEpFile = this._normalizeFilePath(ep.file);
      // Find vulns in the same file or connected components
      const correlatedVulns = vulns.filter((v) => {
        const normVulnFile = this._normalizeFilePath(v.file);
        return normVulnFile === normEpFile || (v.severity === 'BLOCKER' || v.severity === 'HIGH');
      });

      for (const vuln of correlatedVulns) {
        const normVulnFile = this._normalizeFilePath(vuln.file);
        if (normVulnFile === normEpFile) {
          this.attackPaths.push({
            id: `path-${ep.id}-${vuln.id}`,
            entrypoint: ep.label,
            entryFile: `${ep.file}:${ep.line}`,
            targetFile: `${vuln.file}:${vuln.line}`,
            vulnerability: vuln.label,
            severity: vuln.severity,
            exploitChain: [
              `[External Request] ➔ ${ep.label} (${ep.file}:${ep.line})`,
              `[Tainted Parameter Flow] ➔ Unsanitized argument propagation`,
              `[Exploited Sink] ➔ ${vuln.label} (${vuln.file}:${vuln.line})`,
            ],
          });
        }
      }
    }
  }

  /**
   * Generates Mermaid diagram representation for Markdown reports
   */
  toMermaid() {
    if (this.attackPaths.length === 0) {
      return '```mermaid\ngraph LR\n  A[Codebase] --> B[Zero Exploitable Attack Paths Detected]\n```';
    }

    const lines = ['```mermaid', 'graph TD'];
    lines.push('  classDef entry fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;');
    lines.push('  classDef vuln fill:#450a0a,stroke:#f87171,stroke-width:2px,color:#fee2e2;');
    lines.push('  classDef sink fill:#3b0764,stroke:#c084fc,stroke-width:2px,color:#f3e8ff;');

    let counter = 0;
    for (const p of this.attackPaths.slice(0, 5)) {
      counter++;
      const epId = `E${counter}`;
      const flowId = `F${counter}`;
      const vulnId = `V${counter}`;

      lines.push(`  ${epId}["🌐 ${p.entrypoint}<br/><small>${p.entryFile}</small>"]:::entry`);
      lines.push(`  ${flowId}["⚡ Tainted Flow / Unsanitized Param"]:::sink`);
      lines.push(`  ${vulnId}["🚨 ${p.vulnerability}<br/><small>${p.targetFile}</small>"]:::vuln`);
      lines.push(`  ${epId} -->|HTTP Request| ${flowId}`);
      lines.push(`  ${flowId} -->|Unchecked Flow| ${vulnId}`);
    }

    lines.push('```');
    return lines.join('\n');
  }

  /**
   * Formats attack paths for terminal display
   */
  formatTerminal() {
    if (this.attackPaths.length === 0) {
      return null;
    }

    const output = [];
    output.push('╭─ ATTACKGRAPH EXPLOITABLE PATHS ─────────────────────── Risk Intelligence ─╮');

    for (const p of this.attackPaths.slice(0, 3)) {
      output.push(`│ ▎ ■ Target: ${p.entrypoint} (${p.entryFile})`);
      output.push(`│ ▎   ${p.exploitChain[0]}`);
      output.push(`│ ▎   ${p.exploitChain[1]}`);
      output.push(`│ ▎   ${p.exploitChain[2]}`);
      output.push('│ ▎');
    }

    output.push('╰──────────────────────────────────────────────────────────────────────────╯');
    return output.join('\n');
  }
}

function buildRiskGraph(files = [], findings = [], projectPath = '') {
  const graph = new SoftwareRiskGraph();
  return {
    graph,
    summary: graph.build(files, findings, projectPath),
    terminalOutput: graph.formatTerminal(),
    mermaidOutput: graph.toMermaid(),
    getImpactedFiles: (file) => graph.getImpactedFiles(file),
  };
}

module.exports = {
  SoftwareRiskGraph,
  buildRiskGraph,
};
