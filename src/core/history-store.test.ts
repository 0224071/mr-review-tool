import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  buildDiffHistoryKey,
  buildMrHistoryKey,
  formatHistoryTime,
  hashString,
  hasNewCommit,
  HISTORY_MAX_AGE_MS,
  HistoryRecord,
  HistoryStore,
  openHistoryStore,
  sanitizeForStorage,
  selectRecordsToPrune,
  sortHistoryRecords,
  toMrSnapshot,
} from './history-store';
import { MRAnalysisResult } from '../types/review';
import { GitLabMergeRequestInfo } from '../types/gitlab';

const NOW = Date.UTC(2026, 9, 15, 2, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const RESULT: MRAnalysisResult = {
  schemaVersion: 1,
  title: 'feat: 測試',
  description: 'desc',
  summary: ['a'],
  testSuggestions: [],
  groups: [{ id: 'g1', name: 'G', summary: 's', files: ['a.ts'], additions: 1, deletions: 0 }],
  graph: { nodes: [], edges: [] },
  checklistCoverage: [{ id: 'c1', hit: true, files: ['a.ts'] }],
  reviews: [
    {
      groupId: 'g1',
      category: 'bug',
      severity: 'high',
      file: 'a.ts',
      line: 3,
      codeSnippet: 'x',
      comment: '請處理 token 過期的情況',
      suggestion: '加上 refresh',
    },
  ],
};

function makeRecord(id: string, analyzedAt: number, pinned = false): HistoryRecord {
  return {
    id,
    sourceType: 'manual',
    title: id,
    rawDiff: 'diff --git a/a.ts b/a.ts',
    analyzedAt,
    result: RESULT,
    selectedIndices: [0],
    draftEdits: {},
    published: [],
    pinned,
  };
}

describe('history keys', () => {
  it('MR key = host + project path + iid，忽略協定與大小寫', () => {
    expect(buildMrHistoryKey('https://GitLab.Example.com/', 'Group/Proj', 12)).toBe(
      'mr:gitlab.example.com/group/proj!12'
    );
    expect(buildMrHistoryKey('http://gitlab.example.com:8080', 'g/p', 1)).toBe('mr:gitlab.example.com:8080/g/p!1');
    expect(buildMrHistoryKey('https://a.com', 'g/p', 1)).not.toBe(buildMrHistoryKey('https://b.com', 'g/p', 1));
  });

  it('diff key 只依內容，換行格式不影響', () => {
    const a = buildDiffHistoryKey('line1\nline2\n');
    expect(a).toMatch(/^diff:[0-9a-f]+$/);
    expect(buildDiffHistoryKey('line1\r\nline2')).toBe(a);
    expect(buildDiffHistoryKey('line1\nline3')).not.toBe(a);
  });

  it('hashString 為穩定輸出', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('pure helpers', () => {
  it('hasNewCommit 只在兩個 SHA 都存在且不同時為 true', () => {
    expect(hasNewCommit({ headSha: 'a', latestHeadSha: 'b' })).toBe(true);
    expect(hasNewCommit({ headSha: 'a', latestHeadSha: 'a' })).toBe(false);
    expect(hasNewCommit({ headSha: 'a', latestHeadSha: null })).toBe(false);
    expect(hasNewCommit({ headSha: undefined, latestHeadSha: 'b' })).toBe(false);
  });

  it('formatHistoryTime 輸出 YYYY/MM/DD HH:mm', () => {
    expect(formatHistoryTime(new Date(2026, 0, 5, 9, 7).getTime())).toBe('2026/01/05 09:07');
  });

  it('排序：釘選在前，其餘新到舊', () => {
    const sorted = sortHistoryRecords([
      makeRecord('old', NOW - 3 * DAY),
      makeRecord('pinnedOld', NOW - 10 * DAY, true),
      makeRecord('new', NOW),
      makeRecord('pinnedNew', NOW - DAY, true),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['pinnedNew', 'pinnedOld', 'new', 'old']);
  });
});

describe('selectRecordsToPrune', () => {
  it('刪除超過 30 天的未釘選紀錄，釘選豁免', () => {
    const ids = selectRecordsToPrune(
      [
        makeRecord('fresh', NOW - DAY),
        makeRecord('expired', NOW - HISTORY_MAX_AGE_MS - 1),
        makeRecord('expiredPinned', NOW - 90 * DAY, true),
      ],
      NOW
    );
    expect(ids).toEqual(['expired']);
  });

  it('第 51 筆時刪除最舊的未釘選紀錄', () => {
    const records = Array.from({ length: 51 }, (_, i) => makeRecord(`r${i}`, NOW - (51 - i) * 1000));
    records[0].pinned = true; // 最舊的是釘選 → 不刪
    expect(selectRecordsToPrune(records, NOW)).toEqual(['r1']);
  });

  it('釘選超過上限時不刪釘選紀錄', () => {
    const records = Array.from({ length: 52 }, (_, i) => makeRecord(`p${i}`, NOW - i, true));
    expect(selectRecordsToPrune(records, NOW)).toEqual([]);
  });
});

describe('sanitizeForStorage', () => {
  it('移除名稱像 key/token 的欄位（任意深度），保留其他內容', () => {
    const dirty = {
      title: 't',
      gitlabToken: 'glpat-SECRET',
      nested: { geminiApiKey: 'AIza-SECRET', api_key: 'x', 'PRIVATE-TOKEN': 'y', keep: 1 },
      list: [{ access_token: 'z', ok: true }],
      result: RESULT,
    };
    const clean = sanitizeForStorage(dirty);
    const json = JSON.stringify(clean);
    expect(json).not.toContain('SECRET');
    expect(json).not.toMatch(/"(gitlabToken|geminiApiKey|api_key|PRIVATE-TOKEN|access_token)"/);
    expect(clean.nested).toEqual({ keep: 1 });
    expect(clean.list).toEqual([{ ok: true }]);
    // 意見內文提到 token 不受影響（只依欄位名稱判斷）
    expect(clean.result.reviews[0].comment).toContain('token');
  });

  it('toMrSnapshot 只保留白名單欄位', () => {
    const mr = {
      id: 1,
      iid: 2,
      project_id: 3,
      title: 'T',
      description: 'D',
      state: 'opened',
      created_at: '',
      updated_at: '',
      web_url: 'https://gitlab.com/g/p/-/merge_requests/2',
      target_branch: 'main',
      source_branch: 'feat',
      author: { id: 1, name: 'n', username: 'u', avatar_url: 'x' },
      diff_refs: { base_sha: 'b', head_sha: 'h', start_sha: 's' },
      private_token: 'leak',
    } as unknown as GitLabMergeRequestInfo;
    const snap = toMrSnapshot(mr);
    expect(JSON.stringify(snap)).not.toContain('leak');
    expect(snap.diff_refs?.head_sha).toBe('h');
  });
});

describe('IndexedDB HistoryStore', () => {
  let factory: IDBFactory;
  let store: HistoryStore;

  beforeEach(async () => {
    factory = new IDBFactory();
    const opened = await openHistoryStore(factory);
    expect(opened).not.toBeNull();
    store = opened!;
  });

  it('沒有 IndexedDB 時回傳 null', async () => {
    expect(await openHistoryStore(undefined)).toBeNull();
  });

  it('put / get 保留完整結果、編輯勾選與發布狀態', async () => {
    const rec: HistoryRecord = {
      ...makeRecord('mr:gitlab.com/g/p!1', NOW),
      sourceType: 'gitlab',
      headSha: 'h1',
      selectedIndices: [0],
      draftEdits: { 0: { comment: 'edited', suggestion: 's' } },
      published: [{ contentHash: 'c', originalHash: 'o', file: 'a.ts', line: 3, publishedAt: NOW, discussionId: 'd1' }],
    };
    await store.put(rec, NOW);
    const got = await store.get(rec.id);
    expect(got).toEqual(rec);
  });

  it('put 不會把 key / token 寫進 IndexedDB', async () => {
    const leaky = {
      ...makeRecord('x', NOW),
      geminiApiKey: 'AIza-TOP-SECRET',
      mr: { web_url: 'u', token: 'glpat-TOP-SECRET' },
    } as unknown as HistoryRecord;
    await store.put(leaky, NOW);
    const all = await store.list();
    expect(JSON.stringify(all)).not.toContain('TOP-SECRET');
  });

  it('update 合併欄位；不存在的 id 回傳 undefined', async () => {
    await store.put(makeRecord('a', NOW), NOW);
    const next = await store.update('a', { pinned: true, latestHeadSha: 'h2' });
    expect(next?.pinned).toBe(true);
    expect((await store.get('a'))?.latestHeadSha).toBe('h2');
    expect(await store.update('missing', { pinned: true })).toBeUndefined();
  });

  it('新增第 51 筆時自動刪除最舊未釘選紀錄', async () => {
    for (let i = 0; i < 50; i++) {
      await store.put({ ...makeRecord(`r${i}`, NOW - (60 - i) * 1000), pinned: i === 0 }, NOW);
    }
    const removed = await store.put(makeRecord('r50', NOW), NOW);
    expect(removed).toEqual(['r1']);
    const ids = (await store.list()).map((r) => r.id);
    expect(ids).toHaveLength(50);
    expect(ids).toContain('r0');
    expect(ids).not.toContain('r1');
    expect(ids[0]).toBe('r0'); // 釘選在前
  });

  it('prune 清除超過 30 天的未釘選紀錄', async () => {
    await store.put(makeRecord('old', NOW - 31 * DAY), NOW - 31 * DAY);
    await store.put(makeRecord('oldPinned', NOW - 31 * DAY, true), NOW - 31 * DAY);
    await store.put(makeRecord('new', NOW), NOW - 31 * DAY);
    expect(await store.prune(NOW)).toEqual(['old']);
    expect((await store.list()).map((r) => r.id).sort()).toEqual(['new', 'oldPinned']);
  });

  it('remove 與 clearUnpinned', async () => {
    await store.put(makeRecord('a', NOW), NOW);
    await store.put(makeRecord('b', NOW - 1, true), NOW);
    await store.put(makeRecord('c', NOW - 2), NOW);
    await store.remove('a');
    expect(await store.clearUnpinned()).toBe(1);
    expect((await store.list()).map((r) => r.id)).toEqual(['b']);
  });

  it('重新開啟資料庫後資料仍在（模擬重整）', async () => {
    await store.put(makeRecord('persist', NOW), NOW);
    const reopened = await openHistoryStore(factory);
    expect((await reopened!.get('persist'))?.title).toBe('persist');
  });
});
