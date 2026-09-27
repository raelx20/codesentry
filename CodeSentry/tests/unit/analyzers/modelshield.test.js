const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { analyzeModelShield, MODELSHIELD_RULES } = require('../../../src/analyzers/custom/modelshield');

test('ModelShield - AI / LLM / RAG & Agent Security Analyzer', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesentry-modelshield-'));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('detects direct prompt injection vulnerability', () => {
    const filePath = path.join(tmpDir, 'ai_handler.py');
    const code = `
import openai
def get_summary(user_input):
    prompt = f"Translate the following text: {user_input}"
    return openai.chat.completions.create(prompt=prompt)
`;
    fs.writeFileSync(filePath, code, 'utf8');

    const findings = analyzeModelShield(['ai_handler.py'], tmpDir);
    const piFinding = findings.find((f) => f.ruleId === 'modelshield-prompt-injection');
    assert.ok(piFinding !== undefined, 'Expected prompt injection finding');
    assert.strictEqual(piFinding.severity, 'HIGH');
  });

  await t.test('detects unsafe model deserialization via pickle or torch', () => {
    const filePath = path.join(tmpDir, 'load_weights.py');
    const code = `
import torch
import transformers
def load_checkpoint(path):
    return torch.load(path)
`;
    fs.writeFileSync(filePath, code, 'utf8');

    const findings = analyzeModelShield(['load_weights.py'], tmpDir);
    const modelFinding = findings.find((f) => f.ruleId === 'modelshield-unsafe-model-load');
    assert.ok(modelFinding !== undefined, 'Expected unsafe model load finding');
    assert.strictEqual(modelFinding.severity, 'BLOCKER');
  });

  await t.test('detects AI agent arbitrary code execution tool', () => {
    const filePath = path.join(tmpDir, 'agent_tool.py');
    const code = `
from langchain.agents import tool
@tool
def execute_python_code(code: str) -> str:
    return str(eval(code))
`;
    fs.writeFileSync(filePath, code, 'utf8');

    const findings = analyzeModelShield(['agent_tool.py'], tmpDir);
    const agentFinding = findings.find((f) => f.ruleId === 'modelshield-agent-code-exec');
    assert.ok(agentFinding !== undefined, 'Expected agent code exec finding');
    assert.strictEqual(agentFinding.severity, 'BLOCKER');
  });
});
