/**
 * Issue #52：離線 HTML 匯出不可含任何 key / token。
 * 用假的 GitLab token 與各家模型 key 走真實的分析／分享／歷史紀錄路徑產生結果，再匯出檢查。
 */
import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAnalysisRecord } from '../core/analysis-record';
import { sanitizeForStorage } from '../core/history-store';
import { setRetryDelayForTest } from '../providers/errors';
import { createProvider } from '../providers/registry';
import { DIFF, jsonResponse, mockFetch, VALID_RESULT } from '../providers/test-helpers';
import { ProviderId } from '../providers/types';
import { analyzeGitDiff } from '../services/review-service';
import { findSharedAnalysisInNotes, SHARED_TAG_END, SHARED_TAG_START } from '../services/gitlab-api';
import { getProviderSettings, normalizeSettings } from '../core/settings-store';
import { AppSettings } from '../types/settings';
import { GitLabMergeRequestInfo, GitLabNote } from '../types/gitlab';
import { MRAnalysisResult } from '../types/review';
import { generateOfflineHtmlReport, REDACTED, redactSecrets, toExportableResult } from './export-offline';

const FAKE = {
  gitlab: 'FAKE-GITLAB-TOKEN-1234567890abcdef',
  gemini: 'FAKE-GEMINI-KEY-a1b2c3d4e5f6g7h8i9',
  openai: 'FAKE-OPENAI-KEY-sk-q9w8e7r6t5y4u3i2',
  anthropic: 'FAKE-ANTHROPIC-KEY-zx81cv72bn63m54',
  openrouter: 'FAKE-OPENROUTER-KEY-pl0ok9ij8uh7yg6',
  custom: 'FAKE-CUSTOM-KEY-mn2bv3cx4zl5kj6hg',
} as const;
const FAKE_VALUES = Object.values(FAKE);
const MIN_FRAGMENT = 8;

/** 回傳 html 中出現的假值片段（長度 >= 8 的所有子字串），只回傳「哪個假值、片段長度」不回傳值本身 */
function findLeaks(html: string): string[] {
  const leaks: string[] = [];
  for (const [name, value] of Object.entries(FAKE)) {
    for (let len = value.length; len >= MIN_FRAGMENT; len--) {
      for (let start = 0; start + len <= value.length; start++) {
        if (html.includes(value.slice(start, start + len))) {
          leaks.push(`${name}[${start}..${start + len})`);
        }
      }
    }
  }
  return leaks;
}

function expectNoSecrets(html: string) {
  for (const v of FAKE_VALUES) expect(html.includes(v)).toBe(false);
  expect(findLeaks(html)).toEqual([]);
}

const fakeSettings = (): AppSettings =>
  normalizeSettings({
    llmProvider: 'openai',
    geminiApiKey: FAKE.gemini,
    gitlabToken: FAKE.gitlab,
    gitlabBaseUrl: 'https://gitlab.example.com',
    providerSettings: {
      openai: { apiKey: FAKE.openai, model: 'gpt-4.1-mini' },
      anthropic: { apiKey: FAKE.anthropic, model: 'claude-opus-5-5' },
      openrouter: { apiKey: FAKE.openrouter, model: 'openai/gpt-4.1-mini', referer: '', title: 'GitLab MR Review Tool' },
      custom: { apiKey: FAKE.custom, model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' },
    },
  });

/** 各種可能夾帶機密的請求標頭 */
const fakeHeaders = () => ({
  Authorization: `Bearer ${FAKE.openai}`,
  'PRIVATE-TOKEN': FAKE.gitlab,
  'x-api-key': FAKE.anthropic,
  'x-goog-api-key': FAKE.gemini,
  'HTTP-Referer': FAKE.openrouter,
  'X-Custom-Auth': FAKE.custom,
});

/**
 * 模型（或被竄改的分享留言）回傳的結果夾帶 schema 以外的欄位：
 * 欄位名稱像機密的、看起來無害的、巢狀在 groups / reviews / graph 裡的都有。
 */
function resultWithSmuggledSecrets(): MRAnalysisResult {
  const settings = fakeSettings();
  return {
    ...VALID_RESULT,
    groups: VALID_RESULT.groups.map((g) => ({ ...g, apiKey: FAKE.gemini, note: FAKE.custom })),
    graph: {
      nodes: [{ id: 'n1', label: 'usePagination', groupId: 'g1', kind: 'hook', token: FAKE.gitlab } as never],
      edges: [{ from: 'n1', to: 'n1', label: null, meta: FAKE.openrouter } as never],
    },
    checklistCoverage: VALID_RESULT.checklistCoverage!.map((c, i) =>
      i === 0 ? ({ ...c, secret: FAKE.anthropic, extra: FAKE.openai } as never) : c
    ),
    reviews: [
      {
        groupId: 'g1',
        category: 'bug',
        severity: 'high',
        file: 'src/hooks/usePagination.ts',
        line: 2,
        codeSnippet: 'const start = page * pageSize;',
        comment: 'page 從 1 開始時 start 會跳過第一頁',
        suggestion: '改成 (page - 1) * pageSize',
        requestHeaders: fakeHeaders(),
        debug: `curl -H "PRIVATE-TOKEN: ${FAKE.gitlab}" -H "x-api-key: ${FAKE.anthropic}"`,
      } as never,
    ],
    // 頂層：設定物件、請求標頭、看似無害的欄位名稱
    settings,
    ...settings,
    headers: fakeHeaders(),
    request: { url: `https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=${FAKE.gemini}` },
    debugInfo: FAKE_VALUES.join(' '),
  } as unknown as MRAnalysisResult;
}

beforeEach(() => setRetryDelayForTest(async () => {}));
afterEach(() => vi.unstubAllGlobals());

/** 依 provider 包成該家 API 的回應格式 */
function providerResponse(id: ProviderId, body: unknown): Response {
  switch (id) {
    case 'gemini':
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
    case 'anthropic':
      return jsonResponse({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'submit_review', input: body }],
      });
    default:
      return jsonResponse({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(body) } }] });
  }
}

describe('generateOfflineHtmlReport 不含 key / token（#52）', () => {
  it('滑動視窗檢查本身有效：含假值片段的字串會被抓到', () => {
    expect(findLeaks(`xx${FAKE.gitlab.slice(5, 13)}xx`)).not.toEqual([]);
    expect(findLeaks('完全無關的內容')).toEqual([]);
  });

  it.each<ProviderId>(['gemini', 'openai', 'anthropic', 'openrouter', 'custom'])(
    '%s：真實分析流程（金鑰只在設定與請求中，模型正常回傳）匯出不含假值',
    async (id) => {
      const settings = { ...fakeSettings(), llmProvider: id };
      const { calls } = mockFetch(providerResponse(id, VALID_RESULT));
      const result = await analyzeGitDiff({ rawDiff: DIFF, provider: createProvider(id, getProviderSettings(settings, id)) });
      expect(JSON.stringify(calls.map((c) => ({ url: c.url, headers: c.headers })))).toContain(FAKE[id]);
      expectNoSecrets(generateOfflineHtmlReport(result));
    }
  );

  it.each<ProviderId>(['gemini', 'openai', 'anthropic', 'openrouter', 'custom'])(
    '%s：真實分析流程（金鑰在設定與請求中，模型回傳夾帶機密欄位）匯出不含假值',
    async (id) => {
      const settings = { ...fakeSettings(), llmProvider: id };
      const { calls } = mockFetch(providerResponse(id, resultWithSmuggledSecrets()));
      const provider = createProvider(id, getProviderSettings(settings, id));
      const result = await analyzeGitDiff({ rawDiff: DIFF, provider, teamRules: settings.teamRules });

      // 確認金鑰真的有被送出（Gemini 在 URL，其他在標頭），代表測試涵蓋到持有金鑰的路徑
      const sent = JSON.stringify(calls.map((c) => ({ url: c.url, headers: c.headers })));
      expect(sent).toContain(FAKE[id]);

      const html = generateOfflineHtmlReport(result);
      expectNoSecrets(html);
      // 正常內容仍在
      expect(html).toContain('新增分頁');
      expect(html).toContain('改成 (page - 1) * pageSize');
    }
  );

  it('從 MR 留言讀到的共享分析夾帶機密欄位，匯出不含假值', () => {
    const note = {
      id: 1,
      body: `${SHARED_TAG_START}\n\`\`\`json\n${JSON.stringify(resultWithSmuggledSecrets())}\n\`\`\`\n${SHARED_TAG_END}`,
      author: { name: 'a', username: 'a' },
      created_at: '2026-10-15T00:00:00Z',
    } as unknown as GitLabNote;
    const shared = findSharedAnalysisInNotes([note]);
    expect(shared).not.toBeNull();
    expectNoSecrets(generateOfflineHtmlReport(shared!.result));
  });

  it('歷史紀錄：存入（sanitize）後再開啟的結果匯出不含假值', () => {
    const mr = {
      id: 1,
      iid: 7,
      project_id: 3,
      title: 'MR 標題',
      description: '',
      state: 'opened',
      created_at: '',
      updated_at: '',
      web_url: 'https://gitlab.example.com/g/p/-/merge_requests/7',
      target_branch: 'main',
      source_branch: 'feat',
      author: { name: 'a', username: 'a' },
      diff_refs: { base_sha: 'b', head_sha: 'h', start_sha: 's' },
    } as unknown as GitLabMergeRequestInfo;
    const record = buildAnalysisRecord({
      source: { id: 'gitlab.example.com/g/p!7', sourceType: 'gitlab' },
      result: resultWithSmuggledSecrets(),
      diffText: DIFF,
      mr,
      notes: [],
      existing: undefined,
      now: 0,
    });
    const stored = sanitizeForStorage({ ...record, settings: fakeSettings(), headers: fakeHeaders() });
    expectNoSecrets(generateOfflineHtmlReport(stored.result));
  });

  it('直接把整筆歷史紀錄或混入設定的物件當結果傳入，匯出也不含假值', () => {
    const record = {
      ...resultWithSmuggledSecrets(),
      rawDiff: DIFF,
      result: resultWithSmuggledSecrets(),
      published: [],
    } as unknown as MRAnalysisResult;
    const html = generateOfflineHtmlReport(record);
    expectNoSecrets(html);
    if (process.env.EXPORT52_OUT) writeFileSync(process.env.EXPORT52_OUT, html, 'utf8');
  });

  it('匯出的 JSON 只保留分析結果欄位，可重新導入', () => {
    const html = generateOfflineHtmlReport(resultWithSmuggledSecrets());
    const json = html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)![1]
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed).sort()).toEqual(
      ['checklistCoverage', 'description', 'graph', 'groups', 'reviews', 'schemaVersion', 'summary', 'testSuggestions', 'title'].sort()
    );
    expect(Object.keys(parsed.reviews[0]).sort()).toEqual(
      ['category', 'codeSnippet', 'comment', 'file', 'groupId', 'line', 'severity', 'suggestion'].sort()
    );
    expect(parsed.groups[0]).toEqual(VALID_RESULT.groups[0]);
  });
});


/**
 * Issue #65：模型把 token 原文寫進意見時，匯出前要遮罩。
 * 測試值一律含 FAKE-；前綴與本體在執行期才拼接，原始碼裡沒有完整的 token 樣式（gitleaks 不會誤報）。
 */
const fakeToken = (prefix: string, body: string) => `${prefix}${body}`;
const SECRET_SAMPLES: Record<string, string> = {
  'GitLab glpat-': fakeToken('glpat-', 'FAKE-0a1B2c3D4e5F6g7H8i9J'),
  'GitLab gldt-': fakeToken('gldt-', 'FAKE-0a1B2c3D4e5F6g7H8i9J'),
  'GitHub ghp_': fakeToken('ghp_', 'FAKE-0a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P'),
  'GitHub github_pat_': fakeToken('github_pat_', 'FAKE_0a1B2c3D4e5F6g7H8i9J_0k1L2m3N4o5P'),
  'Google AIza': fakeToken('AIza', 'FAKE-0a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5'),
  'OpenAI sk-': fakeToken('sk-', 'FAKE-0a1B2c3D4e5F6g7H8i9J0k1L'),
  'OpenAI sk-proj-': fakeToken('sk-', 'proj-FAKE-0a1B2c3D4e5F6g7H8i9J0k1L'),
  'Anthropic sk-ant-': fakeToken('sk-', 'ant-api03-FAKE-0a1B2c3D4e5F6g7H8i9J0k1L'),
  'Slack xoxb-': fakeToken('xoxb-', 'FAKE-1234567890-0a1B2c3D4e'),
  'Slack xoxp-': fakeToken('xoxp-', 'FAKE-1234567890-0a1B2c3D4e'),
  'AWS AKIA': fakeToken('AKIA', 'FAKE-0A1B2C3D4E5F6G'),
  Bearer: fakeToken('Bearer ', 'FAKE-0a1B2c3D4e5F6g7H'),
  JWT: [fakeToken('eyJ', 'FAKE-hbGciOiJIUzI1NiJ9'), fakeToken('eyJ', 'FAKE-zdWIiOiIxMjM0In0'), 'FAKE-s1g2N3a4T5u6R7e8'].join('.'),
  '高熵長字串': fakeToken('FAKE-', 'q7Zx9Lm2Np4Rt6Vw8Yb1Cd3Ef5Gh0Jk'),
};
/** 每個假值去掉前綴後的本體（遮罩後不能留下） */
const secretBody = (value: string) => value.slice(value.indexOf('FAKE'));

describe('redactSecrets：遮罩看起來像 token / key 的字串（#65）', () => {
  it.each(Object.entries(SECRET_SAMPLES))('%s', (_name, secret) => {
    const masked = redactSecrets(`請移除寫死的憑證 ${secret}，改讀環境變數。`);
    expect(masked).not.toContain(secretBody(secret));
    expect(masked).toContain(REDACTED);
    expect(masked).toMatch(/^請移除寫死的憑證 .*，改讀環境變數。$/);
  });

  it('前綴格式保留前綴，讓讀者知道是哪一種憑證', () => {
    expect(redactSecrets(SECRET_SAMPLES['GitLab glpat-'])).toBe(`glpat-${REDACTED}`);
    expect(redactSecrets(SECRET_SAMPLES.Bearer)).toBe(`Bearer ${REDACTED}`);
  });

  it('鍵值形式（token=、"api_key": 、PRIVATE-TOKEN:）的隨機值會遮，鍵名保留', () => {
    const value = 'FAKE-9f8E7d6C5b4A3z';
    const samples = [
      ['token', '=', value],
      ['"api_key"', ': "', value + '"'],
      ['PRIVATE-TOKEN', ': ', value],
      ['password', ' = \'', value + "'"],
    ].map((parts) => parts.join(''));
    for (const sample of samples) {
      const masked = redactSecrets(`const config = ${sample};`);
      expect(masked).not.toContain(value);
      expect(masked).toContain(REDACTED);
    }
  });

  it('一般程式碼不誤遮', () => {
    const code = [
      'const token = getToken();',
      'headers: { Authorization: `Bearer ${token}` }',
      'const apiKey = process.env.GITLAB_TOKEN;',
      'password: string;',
      '<div className="sk-skeleton animate-pulse" />',
      'export function useCouponRedemptionWithAbortController() {}',
      'const MAX_RETRY_COUNT_FOR_SHARED_ANALYSIS_2026 = 3;',
      'import { calculateFinalTotal } from "../utils/discountCalculator";',
      'src/components/CouponInput.tsx',
      'commit d1614bb0a5c3e2f4b6d8a0c2e4f6a8b0c2d4e6f8',
      'grid-cols-[minmax(0,1fr)_auto]',
      '請改用 AbortController，並在 AKIA 開頭的金鑰外洩時輪替。',
      'const total = (page - 1) * pageSize + 100000;',
    ];
    for (const line of code) expect(redactSecrets(line)).toBe(line);
  });
});

describe('匯出遮罩 finding 自由文字中的 token（#65）', () => {
  const secrets = Object.values(SECRET_SAMPLES);
  const leaky = (): MRAnalysisResult => ({
    ...VALID_RESULT,
    reviews: [
      {
        groupId: 'g1',
        category: 'bug',
        severity: 'high',
        file: 'src/api/client.ts',
        line: 3,
        codeSnippet: `const headers = { Authorization: '${SECRET_SAMPLES.Bearer}' };`,
        comment: `這裡寫死了 ${SECRET_SAMPLES['GitLab glpat-']} 與 ${SECRET_SAMPLES['Google AIza']}`,
        suggestion: `移除 ${SECRET_SAMPLES['OpenAI sk-']}、${SECRET_SAMPLES['高熵長字串']}，改讀環境變數`,
      },
    ],
    summary: [`摘要提到 ${SECRET_SAMPLES['GitHub ghp_']}`],
    testSuggestions: [`測試不要用 ${SECRET_SAMPLES['Slack xoxb-']}`],
  });

  it('toExportableResult 遮罩 comment、suggestion、codeSnippet 與其他自由文字', () => {
    const out = toExportableResult(leaky());
    const review = out.reviews[0];
    expect(review.comment).toBe(`這裡寫死了 glpat-${REDACTED} 與 AIza${REDACTED}`);
    expect(review.suggestion).toBe(`移除 sk-${REDACTED}、${REDACTED}，改讀環境變數`);
    expect(review.codeSnippet).toBe(`const headers = { Authorization: 'Bearer ${REDACTED}' };`);
    expect(out.summary[0]).toBe(`摘要提到 ghp_${REDACTED}`);
    expect(out.testSuggestions[0]).toBe(`測試不要用 xoxb-${REDACTED}`);
    // 非自由文字欄位不變
    expect(review.file).toBe('src/api/client.ts');
    expect(review.line).toBe(3);
  });

  it('離線 HTML（含完整 JSON）不出現任何假值本體，正常內容仍在', () => {
    const html = generateOfflineHtmlReport(leaky());
    const used = secrets.filter((secret) => JSON.stringify(leaky()).includes(secret));
    expect(used.length).toBeGreaterThanOrEqual(7);
    for (const secret of used) expect(html).not.toContain(secretBody(secret));
    expect(html).toContain('這裡寫死了 glpat-');
    expect(html).toContain('新增分頁');
  });

  it('不改動呼叫端傳入的結果', () => {
    const input = leaky();
    toExportableResult(input);
    expect(input.reviews[0].comment).toContain(secretBody(SECRET_SAMPLES['GitLab glpat-']));
  });
});

describe('離線 HTML 的 category 做 HTML 跳脫（#65）', () => {
  const review: MRAnalysisResult['reviews'][number] = {
    groupId: 'g1',
    category: 'bug',
    severity: 'medium',
    file: 'src/hooks/usePagination.ts',
    line: 2,
    codeSnippet: 'const start = page * pageSize;',
    comment: 'page 從 1 開始',
    suggestion: '改成 (page - 1) * pageSize',
  };

  it('category 夾帶 HTML 時不會變成標籤', () => {
    const html = generateOfflineHtmlReport({
      ...VALID_RESULT,
      reviews: [
        {
          ...review,
          category: '<img src=x onerror="alert(1)">' as never,
        },
      ],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('分類: &lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('一般 category 照常顯示', () => {
    const html = generateOfflineHtmlReport({ ...VALID_RESULT, reviews: [review] });
    expect(html).toContain('分類: bug');
  });
});
