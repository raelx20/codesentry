'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAIClient, OPENAI_MODELS, OPENAI_FALLBACK_CHAIN } = require('../../../src/analyzers/ai/openai');
const { createAIClient } = require('../../../src/analyzers/ai/client');

describe('OpenAI AI Provider Module', () => {
  it('should have standard OpenAI models catalog', () => {
    assert.equal(OPENAI_MODELS.GPT_4O_MINI, 'gpt-4o-mini');
    assert.equal(OPENAI_MODELS.GPT_4O, 'gpt-4o');
    assert.ok(OPENAI_FALLBACK_CHAIN.includes('gpt-4o-mini'));
  });

  it('should create client in mock mode without API key', async () => {
    const client = createOpenAIClient({ mockMode: true });
    assert.equal(client.mockMode, true);
    assert.equal(client.provider, 'openai');

    const res = await client.analyze('Check this vulnerability in app.py');
    assert.ok(res.explanation);
    assert.ok(res.confidence >= 0.8);
    assert.ok(res.suggestedFix);
  });

  it('should perform mock batch repair for files', async () => {
    const client = createOpenAIClient({ mockMode: true });
    const res = await client.chatCompletion({
      messages: [{ role: 'user', content: 'Fix SQL injection' }],
    });
    assert.ok(res.content.includes('CodeSentry mock AI repair'));
  });

  it('createAIClient should instantiate OpenAI provider when requested', () => {
    const client = createAIClient({ provider: 'openai', mockMode: true });
    assert.equal(client.provider, 'openai');
    assert.equal(client.model, 'gpt-4o-mini');
  });
});
