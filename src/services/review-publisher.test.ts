import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDiscussionPosition, publishReviewItem } from './review-publisher';
import { MRReviewItem } from '../types/review';
import { GitLabDiffRefs } from '../types/gitlab';

const TARGET = { baseUrl: 'https://gitlab.example.com', token: 'tkn', projectPath: 'grp/proj', mrIid: 7 };
const REFS: GitLabDiffRefs = { base_sha: 'base0000aaaa', start_sha: 'start000bbbb', head_sha: 'head1111cccc' };

const review = (over: Partial<MRReviewItem> = {}): MRReviewItem => ({
  groupId: 'g1',
  category: 'bug',
  severity: 'high',
  file: 'src/cart.ts',
  line: 10,
  newLine: 10,
  oldLine: null,
  lineVerified: true,
  codeSnippet: 'x',
  comment: '折扣金額未檢查負數',
  suggestion: '加上 Math.max(0, discount)',
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; method: string; body?: { body: string; position?: Record<string, unknown> } };

/** 依路徑與 method 回應；記錄所有呼叫 */
function mockGitLab(handlers: {
  discussion: (body: Call['body'], nth: number) => Response;
  mrHeadSha?: string | null;
}) {
  const calls: Call[] = [];
  let discussionCount = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const path = new URL(url).pathname;
    if (method === 'POST' && path.endsWith('/merge_requests/7/discussions')) {
      return handlers.discussion(body, discussionCount++);
    }
    if (method === 'GET' && path.endsWith('/merge_requests/7')) {
      if (handlers.mrHeadSha === null) return json({ message: 'boom' }, 500);
      return json({ iid: 7, diff_refs: { ...REFS, head_sha: handlers.mrHeadSha ?? REFS.head_sha } });
    }
    return json({ message: 'unexpected' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('publishReviewItem', () => {
  it('已驗證：以 /discussions 帶 position 發行內留言', async () => {
    const calls = mockGitLab({ discussion: () => json({ id: 'disc-inline' }) });
    const res = await publishReviewItem(TARGET, review(), 'c', 's', REFS);
    expect(res).toEqual({ discussionId: 'disc-inline', mode: 'inline' });
    expect(calls).toHaveLength(1);
    expect(calls[0].body?.position).toMatchObject({ head_sha: REFS.head_sha, new_path: 'src/cart.ts', new_line: 10 });
    expect(calls[0].body?.position).not.toHaveProperty('old_line');
  });

  it('未驗證：一般留言也走 /discussions、不帶 position，回傳 discussion id', async () => {
    const calls = mockGitLab({ discussion: () => json({ id: 'disc-general' }) });
    const r = review({ line: null, newLine: null, oldLine: null, lineVerified: false });
    const res = await publishReviewItem(TARGET, r, '意見', '建議', REFS);
    expect(res).toEqual({ discussionId: 'disc-general', mode: 'general' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe('/api/v4/projects/grp%2Fproj/merge_requests/7/discussions');
    expect(calls[0].body?.position).toBeUndefined();
    expect(calls[0].body?.body.startsWith('src/cart.ts（行號未驗證）\n\n**[HIGH] BUG**: 意見')).toBe(true);
    expect(calls.some((c) => c.url.includes('/notes'))).toBe(false);
  });

  it('未驗證但行號來自 diff：前綴帶行號', async () => {
    const calls = mockGitLab({ discussion: () => json({ id: 'd' }) });
    await publishReviewItem(TARGET, review({ line: 4, newLine: 4, oldLine: 3, lineVerified: false }), 'c', 's', REFS);
    expect(calls[0].body?.body.startsWith('src/cart.ts:4（行號未驗證）')).toBe(true);
  });

  it.each([400, 500])('行內留言 %i 且 head_sha 已更新：改發一般留言並回傳改發原因', async (status) => {
    const calls = mockGitLab({
      discussion: (_b, nth) => (nth === 0 ? json({ message: 'line_code can not be blank' }, status) : json({ id: 'disc-fb' })),
      mrHeadSha: 'newhead9999dddd',
    });
    const res = await publishReviewItem(TARGET, review(), '意見', '建議', REFS);
    expect(res.mode).toBe('stale-fallback');
    expect(res.discussionId).toBe('disc-fb');
    expect(res.fallbackReason).toContain('head1111');
    expect(res.fallbackReason).toContain('newhead9');
    expect(res.fallbackReason).not.toContain('line_code');

    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1].body?.position).toBeUndefined();
    expect(posts[1].body?.body.startsWith('src/cart.ts:10（版本已更新）\n\n**[HIGH] BUG**: 意見')).toBe(true);
  });

  it('行內留言失敗但 head_sha 相同：不改發，拋出原始錯誤', async () => {
    const calls = mockGitLab({ discussion: () => json({ message: 'bad position' }, 400) });
    await expect(publishReviewItem(TARGET, review(), 'c', 's', REFS)).rejects.toThrow('發布 Discussion 失敗 (400)：bad position');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('讀取 MR 失敗無法判斷版本：拋出原始錯誤', async () => {
    mockGitLab({ discussion: () => json({ message: 'bad position' }, 400), mrHeadSha: null });
    await expect(publishReviewItem(TARGET, review(), 'c', 's', REFS)).rejects.toThrow('(400)');
  });

  it('其他 status（例如 403）不嘗試改發', async () => {
    const calls = mockGitLab({ discussion: () => json({ message: 'forbidden' }, 403), mrHeadSha: 'newhead' });
    await expect(publishReviewItem(TARGET, review(), 'c', 's', REFS)).rejects.toThrow('(403)');
    expect(calls).toHaveLength(1);
  });

  it('沒有 diff_refs 時以一般留言送出（不帶 position）', async () => {
    const calls = mockGitLab({ discussion: () => json({ id: 'd' }) });
    const res = await publishReviewItem(TARGET, review(), 'c', 's', undefined);
    expect(res.mode).toBe('general');
    expect(calls[0].body?.position).toBeUndefined();
  });
});

describe('buildDiscussionPosition', () => {
  it('新增行只帶 new_line、刪除行只帶 old_line、未變更行兩者都帶', () => {
    expect(buildDiscussionPosition(review({ newLine: 5, oldLine: null }), REFS)).toMatchObject({ new_line: 5 });
    const del = buildDiscussionPosition(review({ newLine: null, oldLine: 8 }), REFS);
    expect(del).toMatchObject({ old_line: 8 });
    expect(del).not.toHaveProperty('new_line');
    expect(buildDiscussionPosition(review({ newLine: 6, oldLine: 5 }), REFS)).toMatchObject({ new_line: 6, old_line: 5 });
  });

  it('沒有任何行號時回傳 undefined', () => {
    expect(buildDiscussionPosition(review({ line: null, newLine: null, oldLine: null }), REFS)).toBeUndefined();
  });
});
