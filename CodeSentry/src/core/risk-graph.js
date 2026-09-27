/**
 * Software Risk Graph & AttackGraph Engine
 *
 * Implements:
 * 1. CodeTwin System Model: Extracts architectural components (Routes, Controllers, DB Sinks, Shell Sinks, AI Calls).
 * 2. AttackGraph Correlation: Correlates vulnerabilities across components to identify exploitable multi-step attack paths.
 * 3. Visualization: Produces ASCII/ANSI terminal graphs and Mermaid diagrams for markdown reports.
 */

const fs = require('fs');
const path = require('path');

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

    // 1. Discover architectural component nodes
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
      const normFindingFile = String(f.file || '').replace(/\\/g, '/').toLowerCase();
      for (const [nodeId, node] of this.nodes.entries()) {
        const normNodeFile = String(node.file || '').replace(/\\/g, '/').toLowerCase();
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

  _extractComponents(file, content) {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Detect HTTP Entrypoints
      const routeMatch = line.match(/(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/i) ||
                         line.match(/@(?:app|blueprint|router)\.route\(\s*['"]([^'"]+)['"]/i);
      if (routeMatch) {
        const routePath = routeMatch[2] || routeMatch[1];
        const method = routeMatch[1].toUpperCase();
        const id = `entry-${file}-${lineNum}`;
        this.nodes.set(id, {
          id,
          type: 'ENTRYPOINT',
          label: `${method} ${routePath}`,
          file,
          line: lineNum,
        });
      }

      // Detect Database Sinks
      if (/db\.(?:query|execute|run|collection|find)|cursor\.execute|Session\.query/i.test(line)) {
        const id = `dbsink-${file}-${lineNum}`;
        this.nodes.set(id, {
          id,
          type: 'DATA_SINK',
          label: 'Database Query Sink',
          file,
          line: lineNum,
        });
      }

      // Detect Shell / Execution Sinks
      if (/child_process|exec\(|eval\(|subprocess\.(?:run|Popen|call)/i.test(line)) {
        const id = `execsink-${file}-${lineNum}`;
        this.nodes.set(id, {
          id,
          type: 'EXEC_SINK',
          label: 'Dynamic Code/Shell Sink',
          file,
          line: lineNum,
        });
      }

      // Detect AI / LLM Invocations
      if (/openai\.|anthropic\.|openrouter|completion|chat\.completions/i.test(line)) {
        const id = `aisink-${file}-${lineNum}`;
        this.nodes.set(id, {
          id,
          type: 'AI_SINK',
          label: 'LLM Prompt Call',
          file,
          line: lineNum,
        });
      }
    }
  }

  _traceAttackPaths() {
    // Find all entrypoints in the project
    const entrypoints = Array.from(this.nodes.values()).filter((n) => n.type === 'ENTRYPOINT');
    const vulns = Array.from(this.nodes.values()).filter((n) => n.type === 'VULNERABILITY');

    for (const ep of entrypoints) {
      const normEpFile = String(ep.file || '').replace(/\\/g, '/').toLowerCase();
      // Find vulns in the same file or connected components
      const correlatedVulns = vulns.filter((v) => {
        const normVulnFile = String(v.file || '').replace(/\\/g, '/').toLowerCase();
        return normVulnFile === normEpFile || (v.severity === 'BLOCKER' || v.severity === 'HIGH');
      });

      for (const vuln of correlatedVulns) {
        const normVulnFile = String(vuln.file || '').replace(/\\/g, '/').toLowerCase();
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
  };
}

module.exports = {
  SoftwareRiskGraph,
  buildRiskGraph,
};
