/**
 * Provider 中繼資料與建立函式。只建立使用者所選的 provider，不自動 fallback 到其他家。
 */
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';
import { createOpenAiCompatibleProvider, OLLAMA_DEFAULT_BASE_URL } from './openai-compatible';
import { LlmProvider, ProviderId, ProviderSettings } from './types';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  defaultModel: string;
  keyUrl?: string;
  keyPlaceholder: string;
  /** 自訂 OpenAI 相容服務（Ollama）可不填 key */
  keyOptional?: boolean;
  /** 只有自訂 provider 可改 base URL */
  editableBaseUrl?: boolean;
  defaultBaseUrl?: string;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: '貼上 AI Studio API Key (AIza...)',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: '貼上 OpenAI API Key (sk-...)',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: '貼上 Anthropic API Key (sk-ant-...)',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-4.1-mini',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: '貼上 OpenRouter API Key (sk-or-...)',
  },
  custom: {
    id: 'custom',
    label: 'Ollama／自訂 OpenAI 相容',
    defaultModel: 'llama3.1',
    keyPlaceholder: '選填（Ollama 不需要）',
    keyOptional: true,
    editableBaseUrl: true,
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
  },
};

export function createProvider(id: ProviderId, config: ProviderSettings): LlmProvider {
  switch (id) {
    case 'gemini':
      return createGeminiProvider(config);
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai':
    case 'openrouter':
    case 'custom':
      return createOpenAiCompatibleProvider(id, config);
    default:
      throw new Error(`未知的模型供應商：${String(id)}`);
  }
}
