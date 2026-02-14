import type { Provider } from './types';

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  contextWindow: number;
}

export const MODEL_CATALOG: Record<string, ModelInfo> = {
  // OpenAI models
  'gpt-5.2': {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-5.1': {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-5.1-chat-latest': {
    id: 'gpt-5.1-chat-latest',
    name: 'GPT-5.1 chat latest',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-5': {
    id: 'gpt-5',
    name: 'GPT-5',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-5-chat-latest': {
    id: 'gpt-5-chat-latest',
    name: 'GPT-5 chat latest',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-5-mini': {
    id: 'gpt-5-mini',
    name: 'GPT-5 mini',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-5-nano': {
    id: 'gpt-5-nano',
    name: 'GPT-5 nano',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-4.1': {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 mini',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-4.1-nano': {
    id: 'gpt-4.1-nano',
    name: 'GPT-4.1 nano',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    contextWindow: 128000,
  },

  // Google Gemini models
  'gemini-3-pro-preview': {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    provider: 'gemini',
    contextWindow: 2000000,
  },
  'gemini-3-flash-preview': {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'gemini',
    contextWindow: 1000000,
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    contextWindow: 2000000,
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    contextWindow: 1000000,
  },
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'gemini',
    contextWindow: 1000000,
  },

  // Anthropic models
  'claude-sonnet-4-5': {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
  },

  // xAI models
  'grok-4-1-fast-reasoning': {
    id: 'grok-4-1-fast-reasoning',
    name: 'Grok 4.1 Fast (Reasoning)',
    provider: 'xai',
    contextWindow: 131072,
  },
  'grok-4-1-fast-non-reasoning': {
    id: 'grok-4-1-fast-non-reasoning',
    name: 'Grok 4.1 Fast (Non-reasoning)',
    provider: 'xai',
    contextWindow: 131072,
  },

  // DeepSeek models (disabled in UI but included for completeness)
  'deepseek-chat': {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3.2 (Non-thinking Mode)',
    provider: 'deepseek',
    contextWindow: 64000,
  },
  'deepseek-reasoner': {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-V3.2 (Thinking Mode)',
    provider: 'deepseek',
    contextWindow: 64000,
  },
};

// Default models enabled for each provider
export const DEFAULT_ENABLED_MODELS: Record<Provider, string[]> = {
  openai: ['gpt-4.1', 'gpt-4.1-mini'],
  gemini: [
    'gemini-2.5-flash',
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
  ],
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  xai: ['grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

// Get all models for a provider
export function getProviderModels(provider: Provider): ModelInfo[] {
  return Object.values(MODEL_CATALOG).filter(
    (model) => model.provider === provider
  );
}

// Get model info by ID
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG[modelId];
}
