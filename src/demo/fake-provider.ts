/**
 * 示範用 AI provider：不發任何網路請求，約 1 秒後回傳既有的範例分析結果。
 */
import { LlmProvider, ProviderId, ReviewKind, ReviewOutputMap, ReviewRequest } from '../providers/types';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';

export const DEMO_ANALYSIS_DELAY_MS = 1000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createDemoProvider(options: { delayMs?: number } = {}): LlmProvider {
  const { delayMs = DEMO_ANALYSIS_DELAY_MS } = options;
  return {
    // 不屬於任何真實供應商；結果標記顯示為「示範 · 範例分析」
    id: '示範' as ProviderId,
    label: '示範',
    model: '範例分析',
    listModels: async () => [],
    testConnection: async () => ({ models: [], keyVerified: false }),
    async review<K extends ReviewKind>(request: ReviewRequest<K>): Promise<ReviewOutputMap[K]> {
      // 補查不再等待、也不新增意見
      if (request.kind === 'recheck') {
        const empty: ReviewOutputMap['recheck'] = { checklistCoverage: [], reviews: [] };
        return empty as ReviewOutputMap[K];
      }
      await wait(delayMs);
      const sample: ReviewOutputMap['analysis'] = structuredClone(SAMPLE_ANALYSIS_RESULT);
      return sample as ReviewOutputMap[K];
    },
  };
}
