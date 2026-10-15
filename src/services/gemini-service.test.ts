import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeGitDiffWithGemini, setGeminiRetryDelayForTest } from './gemini-service';
import { REVIEW_CHECKLIST } from '../core/prompt-builder';
import { MRAnalysisResult } from '../types/review';

const DIFF = `diff --git a/src/hooks/usePagination.ts b/src/hooks/usePagination.ts
new file mode 100644
--- /dev/null
+++ b/src/hooks/usePagination.ts
@@ -0,0 +1,3 @@
+export function usePagination(page: number, pageSize: number) {
+  const start = page * pageSize;
+}
`;

const RESULT: MRAnalysisResult = {
  schemaVersion: 1,
  title: '新增分頁',
  description: 'd',
  summary: ['新增 usePagination'],
  testSuggestions: [],
  groups: [{ id: 'g1', name: '分頁', summary: 's', files: ['src/hooks/usePagination.ts'], additions: 0, deletions: 0 }],
  graph: { nodes: [], edges: [] },
  checklistCoverage: REVIEW_CHECKLIST.map((c) => ({ id: c.id, hit: false, files: [] })),
  reviews: [],
};

const geminiOk = (body: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }), {
    status: 200,
  });
const geminiError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), { status });

const delays: number[] = [];
beforeEach(() => {
  delays.length = 0;
  setGeminiRetryDelayForTest(async (ms) => {
    delays.push(ms);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeGitDiffWithGemini', () => {
  it('解析 structured output JSON 並補上新增/刪除行數', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk(RESULT)));
    const result = await analyzeGitDiffWithGemini({ rawDiff: DIFF, apiKey: 'k' });
    expect(result.schemaVersion).toBe(1);
    expect(result.title).toBe('新增分頁');
    expect(result.groups[0].additions).toBe(3);
  });

  it('503（模型暫時過載）時稍候重試，成功後繼續', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(geminiError(503, 'This model is currently experiencing high demand.'))
      .mockResolvedValueOnce(geminiOk(RESULT));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeGitDiffWithGemini({ rawDiff: DIFF, apiKey: 'k' });
    expect(result.title).toBe('新增分頁');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
  });

  it('重試次數有上限，持續 503 時回報錯誤', async () => {
    const fetchMock = vi.fn(async () => geminiError(503, 'high demand'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeGitDiffWithGemini({ rawDiff: DIFF, apiKey: 'k' })).rejects.toThrow('(503)');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([2000, 5000]);
  });

  it('400 等非暫時性錯誤不重試', async () => {
    const fetchMock = vi.fn(async () => geminiError(400, 'API key not valid'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeGitDiffWithGemini({ rawDiff: DIFF, apiKey: 'k' })).rejects.toThrow('API Key 無效');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });
});
