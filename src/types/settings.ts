/**
 * Application Settings Schema
 * 所有金鑰只存在使用者瀏覽器的 localStorage，只會送往使用者所選的模型服務。
 */
import type { ProviderId, ProviderSettings } from '../providers/types';

export type NonGeminiProviderId = Exclude<ProviderId, 'gemini'>;

export interface AppSettings {
  /** 目前使用的模型供應商；未設定時為 gemini（與舊版行為相同） */
  llmProvider: ProviderId;

  // Gemini AI configuration（沿用舊欄位，舊設定不需轉換）
  geminiApiKey: string;
  geminiModel: string;

  /** 其他供應商的設定 */
  providerSettings: Record<NonGeminiProviderId, ProviderSettings>;

  // GitLab integration (Stage 2 preparation)
  gitlabBaseUrl: string;
  gitlabToken: string;

  // Custom team review guidelines / rules (Stage 3 preparation)
  teamRules: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  providerSettings: {
    openai: { apiKey: '', model: 'gpt-4.1-mini' },
    anthropic: { apiKey: '', model: 'claude-opus-5-5' },
    openrouter: { apiKey: '', model: 'openai/gpt-4.1-mini', referer: '', title: 'GitLab MR Review Tool' },
    custom: { apiKey: '', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' },
  },
  gitlabBaseUrl: 'https://gitlab.com',
  gitlabToken: '',
  teamRules: [
    '一則意見只講一件事',
    '建議寫成具體可執行的動作',
    '避免模糊用語（例如「可能需要考慮」）',
    '句子保持簡短明瞭（建議不超過 80 字）',
  ],
};
