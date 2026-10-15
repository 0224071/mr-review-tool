/**
 * 向下相容入口：以 Gemini provider 執行共用審查流程。
 * 實際 Gemini 呼叫在 src/providers/gemini.ts，分批與驗證在 review-service.ts。
 */
import { setRetryDelayForTest } from '../providers/errors';
import { createGeminiProvider } from '../providers/gemini';
import { MRAnalysisResult } from '../types/review';
import { analyzeGitDiff } from './review-service';

export { mergeBatchAnalysisResults } from './review-service';

export interface AnalyzeOptions {
  rawDiff: string;
  apiKey: string;
  model?: string;
  teamRules?: string[];
  onBatchProgress?: (current: number, total: number) => void;
}

/** 測試用：替換重試等待（避免測試真的等待） */
export function setGeminiRetryDelayForTest(fn: (ms: number) => Promise<void>): void {
  setRetryDelayForTest(fn);
}

export async function analyzeGitDiffWithGemini(options: AnalyzeOptions): Promise<MRAnalysisResult> {
  const { rawDiff, apiKey, model = 'gemini-3.8-flash', teamRules = [], onBatchProgress } = options;
  if (!rawDiff || !rawDiff.trim()) {
    throw new Error('請提供有效的 Git Diff 內容');
  }
  if (!apiKey || !apiKey.trim()) {
    throw new Error('尚未設定 Gemini API Key，請點擊「填寫金鑰」按鈕填入您的 API 金鑰。');
  }
  return analyzeGitDiff({
    rawDiff,
    provider: createGeminiProvider({ apiKey, model }),
    teamRules,
    onBatchProgress,
  });
}
