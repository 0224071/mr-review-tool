import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGitLabDiscussion,
  createGitLabGeneralDiscussion,
  fetchGitLabMrNotes,
  fetchGitLabMrRawDiff,
  findSharedAnalysisInNotes,
  GitLabApiError,
  isSharedAnalysisCurrent,
  postSharedAnalysisToMr,
  SHARED_TAG_END,
  SHARED_TAG_START,
  verifyGitlabToken,
} from './gitlab-api';
import { SAMPLE_ANALYSIS_RESULT } from './diff-sources/sample-analysis';
import { GitLabNote } from '../types/gitlab';
import { MIXED_CONTENT_MESSAGE } from '../core/mixed-content';

const note = (id: number): GitLabNote => ({
  id,
  body: `note ${id}`,
  author: { id: 1, name: 'n', username: 'u' },
  created_at: '2026-10-01T00:00:00Z',
  system: false,
});

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => note(from + i));

const jsonResponse = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const pageOf = (url: string) => Number(new URL(url).searchParams.get('page'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchGitLabMrNotes', () => {
  it('依 x-next-page 讀取全部頁面（per_page=100）', async () => {
    const pages: Record<number, GitLabNote[]> = { 1: range(1, 100), 2: range(101, 100), 3: range(201, 7) };
    const fetchMock = vi.fn(async (url: string) => {
      const p = pageOf(url);
      return jsonResponse(pages[p], { 'x-page': String(p), 'x-next-page': p < 3 ? String(p + 1) : '' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const notes = await fetchGitLabMrNotes('https://gitlab.example.com/', 'tkn', 'grp/proj', 7);

    expect(notes).toHaveLength(207);
    expect(notes.map((n) => n.id)).toEqual(range(1, 207).map((n) => n.id));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map(([u]) => new URL(u));
    expect(urls.map((u) => u.searchParams.get('page'))).toEqual(['1', '2', '3']);
    urls.forEach((u) => {
      expect(u.pathname).toBe('/api/v4/projects/grp%2Fproj/merge_requests/7/notes');
      expect(u.searchParams.get('per_page')).toBe('100');
    });
  });

  it('最舊的留言在第 2 頁之後仍會被讀到（不只最新 100 則）', async () => {
    const oldest = { ...note(999), body: '已發布的舊意見' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        pageOf(url) === 1
          ? jsonResponse(range(1, 100), { 'x-next-page': '2' })
          : jsonResponse([oldest], { 'x-next-page': '' })
      )
    );
    const notes = await fetchGitLabMrNotes('https://gitlab.com', 't', 'a/b', 1);
    expect(notes.some((n) => n.body === '已發布的舊意見')).toBe(true);
  });

  it('只有一頁時只發一次請求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(range(1, 12), { 'x-next-page': '', 'x-total-pages': '1' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchGitLabMrNotes('https://gitlab.com', 't', 'a/b', 1)).toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('沒有分頁 header 時以滿頁筆數判斷是否繼續', async () => {
    const pages: Record<number, GitLabNote[]> = { 1: range(1, 100), 2: range(101, 3) };
    const fetchMock = vi.fn(async (url: string) => jsonResponse(pages[pageOf(url)] ?? []));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchGitLabMrNotes('https://gitlab.com', 't', 'a/b', 1)).toHaveLength(103);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('第一頁失敗回傳空陣列', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: '403' }, {}, 403)));
    expect(await fetchGitLabMrNotes('https://gitlab.com', 't', 'a/b', 1)).toEqual([]);
  });

  it('之後的頁面失敗時拋錯，不回傳不完整的留言', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        pageOf(url) === 1 ? jsonResponse(range(1, 100), { 'x-next-page': '2' }) : jsonResponse({}, {}, 500)
      )
    );
    await expect(fetchGitLabMrNotes('https://gitlab.com', 't', 'a/b', 1)).rejects.toThrow('第 2 頁');
  });

  it('x-next-page 不前進時停止，避免無限迴圈', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(range(1, 100), { 'x-next-page': '1' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchGitLabMrNotes('https://gitlab.com', 't', 'a/b', 1)).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createGitLabDiscussion / createGitLabGeneralDiscussion', () => {
  it('一般留言 POST /discussions、只帶 body，回傳 discussion id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'abc123', notes: [{ id: 55 }] }, {}, 201));
    vi.stubGlobal('fetch', fetchMock);
    const res = await createGitLabGeneralDiscussion('https://gitlab.com/', 't', 'a/b', 3, 'hello');
    expect(res).toEqual({ id: 'abc123' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v4/projects/a%2Fb/merge_requests/3/discussions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ body: 'hello' });
  });

  it('失敗時拋出帶 status 的 GitLabApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'line_code invalid' }, {}, 400)));
    const err = await createGitLabDiscussion('https://gitlab.com', 't', 'a/b', 3, { body: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(GitLabApiError);
    expect(err.status).toBe(400);
    expect(err.message).toContain('line_code invalid');
  });
});

describe('混合內容防護', () => {
  it('https 頁面連 http GitLab 時不發出請求並回傳提示', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { protocol: 'https:' });

    await expect(fetchGitLabMrNotes('http://gitlab.example.com', 't', 'g/p', 1)).rejects.toThrow(
      MIXED_CONTENT_MESSAGE
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('一般留言（discussions）同樣受混合內容檢查', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { protocol: 'https:' });

    await expect(
      createGitLabGeneralDiscussion('http://gitlab.example.com', 't', 'g/p', 1, 'hi')
    ).rejects.toThrow(MIXED_CONTENT_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchGitLabMrRawDiff', () => {
  it('先打 raw_diffs（複數；單數 raw_diff 會 404），有內容就直接使用', async () => {
    const fetchMock = vi.fn(async () => new Response('diff --git a/x b/x\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const text = await fetchGitLabMrRawDiff('https://gitlab.com/', 'tkn', 'grp/proj', 1);
    expect(text).toBe('diff --git a/x b/x\n');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      'https://gitlab.com/api/v4/projects/grp%2Fproj/merge_requests/1/raw_diffs'
    );
  });

  it('raw_diffs 不可用（舊版 GitLab 404）時改用 /diffs 組回 unified diff', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/raw_diffs')
        ? jsonResponse({ error: '404 Not Found' }, {}, 404)
        : jsonResponse([{ old_path: 'a.ts', new_path: 'a.ts', new_file: true, diff: '@@ -0,0 +1 @@\n+x\n' }])
    );
    vi.stubGlobal('fetch', fetchMock);
    const text = await fetchGitLabMrRawDiff('https://gitlab.com', 'tkn', 'grp/proj', 1);
    expect(text).toContain('+++ b/a.ts');
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toContain('/merge_requests/1/diffs?per_page=100');
  });
});

describe('verifyGitlabToken', () => {
  it('成功時回傳使用者資訊，並以 PRIVATE-TOKEN 呼叫 /api/v4/user', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ id: 42, username: 'dragon', name: 'Dragon', email: 'x@example.com' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const user = await verifyGitlabToken('https://gitlab.example.com', ' tkn ');

    expect(user).toEqual({ id: 42, username: 'dragon', name: 'Dragon' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gitlab.example.com/api/v4/user');
    expect((init?.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('tkn');
  });

  it('去除 Base URL 尾端斜線（含多個），留空時預設 https://gitlab.com', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ id: 1, username: 'u', name: 'n' }));
    vi.stubGlobal('fetch', fetchMock);

    await verifyGitlabToken('https://gitlab.example.com/', 't');
    await verifyGitlabToken('https://gitlab.example.com//', 't');
    await verifyGitlabToken('  ', 't');

    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      'https://gitlab.example.com/api/v4/user',
      'https://gitlab.example.com/api/v4/user',
      'https://gitlab.com/api/v4/user',
    ]);
  });

  it('401 時拋出 GitLabApiError 並說明 Token 無效或過期', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: '401 Unauthorized' }, {}, 401)));

    const err = await verifyGitlabToken('https://gitlab.com', 'bad').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GitLabApiError);
    expect((err as GitLabApiError).status).toBe(401);
    expect((err as Error).message).toMatch(/無效或已過期/);
  });

  it('其他非 2xx 狀態帶出 status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, {}, 500)));

    await expect(verifyGitlabToken('https://gitlab.com', 't')).rejects.toThrow('GitLab 連線失敗 (500)');
  });

  it('網路錯誤（fetch reject，例如 CORS）轉成可讀的連線失敗訊息', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await expect(verifyGitlabToken('https://gitlab.com', 't')).rejects.toThrow(/無法連線至 GitLab/);
  });

  it('未填 Token 時不送出請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyGitlabToken('https://gitlab.com', '  ')).rejects.toThrow('請先填入 Personal Access Token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('https 頁面連 http GitLab 時直接回報混合內容，不送出請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { protocol: 'https:' });

    await expect(verifyGitlabToken('http://gitlab.example.com', 't')).rejects.toThrow(MIXED_CONTENT_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('共享分析標記（headSha）', () => {
  const FAKE_HEAD = 'FAKE-head-sha-1';
  const FAKE_TOKEN = 'FAKE-token';
  const sharedNote = (json: unknown, id = 7): GitLabNote => ({
    ...note(id),
    author: { id: 1, name: 'Ann', username: 'ann' },
    body: `### 報告\n${SHARED_TAG_START}\n\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`\n${SHARED_TAG_END}`,
  });

  /** 攔下 postSharedAnalysisToMr 送出的留言內文（不連網） */
  async function postedBody(headSha?: string | null, targetNoteId: number | null = null) {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 99 }, {}, 201));
    vi.stubGlobal('fetch', fetchMock);
    await postSharedAnalysisToMr('https://gitlab.com', FAKE_TOKEN, 'a/b', 3, SAMPLE_ANALYSIS_RESULT, targetNoteId, headSha);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url, init, body: JSON.parse(String(init.body)).body as string };
  }

  it('分享留言的標記 JSON 帶分析時的 headSha，解析後 result 不含 headSha', async () => {
    const { url, init, body } = await postedBody(FAKE_HEAD);
    expect(init.method).toBe('POST');
    expect(new URL(url).pathname).toBe('/api/v4/projects/a%2Fb/merge_requests/3/notes');
    expect(body).toContain(`"headSha": "${FAKE_HEAD}"`);

    const shared = findSharedAnalysisInNotes([{ ...note(1), body }]);
    expect(shared?.headSha).toBe(FAKE_HEAD);
    expect(shared?.result).toEqual(SAMPLE_ANALYSIS_RESULT);
    expect(shared?.result).not.toHaveProperty('headSha');
  });

  it('沒有 head sha 時不寫入 headSha 欄位；覆寫既有留言時用 PUT', async () => {
    const { init, body } = await postedBody(null, 12);
    expect(init.method).toBe('PUT');
    expect(body).not.toContain('headSha');
    expect(findSharedAnalysisInNotes([{ ...note(1), body }])?.headSha).toBeNull();
  });

  it('舊版標記（沒有 headSha）解析為 null；非字串的 headSha 也視為沒有', () => {
    expect(findSharedAnalysisInNotes([sharedNote(SAMPLE_ANALYSIS_RESULT)])).toMatchObject({
      noteId: 7,
      author: { name: 'Ann', username: 'ann' },
      headSha: null,
    });
    expect(findSharedAnalysisInNotes([sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: 123 })])?.headSha).toBeNull();
    expect(findSharedAnalysisInNotes([sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: '' })])?.headSha).toBeNull();
  });

  it('作者同時保留顯示名稱與 username', () => {
    expect(findSharedAnalysisInNotes([sharedNote(SAMPLE_ANALYSIS_RESULT)])?.author).toEqual({ name: 'Ann', username: 'ann' });
  });

  it('不認得的 category 正規化為預設分類「other」、不認得的 severity 為 medium；認得的值不變（#71）', () => {
    const [first, second, ...rest] = SAMPLE_ANALYSIS_RESULT.reviews;
    const shared = findSharedAnalysisInNotes([
      sharedNote({
        ...SAMPLE_ANALYSIS_RESULT,
        reviews: [{ ...first, category: 'FAKE-unknown-category' }, { ...second, severity: 'FAKE-critical' }, ...rest],
      }),
    ]);
    expect(shared?.result.reviews[0].category).toBe('other');
    expect(shared?.result.reviews[0].severity).toBe(first.severity);
    expect(shared?.result.reviews[1].category).toBe(second.category);
    expect(shared?.result.reviews[1].severity).toBe('medium');
    expect(shared?.result.reviews.slice(2)).toEqual(rest);
  });

  it('reviews 不是陣列時視為沒有意見，非物件的項目略過', () => {
    expect(findSharedAnalysisInNotes([sharedNote({ ...SAMPLE_ANALYSIS_RESULT, reviews: 'FAKE' })])?.result.reviews).toEqual([]);
    const [first] = SAMPLE_ANALYSIS_RESULT.reviews;
    expect(
      findSharedAnalysisInNotes([sharedNote({ ...SAMPLE_ANALYSIS_RESULT, reviews: [null, 3, first] })])?.result.reviews
    ).toEqual([first]);
  });

  it('schemaVersion 不符的標記不採用', () => {
    expect(findSharedAnalysisInNotes([sharedNote({ ...SAMPLE_ANALYSIS_RESULT, schemaVersion: 2, headSha: FAKE_HEAD })])).toBeNull();
  });

  it('isSharedAnalysisCurrent：兩邊都有且相同才算目前版本', () => {
    expect(isSharedAnalysisCurrent({ headSha: FAKE_HEAD }, FAKE_HEAD)).toBe(true);
    expect(isSharedAnalysisCurrent({ headSha: FAKE_HEAD }, 'FAKE-head-sha-2')).toBe(false);
    expect(isSharedAnalysisCurrent({ headSha: null }, FAKE_HEAD)).toBe(false);
    expect(isSharedAnalysisCurrent({ headSha: FAKE_HEAD }, null)).toBe(false);
    expect(isSharedAnalysisCurrent({ headSha: FAKE_HEAD }, undefined)).toBe(false);
  });
});
