/**
 * ModelShield Analyzer: AI, ML, LLM, RAG & Agent Security Engine
 *
 * Implements security checks covering:
 * - Direct prompt injection vectors (untrusted inputs concatenated into LLM prompts)
 * - Insecure model deserialization (pickle, unsafe torch.load without weights_only)
 * - AI agent tool arbitrary code execution (un-sandboxed eval/exec from LLM output)
 * - Sensitive data / API key leaks transmitted to LLM API endpoints
 * - RAG vector retrieval injection
 */

const fs = require('fs');
const path = require('path');
const { createFinding } = require('../../findings/schema');

const MODELSHIELD_RULES = [
  {
    id: 'modelshield-prompt-injection',
    severity: 'HIGH',
    title: 'Direct untrusted input concatenation into LLM prompt',
    pattern: /(?:f["'].*\{\s*(?:user_input|request\.|req\.|query|prompt|text|input|data)\b.*\}|prompt\s*:\s*`[^`]*\$\{\s*(?:req\.|request\.|input|userText|userInput)\b[^}]*\}`)/i,
    message: 'Untrusted user variable directly interpolated into LLM prompt template without boundary separation or input validation. Vulnerable to prompt injection attacks.',
    suggestedFix: 'Separate user input into distinct message roles (e.g. `{ role: "user", content: input }`) or apply rigorous prompt boundary sanitization and delimiter guards.',
  },
  {
    id: 'modelshield-unsafe-model-load',
    severity: 'BLOCKER',
    title: 'Insecure model or weights deserialization',
    pattern: /(?:pickle\.loads?\(|joblib\.load\(|torch\.load\((?!.*weights_only\s*=\s*True))/i,
    message: 'Model deserialization detected using pickle or unconstrained torch.load. Loading untrusted model checkpoints can execute arbitrary remote code.',
    suggestedFix: 'Use `torch.load(..., weights_only=True)` or convert models to secure formats like SafeTensors (`safetensors.torch.load_file`).',
  },
  {
    id: 'modelshield-agent-code-exec',
    severity: 'BLOCKER',
    title: 'AI Agent executes arbitrary code from model output',
    pattern: /(?:tool|agent|function_call).*(?:eval\(|exec\(|subprocess\.run\(|child_process\.exec\()/is,
    multiline: true,
    message: 'AI Agent tool invokes dynamic shell or code execution (`eval`/`exec`/`subprocess`) directly on model outputs. Vulnerable to remote code execution via prompt injection.',
    suggestedFix: 'Constrain agent tools to pre-defined deterministic operations and run any necessary code in a hardened gVisor/WebAssembly sandbox.',
  },
  {
    id: 'modelshield-pii-prompt-leak',
    severity: 'HIGH',
    title: 'Sensitive credential or secret sent in LLM payload',
    pattern: /(?:messages|prompt)\s*[:=].*(?:password|secret_key|api_key|private_key|token)\b/i,
    message: 'Potential transmission of sensitive credentials or secrets within the LLM prompt payload to external model providers.',
    suggestedFix: 'Mask or redact sensitive fields (API keys, passwords, PII) before constructing LLM messages.',
  },
  {
    id: 'modelshield-rag-retrieval-injection',
    severity: 'MEDIUM',
    title: 'Unsanitized user query in vector database retrieval',
    pattern: /(?:similarity_search|query_embeddings|vector_store\.query)\s*\(\s*["'].*\$\{.*\}|f["'].*SELECT.*FROM.*embeddings.*WHERE/i,
    message: 'Raw user query directly formatted into vector store search query or vector SQL statement without sanitization.',
    suggestedFix: 'Use parameterized filter expressions provided by your vector database client (e.g. Chroma, Pinecone, pgvector).',
  },
];

/**
 * Inspect source files for AI/ML/LLM security vulnerabilities
 */
function analyzeModelShield(files = [], projectPath = '') {
  const findings = [];

  for (const relPath of files) {
    const ext = path.extname(relPath).toLowerCase();
    if (!['.js', '.ts', '.py', '.jsx', '.tsx'].includes(ext)) {
      continue;
    }

    const fullPath = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath);
    let content = '';

    try {
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, 'utf8');
      }
    } catch {
      continue;
    }

    // Fast check: only analyze if file contains AI/ML keywords or imports
    const isAiRelevant =
      /(openai|anthropic|openrouter|langchain|llamaindex|huggingface|transformers|torch|pytorch|sklearn|embedding|completion|chat|agent|prompt)/i.test(
        content
      );

    if (!isAiRelevant) {
      continue;
    }

    const lines = content.split('\n');

    for (const rule of MODELSHIELD_RULES) {
      if (rule.multiline) {
        if (rule.pattern.test(content)) {
          const sinkIdx = lines.findIndex((l) => /(?:eval\(|exec\(|subprocess\.run\(|child_process\.exec\()/.test(l));
          const lineIdx = sinkIdx !== -1 ? sinkIdx : 0;
          findings.push(
            createFinding({
              tool: 'modelshield',
              category: 'security',
              rule: rule.id,
              ruleId: rule.id,
              file: relPath,
              line: lineIdx + 1,
              column: 1,
              severity: rule.severity,
              message: rule.message,
              suggestedFix: rule.suggestedFix,
              codeSnippet: lines[lineIdx]?.trim() || '',
            })
          );
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (rule.pattern.test(line)) {
            findings.push(
              createFinding({
                tool: 'modelshield',
                category: 'security',
                rule: rule.id,
                ruleId: rule.id,
                file: relPath,
                line: i + 1,
                column: 1,
                severity: rule.severity,
                message: rule.message,
                suggestedFix: rule.suggestedFix,
                codeSnippet: line.trim(),
              })
            );
          }
        }
      }
    }
  }

  return findings;
}

module.exports = {
  analyzeModelShield,
  MODELSHIELD_RULES,
};
