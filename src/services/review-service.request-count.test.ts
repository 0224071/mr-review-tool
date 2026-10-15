/**
 * issue #7：12 個檔的 MR 用 OpenRouter（OpenAI 相容）分析時，照設計會送幾次 POST /chat/completions。
 * 以 mock fetch 模擬端點，逐次記錄請求種類（analysis 批次／recheck 補查）與送出原因。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeGitDiff, BATCH_SIZE } from './review-service';
import { createProvider } from '../providers/registry';
import { setRetryDelayForTest } from '../providers/errors';
import { REVIEW_CHECKLIST } from '../core/prompt-builder';
import { MRAnalysisResult } from '../types/review';

const FILES = Array.from({ length: 12 }, (_, i) => `src/feature/file${String(i + 1).padStart(2, '0')}.ts`);

const DIFF_12 = FILES.map(
  (path, i) => `diff --git a/${path} b/${path}
new file mode 100644
--- /dev/null
+++ b/${path}
@@ -0,0 +1,3 @@
+export function fn${i + 1}(page: number) {
+  return page * ${i + 1};
+}`
).join('\n');

interface LoggedRequest {
  method: string;
  path: string;
  kind: 'analysis' | 'recheck';
  mode: string;
  files: string[];
}

const analysisFor = (files: string[], overrides: Partial<MRAnalysisResult> = {}): MRAnalysisResult => ({
  schemaVersion: 1,
  title: 't',
  description: 'd',
  summary: ['s'],
  testSuggestions: [],
  groups: [{ id: 'g1', name: 'g', summary: 's', files, additions: 0, deletions: 0 }],
  graph: { nodes: [], edges: [] },
  checklistCoverage: REVIEW_CHECKLIST.map((c) => ({ id: c.id, hit: false, files: [] })),
  reviews: [],
  ...overrides,
});

const chat = (content: string, finish_reason = 'stop') =>
  new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

type Reply = (req: LoggedRequest, index: number) => Response | Error;

/** OpenAI 相容端點 mock：記錄每次請求種類，依 reply 決定回應 */
function mockOpenAiEndpoint(reply: Reply) {
  const log: LoggedRequest[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body));
    const system: string = body.messages[0].content;
    const user: string = body.messages[1].content;
    const req: LoggedRequest = {
      method: init.method ?? 'GET',
      path: new URL(url).pathname,
      kind: system.includes('補查項目清單') ? 'recheck' : 'analysis',
      mode: body.response_format?.type ?? 'prompt',
      files: FILES.filter((f) => user.includes(`+++ b/${f}`)),
    };
    log.push(req);
    const r = reply(req, log.length - 1);
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal('fetch', fn);
  return log;
}

const provider = () => createProvider('openrouter', { apiKey: 'test-key', model: 'test/model:free' });

/** 正常回應：analysis 回傳該批檔案的分組，recheck 回傳空補查結果 */
const okReply: Reply = (req) =>
  req.kind === 'analysis'
    ? chat(JSON.stringify(analysisFor(req.files)))
    : chat(JSON.stringify({ checklistCoverage: [], reviews: [] }));

beforeEach(() => setRetryDelayForTest(async () => {}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('issue #7：12 檔 MR 的 POST /chat/completions 次數', () => {
  it('正常情況：12 檔 > 8 → 每批 6 檔，共 2 批 = 2 次 POST', async () => {
    const log = mockOpenAiEndpoint(okReply);
    const progress: Array<[number, number]> = [];
    await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider(), onBatchProgress: (c, t) => progress.push([c, t]) });

    expect(BATCH_SIZE).toBe(6);
    expect(log.map((r) => `${r.method} ${r.path} ${r.kind}`)).toEqual([
      'POST /api/v1/chat/completions analysis',
      'POST /api/v1/chat/completions analysis',
    ]);
    expect(log[0].files).toEqual(FILES.slice(0, 6));
    expect(log[1].files).toEqual(FILES.slice(6, 12));
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('JSON 解析失敗一次：該批重試 1 次 → 3 次 POST（不觸發補查）', async () => {
    const log = mockOpenAiEndpoint((req, i) => (i === 0 ? chat('抱歉，以下是分析：{ 不是 JSON') : okReply(req, i)));
    await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() });

    expect(log.map((r) => r.kind)).toEqual(['analysis', 'analysis', 'analysis']);
    // 第 1、2 次是同一批（前 6 檔）的原請求與重試，第 3 次是第 2 批
    expect(log[0].files).toEqual(FILES.slice(0, 6));
    expect(log[1].files).toEqual(FILES.slice(0, 6));
    expect(log[2].files).toEqual(FILES.slice(6, 12));
  });

  it('回應被截斷（finish_reason=length）同樣視為格式錯誤重試一次 → 3 次 POST', async () => {
    const log = mockOpenAiEndpoint((req, i) => (i === 1 ? chat('{"title":', 'length') : okReply(req, i)));
    await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() });
    expect(log.map((r) => r.files[0])).toEqual([FILES[0], FILES[6], FILES[6]]);
  });

  it('同一批連續兩次解析失敗：已重試 1 次仍失敗即中止分析（不再送第 2 批）', async () => {
    const log = mockOpenAiEndpoint(() => chat('not json'));
    await expect(analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() })).rejects.toThrow(/已重試 1 次/);
    expect(log).toHaveLength(2);
  });

  it('checklist 命中卻沒有對應意見：2 批 + 1 次補查 = 3 次 POST，補查只送相關檔案', async () => {
    const log = mockOpenAiEndpoint((req, i) => {
      if (req.kind === 'analysis' && i === 1) {
        // 第 2 批說 a11y 命中 file08，但 reviews 為空 → hitWithoutReview
        return chat(
          JSON.stringify(
            analysisFor(req.files, {
              checklistCoverage: REVIEW_CHECKLIST.map((c) => ({
                id: c.id,
                hit: c.id === 'a11y',
                files: c.id === 'a11y' ? [FILES[7]] : [],
              })),
            })
          )
        );
      }
      return okReply(req, i);
    });
    await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() });

    expect(log.map((r) => r.kind)).toEqual(['analysis', 'analysis', 'recheck']);
    expect(log[2].files).toEqual([FILES[7]]);
  });

  it('分批時模型漏填 checklistCoverage 不會觸發補查（合併時已補齊為 hit:false）', async () => {
    const log = mockOpenAiEndpoint((req) => chat(JSON.stringify(analysisFor(req.files, { checklistCoverage: [] }))));
    await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() });
    expect(log.map((r) => r.kind)).toEqual(['analysis', 'analysis']);
  });

  it('補查請求連線中斷（如 ERR_CONNECTION_CLOSED）被吞掉：分析仍成功、共 3 次 POST、只留 console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = mockOpenAiEndpoint((req, i) => {
      if (req.kind === 'recheck') return new TypeError('Failed to fetch');
      if (i === 0) {
        return chat(
          JSON.stringify(
            analysisFor(req.files, {
              checklistCoverage: REVIEW_CHECKLIST.map((c) => ({ id: c.id, hit: c.id === 'style', files: [] })),
            })
          )
        );
      }
      return okReply(req, i);
    });
    const result = await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() });

    expect(log.map((r) => r.kind)).toEqual(['analysis', 'analysis', 'recheck']);
    expect(result.groups.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('補查執行失敗'), expect.anything());
  });

  it('批次請求連線中斷：網路錯誤不重試，整次分析失敗（不可能同時得到完整結果）', async () => {
    const log = mockOpenAiEndpoint((req, i) => (i === 1 ? new TypeError('Failed to fetch') : okReply(req, i)));
    await expect(analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() })).rejects.toThrow(/無法連線至 OpenRouter/);
    expect(log).toHaveLength(2);
  });

  it('json_schema 回 400：降級為 json_object 重送同一批，之後沿用 → 3 次 POST', async () => {
    const log = mockOpenAiEndpoint((req, i) =>
      req.mode === 'json_schema'
        ? new Response(JSON.stringify({ error: { message: 'response_format not supported' } }), { status: 400 })
        : okReply(req, i)
    );
    await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() });
    expect(log.map((r) => `${r.kind}:${r.mode}:${r.files[0]}`)).toEqual([
      `analysis:json_schema:${FILES[0]}`,
      `analysis:json_object:${FILES[0]}`,
      `analysis:json_object:${FILES[6]}`,
    ]);
  });

  it('5xx（如 503）會在 fetch 層重試（最多再 2 次）→ 一次 503 共 3 次 POST', async () => {
    const log = mockOpenAiEndpoint((req, i) =>
      i === 0 ? new Response('{"error":"overloaded"}', { status: 503 }) : okReply(req, i)
    );
    await analyzeGitDiff({ rawDiff: DIFF_12, provider: provider() });
    expect(log.map((r) => r.files[0])).toEqual([FILES[0], FILES[0], FILES[6]]);
  });
});
