/** 測試共用：最小可通過 schema 的分析結果與 mock fetch 工具 */
import { vi } from 'vitest';
import { REVIEW_CHECKLIST } from '../core/prompt-builder';
import { MRAnalysisResult } from '../types/review';

export const VALID_RESULT: MRAnalysisResult = {
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

export const DIFF = `diff --git a/src/hooks/usePagination.ts b/src/hooks/usePagination.ts
new file mode 100644
--- /dev/null
+++ b/src/hooks/usePagination.ts
@@ -0,0 +1,3 @@
+export function usePagination(page: number, pageSize: number) {
+  const start = page * pageSize;
+}
`;

export const REQUEST = { kind: 'analysis' as const, systemInstruction: 'SYS', prompt: 'PROMPT' };

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** 依序回傳 responses（最後一個重複使用），並記錄每次呼叫 */
export function mockFetch(...responses: Array<Response | (() => Response) | Error>) {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: { ...((init.headers as Record<string, string>) ?? {}) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r.clone();
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}
