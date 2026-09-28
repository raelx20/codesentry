'use strict';

const { createOpenRouterClient, OPENROUTER_MODELS, selectModel: selectOpenRouterModel } = require('./openrouter');
const { createAgentRouterClient, AGENTROUTER_MODELS, selectModel: selectAgentRouterModel } = require('./agentrouter');
const { createOpenAIClient, OPENAI_MODELS, selectModel: selectOpenAIModel } = require('./openai');

/**
 * Multi-Provider AI Client Wrapper
 * Supports OpenRouter, OpenAI, and AgentRouter with seamless failover between providers.
 */
function createAIClient(options = {}) {
  const provider = (
    options.provider ||
    process.env.CODESENTRY_AI_PROVIDER ||
    (process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY ? 'openai' : '') ||
    (process.env.AGENTROUTER_API_KEY && !process.env.OPENROUTER_API_KEY ? 'agentrouter' : 'openrouter')
  ).toLowerCase();

  if (provider === 'openai') {
    return createOpenAIClient({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL,
      model: options.model || selectOpenAIModel(options.scanContext),
      scanContext: options.scanContext,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      timeout: options.timeout || 10000,
      mockMode: options.mockMode,
    });
  }

  if (provider === 'agentrouter') {
    return createAgentRouterClient({
      apiKey: options.apiKey || process.env.AGENTROUTER_API_KEY || process.env.OPENROUTER_API_KEY,
      baseUrl: options.baseUrl || process.env.AGENTROUTER_BASE_URL,
      model: options.model || selectAgentRouterModel(options.scanContext),
      scanContext: options.scanContext,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      timeout: options.timeout || 8000,
      mockMode: options.mockMode,
    });
  }

  // Default: OpenRouter
  return createOpenRouterClient({
    apiKey: options.apiKey || process.env.OPENROUTER_API_KEY,
    model: options.model || selectOpenRouterModel(options.scanContext),
    scanContext: options.scanContext,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    timeout: options.timeout || 8000,
    mockMode: options.mockMode,
  });
}

module.exports = {
  createAIClient,
  OPENROUTER_MODELS,
  AGENTROUTER_MODELS,
  OPENAI_MODELS,
  selectModel: selectOpenRouterModel,
};
