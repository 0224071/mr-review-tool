import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGitLabMrNotes } from './gitlab-api';
import { GitLabNote } from '../types/gitlab';

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
