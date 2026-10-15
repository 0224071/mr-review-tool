// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { actAsync, createMemoryStore, flush, makeRecord, renderHook } from './test-utils';
import { useHistory, UseHistoryOptions } from './useHistory';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { HistoryRecord, HistoryStore } from '../core/history-store';
import type { GitLabMergeRequestInfo, GitLabNote } from '../types/gitlab';

const MR_URL = 'https://gitlab.example.com/grp/proj/-/merge_requests/7';
const NOTE = { id: 1, body: 'hi', author: { id: 1, name: 'a', username: 'a' }, created_at: '', system: false } as GitLabNote;

function setup(store: HistoryStore | null, over: Partial<UseHistoryOptions> = {}) {
  const gitlab = {
    resolveTarget: vi.fn(() => ({ baseUrl: 'https://gitlab.example.com', token: 't', projectPath: 'grp/proj', mrIid: 7 })),
    fetchMergeRequest: vi.fn(async () => ({ web_url: MR_URL, diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'new-head' } }) as GitLabMergeRequestInfo),
    fetchNotes: vi.fn(async () => [NOTE]),
  };
  const options: UseHistoryOptions = {
    openHistoryStore: vi.fn(async () => store),
    gitlab,
    settings: DEFAULT_SETTINGS,
    // 與 App 相同：開啟紀錄會把它設為目前紀錄
    onOpenRecord: vi.fn((record: HistoryRecord) => hook.result.current.setCurrentRecordId(record.id)),
    onRemoteNotes: vi.fn(),
    onActiveRecordRemoved: vi.fn(),
    ...over,
  };
  const hook = renderHook((o: UseHistoryOptions) => useHistory(o), options);
  return { ...hook, options, gitlab };
}

describe('useHistory', () => {
  it('無法開啟歷史紀錄時 historyAvailable 為 false', async () => {
    const { result } = setup(null);
    expect(result.current.historyAvailable).toBeNull();
    await flush();
    expect(result.current.historyAvailable).toBe(false);
    expect(result.current.historyStore).toBeNull();
  });

  it('啟動時清理並載入紀錄', async () => {
    const { store } = createMemoryStore([makeRecord({ id: 'a' }), makeRecord({ id: 'b' })]);
    const { result } = setup(store);
    await flush();
    expect(store.prune).toHaveBeenCalledTimes(1);
    expect(result.current.historyAvailable).toBe(true);
    expect(result.current.historyStore).toBe(store);
    expect(result.current.historyRecords.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('清理失敗時視為無法使用', async () => {
    const { store } = createMemoryStore();
    store.prune.mockRejectedValueOnce(new Error('boom'));
    const { result } = setup(store);
    await flush();
    expect(result.current.historyAvailable).toBe(false);
  });

  it('handleTogglePin 切換釘選並重新整理清單', async () => {
    const { store } = createMemoryStore([makeRecord({ id: 'a' })]);
    const { result } = setup(store);
    await flush();
    await actAsync(() => result.current.handleTogglePin('a'));
    expect(store.update).toHaveBeenCalledWith('a', { pinned: true });
    expect(result.current.historyRecords[0].pinned).toBe(true);
  });

  it('刪除目前顯示的紀錄才清空畫面', async () => {
    const { store } = createMemoryStore([makeRecord({ id: 'a' }), makeRecord({ id: 'b' })]);
    const { result, options } = setup(store);
    await flush();
    await actAsync(() => result.current.setCurrentRecordId('a'));

    await actAsync(() => result.current.handleDeleteRecord('b'));
    expect(options.onActiveRecordRemoved).not.toHaveBeenCalled();
    expect(result.current.historyRecords.map((r) => r.id)).toEqual(['a']);

    await actAsync(() => result.current.handleDeleteRecord('a'));
    expect(options.onActiveRecordRemoved).toHaveBeenCalledTimes(1);
    expect(result.current.historyRecords).toEqual([]);
  });

  it('清除未釘選：目前紀錄未釘選才清空畫面', async () => {
    const { store } = createMemoryStore([makeRecord({ id: 'pinned', pinned: true }), makeRecord({ id: 'loose' })]);
    const { result, options } = setup(store);
    await flush();

    await actAsync(() => result.current.setCurrentRecordId('pinned'));
    await actAsync(() => result.current.handleClearUnpinned());
    expect(options.onActiveRecordRemoved).not.toHaveBeenCalled();
    expect(result.current.historyRecords.map((r) => r.id)).toEqual(['pinned']);

    await actAsync(() => store.put(makeRecord({ id: 'loose' })));
    await actAsync(() => result.current.refreshHistory());
    await actAsync(() => result.current.setCurrentRecordId('loose'));
    await actAsync(() => result.current.handleClearUnpinned());
    expect(options.onActiveRecordRemoved).toHaveBeenCalledTimes(1);
  });

  it('開啟手動 diff 紀錄：關閉抽屜並套用，不連 GitLab', async () => {
    const record = makeRecord({ id: 'a' });
    const { store } = createMemoryStore([record]);
    const { result, options, gitlab } = setup(store);
    await flush();
    await actAsync(() => result.current.setIsHistoryOpen(true));

    await actAsync(() => result.current.handleOpenRecord('a'));
    expect(options.onOpenRecord).toHaveBeenCalledWith(record);
    expect(result.current.isHistoryOpen).toBe(false);
    expect(result.current.currentRecordId).toBe('a');
    expect(result.current.currentRecord).toEqual(record);
    expect(gitlab.fetchNotes).not.toHaveBeenCalled();
  });

  it('開啟 MR 紀錄：背景讀取留言，並記下最新 head SHA', async () => {
    const record = makeRecord({ id: 'mr', sourceType: 'gitlab', mrUrl: MR_URL, latestHeadSha: 'old-head' });
    const { store } = createMemoryStore([record]);
    const { result, options, gitlab } = setup(store);
    await flush();
    // GitLab 回應前畫面已更新（目前紀錄為 mr），與實際使用時相同
    let respond!: () => void;
    const latestMr = gitlab.fetchMergeRequest.getMockImplementation()!;
    gitlab.fetchMergeRequest.mockImplementationOnce(() => new Promise((r) => (respond = () => r(latestMr()))));

    let opening!: Promise<void>;
    await actAsync(() => {
      opening = result.current.handleOpenRecord('mr');
    });
    expect(options.onRemoteNotes).not.toHaveBeenCalled();
    await actAsync(async () => {
      respond();
      await opening;
    });
    expect(gitlab.resolveTarget).toHaveBeenCalledWith(MR_URL, DEFAULT_SETTINGS);
    expect(options.onRemoteNotes).toHaveBeenCalledWith([NOTE]);
    expect(store.update).toHaveBeenCalledWith('mr', { latestHeadSha: 'new-head' });
    expect(result.current.currentRecord?.latestHeadSha).toBe('new-head');
  });

  it('留言回來前已切到別的紀錄：不套用留言', async () => {
    const record = makeRecord({ id: 'mr', sourceType: 'gitlab', mrUrl: MR_URL });
    const { store } = createMemoryStore([record, makeRecord({ id: 'other' })]);
    const { result, options, gitlab } = setup(store);
    await flush();
    let respond!: () => void;
    const latestMr = gitlab.fetchMergeRequest.getMockImplementation()!;
    gitlab.fetchMergeRequest.mockImplementationOnce(() => new Promise((r) => (respond = () => r(latestMr()))));

    let opening!: Promise<void>;
    await actAsync(() => {
      opening = result.current.handleOpenRecord('mr');
    });
    await actAsync(() => result.current.setCurrentRecordId('other'));
    await actAsync(async () => {
      respond();
      await opening;
    });
    expect(options.onRemoteNotes).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });

  it('開啟不存在的紀錄：只重新整理清單', async () => {
    const { store } = createMemoryStore([makeRecord({ id: 'a' })]);
    const { result, options } = setup(store);
    await flush();
    store.list.mockClear();
    await actAsync(() => result.current.handleOpenRecord('gone'));
    expect(options.onOpenRecord).not.toHaveBeenCalled();
    expect(store.list).toHaveBeenCalledTimes(1);
  });
});
