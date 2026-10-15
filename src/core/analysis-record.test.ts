import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  buildAnalysisRecord,
  buildProviderCacheKey,
  cacheKeyCandidates,
  findCachedRecord,
  HistorySourceInfo,
  shouldServeFromCache,
} from './analysis-record';
import { buildMrHistoryKey, HistoryRecord, openHistoryStore } from './history-store';
import { createPublishedRecord } from './publish-dedup';
import { MRAnalysisResult, MRReviewItem } from '../types/review';
import { GitLabMergeRequestInfo, GitLabNote } from '../types/gitlab';

const NOW = Date.UTC(2026, 9, 15, 2, 0, 0);
const KEY = buildMrHistoryKey('https://gitlab.com', 'grp/proj', 1);

const review = (over: Partial<MRReviewItem> = {}): MRReviewItem => ({
  groupId: 'g1',
  category: 'bug',
  severity: 'high',
  file: 'src/a.ts',
  line: 3,
  codeSnippet: 'x',
  comment: '分頁起始索引少減一，第一頁會跳過資料',
  suggestion: '改成 (page - 1) * pageSize',
  ...over,
});

const result = (reviews: MRReviewItem[]): MRAnalysisResult => ({
  schemaVersion: 1,
  title: 'feat',
  description: 'd',
  summary: [],
  testSuggestions: [],
  groups: [{ id: 'g1', name: 'G', summary: 's', files: ['src/a.ts'], additions: 1, deletions: 0 }],
  graph: { nodes: [], edges: [] },
  checklistCoverage: [],
  reviews,
});

const mr = (headSha: string): GitLabMergeRequestInfo =>
  ({
    id: 10,
    iid: 1,
    project_id: 5,
    title: 'MR 標題',
    description: '',
    state: 'opened',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    web_url: 'https://gitlab.com/grp/proj/-/merge_requests/1',
    target_branch: 'main',
    source_branch: 'feat',
    author: { id: 1, name: 'n', username: 'u' },
    diff_refs: { base_sha: 'b', head_sha: headSha, start_sha: 'b' },
  }) as GitLabMergeRequestInfo;

const source: HistorySourceInfo = { id: KEY, sourceType: 'gitlab', host: 'gitlab.com', projectPath: 'grp/proj', mrIid: 1 };

describe('shouldServeFromCache', () => {
  it('不是正在顯示的紀錄且版本相同 → 直接顯示快取', () => {
    expect(shouldServeFromCache({ sourceId: KEY, currentRecordId: null, cached: { headSha: 'h1' }, currentHeadSha: 'h1' })).toBe(true);
  });

  it('正在顯示的紀錄再按「分析」→ 重新分析', () => {
    expect(shouldServeFromCache({ sourceId: KEY, currentRecordId: KEY, cached: { headSha: 'h1' }, currentHeadSha: 'h1' })).toBe(false);
  });

  it('有新 commit → 重新分析', () => {
    expect(shouldServeFromCache({ sourceId: KEY, currentRecordId: null, cached: { headSha: 'h1' }, currentHeadSha: 'h2' })).toBe(false);
  });

  it('沒有快取 → 分析', () => {
    expect(shouldServeFromCache({ sourceId: KEY, currentRecordId: null, cached: undefined, currentHeadSha: 'h1' })).toBe(false);
  });
});

describe('buildAnalysisRecord（重新分析）', () => {
  it('保留既有已發布紀錄與釘選，已發布意見預設不勾選', () => {
    const r1 = review();
    const r2 = review({ file: 'src/b.ts', comment: '收藏清單 JSON.parse 未防呆會讓頁面崩潰' });
    const pub = createPublishedRecord(r1, r1.comment, r1.suggestion, 'disc-1', NOW - 1000);
    const existing = {
      published: [pub],
      pinned: true,
      draftEdits: { 0: { comment: '舊草稿', suggestion: '' } },
    } as unknown as HistoryRecord;

    const rec = buildAnalysisRecord({
      source,
      result: result([r2, r1]),
      diffText: 'diff',
      mr: mr('h2'),
      notes: [],
      existing,
      now: NOW,
    });

    expect(rec.published).toEqual([pub]);
    expect(rec.pinned).toBe(true);
    expect(rec.analyzedAt).toBe(NOW);
    expect(rec.headSha).toBe('h2');
    expect(rec.latestHeadSha).toBe('h2');
    expect(rec.draftEdits).toEqual({});
    // r1（index 1）已發布 → 不勾選；r2 勾選
    expect(rec.selectedIndices).toEqual([0]);
  });

  it('MR 現有留言中已發布的意見也預設不勾選', () => {
    const r1 = review();
    const notes: GitLabNote[] = [
      {
        id: 1,
        body: `**[HIGH] BUG**: ${r1.comment}`,
        author: { id: 1, name: 'n', username: 'u' },
        created_at: '2026-10-01T00:00:00Z',
        system: false,
        position: { new_path: 'src/a.ts', old_path: 'src/a.ts' } as GitLabNote['position'],
      },
    ];
    const rec = buildAnalysisRecord({ source, result: result([r1]), diffText: 'd', mr: mr('h1'), notes, existing: undefined, now: NOW });
    expect(rec.selectedIndices).toEqual([]);
    expect(rec.published).toEqual([]);
    expect(rec.pinned).toBe(false);
  });

  it('寫回 IndexedDB 後已發布紀錄仍在（同一個 key 覆寫）', async () => {
    const store = await openHistoryStore(new IDBFactory());
    expect(store).not.toBeNull();
    const r1 = review();
    const pub = createPublishedRecord(r1, r1.comment, r1.suggestion, 'disc-1', NOW - 1000);
    const first = buildAnalysisRecord({ source, result: result([r1]), diffText: 'd', mr: mr('h1'), notes: [], existing: undefined, now: NOW - 2000 });
    await store!.put({ ...first, published: [pub] }, NOW - 2000);

    const existing = await store!.get(KEY);
    const again = buildAnalysisRecord({ source, result: result([r1]), diffText: 'd', mr: mr('h1'), notes: [], existing, now: NOW });
    await store!.put(again, NOW);

    const list = await store!.list();
    expect(list).toHaveLength(1);
    expect(list[0].analyzedAt).toBe(NOW);
    expect(list[0].published).toEqual([pub]);
  });
});

describe('provider / model 快取 key', () => {
  it('有標記 provider 的結果以來源 key + provider + model 存放', () => {
    const rec = buildAnalysisRecord({
      source,
      result: { ...result([review()]), provider: 'anthropic', model: 'claude-opus-5-5' },
      diffText: 'd',
      mr: mr('h1'),
      notes: [],
      existing: undefined,
      now: NOW,
    });
    expect(rec.id).toBe(buildProviderCacheKey(KEY, { provider: 'anthropic', model: 'claude-opus-5-5' }));
    expect(rec.provider).toBe('anthropic');
    expect(rec.model).toBe('claude-opus-5-5');
  });

  it('不同 provider / model 互不命中；舊快取（無後綴）只在選用 gemini 時命中', async () => {
    const store = await openHistoryStore(new IDBFactory());
    const legacy = buildAnalysisRecord({ source, result: result([review()]), diffText: 'd', mr: mr('h1'), notes: [], existing: undefined, now: NOW });
    expect(legacy.id).toBe(KEY);
    expect(legacy.provider).toBe('gemini');
    await store!.put(legacy, NOW);

    expect((await findCachedRecord(store!, KEY, { provider: 'gemini', model: 'gemini-3.8-flash' }))?.id).toBe(KEY);
    expect(await findCachedRecord(store!, KEY, { provider: 'openai', model: 'gpt-4.1-mini' })).toBeUndefined();

    const openaiRec = buildAnalysisRecord({
      source,
      result: { ...result([review()]), provider: 'openai', model: 'gpt-4.1-mini' },
      diffText: 'd',
      mr: mr('h1'),
      notes: [],
      existing: undefined,
      now: NOW,
    });
    await store!.put(openaiRec, NOW);
    expect((await findCachedRecord(store!, KEY, { provider: 'openai', model: 'gpt-4.1-mini' }))?.id).toBe(openaiRec.id);
    expect(await findCachedRecord(store!, KEY, { provider: 'openai', model: 'gpt-4.1' })).toBeUndefined();
    expect(cacheKeyCandidates(KEY, { provider: 'gemini', model: 'g' })).toEqual([`${KEY}#gemini:g`, KEY]);
  });
});
