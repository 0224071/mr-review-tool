/**
 * LLM provider 抽象：每個 provider 只負責「呼叫模型、取回結構化 JSON」，
 * 分批、補查、行號驗證與路徑過濾都在上層 review-service 共用。
 */
import { ChecklistCoverageItem, MRAnalysisResult, MRReviewItem } from '../types/review';

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'custom';

export const PROVIDER_IDS: ProviderId[] = ['gemini', 'openai', 'anthropic', 'openrouter', 'custom'];

/** 單一 provider 的使用者設定（只存在瀏覽器 localStorage） */
export interface ProviderSettings {
  apiKey: string;
  model: string;
  /** 只有 OpenAI 相容自訂（Ollama 等）可改 */
  baseUrl?: string;
  /** OpenRouter 選填：HTTP-Referer / X-Title */
  referer?: string;
  title?: string;
}

export type ReviewKind = 'analysis' | 'recheck';

export interface RecheckResult {
  checklistCoverage: ChecklistCoverageItem[];
  reviews: MRReviewItem[];
}

export interface ReviewOutputMap {
  analysis: MRAnalysisResult;
  recheck: RecheckResult;
}

export interface ReviewRequest<K extends ReviewKind = ReviewKind> {
  kind: K;
  systemInstruction: string;
  prompt: string;
}

export interface LlmProvider {
  id: ProviderId;
  /** 顯示用名稱，例如「OpenAI」 */
  label: string;
  model: string;
  /** 取得可用模型 id 清單（同時用於「測試連線」） */
  listModels(): Promise<string[]>;
  /** 回傳已通過共用 schema 驗證的結果 */
  review<K extends ReviewKind>(request: ReviewRequest<K>): Promise<ReviewOutputMap[K]>;
}
