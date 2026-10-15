import { describe, it, expect } from 'vitest';
import {
  createPublishedRecord,
  defaultSelectedIndices,
  findPublishedMatches,
  partitionDuplicates,
} from './publish-dedup';
import { MRReviewItem } from '../types/review';
import { GitLabNote } from '../types/gitlab';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';

const NOW = Date.UTC(2026, 9, 15);

const review = (over: Partial<MRReviewItem> = {}): MRReviewItem => ({
  groupId: 'g1',
  category: 'bug',
  severity: 'high',
  file: 'src/cart.ts',
  line: 10,
  codeSnippet: 'x',
  comment: '折扣金額未檢查負數，可能讓總價變成負的',
  suggestion: '在計算前加上 Math.max(0, discount)',
  ...over,
});

const note = (over: Partial<GitLabNote> = {}): GitLabNote => ({
  id: 1,
  body: '',
  author: { id: 1, name: 'n', username: 'u' },
  created_at: '2026-10-01T00:00:00Z',
  system: false,
  ...over,
});

describe('findPublishedMatches', () => {
  it('本地紀錄以檔案＋內容 hash 比對，行號變動仍視為已發布', () => {
    const r = review();
    const rec = createPublishedRecord(r, r.comment, r.suggestion, 'd1', NOW);
    const moved = review({ line: 42 });
    expect(findPublishedMatches([moved], {}, [rec], [])).toEqual({ 0: { source: 'local', publishedAt: NOW } });
  });

  it('編輯後發布：原始意見與目前草稿都能比對', () => {
    const r = review();
    const rec = createPublishedRecord(r, '改寫後的意見內容', r.suggestion, 1, NOW);
    expect(findPublishedMatches([r], {}, [rec], [])[0]?.source).toBe('local');
    expect(
      findPublishedMatches([r], { 0: { comment: '改寫後的意見內容', suggestion: r.suggestion } }, [rec], [])[0]
    ).toBeDefined();
  });

  it('不同檔案或不同內容不算已發布', () => {
    const r = review();
    const rec = createPublishedRecord(r, r.comment, r.suggestion, 1, NOW);
    expect(findPublishedMatches([review({ file: 'other.ts' })], {}, [rec], [])).toEqual({});
    expect(findPublishedMatches([review({ comment: '完全不同的一則意見內容' })], {}, [rec], [])).toEqual({});
  });

  it('清除本地紀錄後，仍可從 MR 行內留言辨識', () => {
    const r = review();
    const inline = note({
      body: `**[HIGH] BUG**: ${r.comment}\n\n> 💡 **修改建議**：\n> ${r.suggestion}`,
      position: { new_path: 'src/cart.ts', old_path: 'src/cart.ts', new_line: 10 },
    });
    const m = findPublishedMatches([r], {}, [], [inline]);
    expect(m[0]).toEqual({ source: 'remote', publishedAt: Date.parse('2026-10-01T00:00:00Z') });
  });

  it('MR 一般留言需包含檔名才算（行號未驗證時的發布格式）', () => {
    const r = review();
    const general = note({ body: `src/cart.ts:10（行號未驗證）\n\n**[HIGH] BUG**: ${r.comment}` });
    const noFile = note({ body: `有人引用了：${r.comment}` });
    expect(findPublishedMatches([r], {}, [], [general])[0]?.source).toBe('remote');
    expect(findPublishedMatches([r], {}, [], [noFile])).toEqual({});
  });

  it('行內留言掛在其他檔案、系統留言、過短意見都不比對', () => {
    const r = review();
    const otherFile = note({ body: r.comment, position: { new_path: 'x.ts', old_path: 'x.ts' } });
    const sys = note({ body: `src/cart.ts ${r.comment}`, system: true });
    expect(findPublishedMatches([r], {}, [], [otherFile, sys])).toEqual({});
    const short = review({ comment: '命名' });
    expect(findPublishedMatches([short], {}, [], [note({ body: 'src/cart.ts 命名' })])).toEqual({});
  });

  it('本地紀錄優先於 MR 留言', () => {
    const r = review();
    const rec = createPublishedRecord(r, r.comment, r.suggestion, 1, NOW);
    const inline = note({ body: r.comment, position: { new_path: r.file } });
    expect(findPublishedMatches([r], {}, [rec], [inline])[0]?.source).toBe('local');
  });
});

describe('發布紀錄格式一致（一般留言改走 /discussions）', () => {
  it('舊紀錄（note id 數字）與新紀錄（discussion id 字串）都能去重', () => {
    const a = review();
    const b = review({ file: 'src/b.ts', comment: '另一則一般留言的審查意見內容' });
    const legacy = createPublishedRecord(a, a.comment, a.suggestion, 12345, NOW);
    const current = createPublishedRecord(b, b.comment, b.suggestion, 'f3a9c0d1e2b4', NOW + 1);
    expect(current.discussionId).toBe('f3a9c0d1e2b4');
    expect(findPublishedMatches([a, b], {}, [legacy, current], [])).toEqual({
      0: { source: 'local', publishedAt: NOW },
      1: { source: 'local', publishedAt: NOW + 1 },
    });
  });

  it('沒有 discussionId 的舊紀錄仍以內容比對', () => {
    const r = review();
    const { discussionId: _omit, ...legacy } = createPublishedRecord(r, r.comment, r.suggestion, 1, NOW);
    expect(findPublishedMatches([r], {}, [legacy], [])[0]?.source).toBe('local');
  });

  it('MR 上「版本已更新」與「行號未驗證」（無行號）的一般留言都辨識為已發布', () => {
    const r = review();
    const stale = note({ body: `src/cart.ts:10（版本已更新）\n\n**[HIGH] BUG**: ${r.comment}`, position: null });
    const noLine = note({ body: `src/cart.ts（行號未驗證）\n\n**[HIGH] BUG**: ${r.comment}`, position: null });
    expect(findPublishedMatches([r], {}, [], [stale])[0]?.source).toBe('remote');
    expect(findPublishedMatches([r], {}, [], [noLine])[0]?.source).toBe('remote');
  });
});

describe('defaultSelectedIndices', () => {
  it('預設全部不勾選（不論行號是否驗證、是否已發布）', () => {
    const reviews = [review(), review({ lineVerified: false }), review({ comment: '另一則尚未發布的意見內容' })];
    expect(defaultSelectedIndices(reviews, { 0: { source: 'local', publishedAt: NOW } }).size).toBe(0);
    expect(defaultSelectedIndices(reviews, {}).size).toBe(0);
  });

  it('demo 範例意見預設也全部不勾選', () => {
    expect(defaultSelectedIndices(SAMPLE_ANALYSIS_RESULT.reviews, {}).size).toBe(0);
  });
});

describe('partitionDuplicates（重複發布阻擋）', () => {
  const items = (reviews: MRReviewItem[]) => reviews.map((r, index) => ({ review: r, index }));

  it('本地已發布的意見歸到 duplicates，其餘可發布', () => {
    const reviews = [review(), review({ file: 'src/b.ts', comment: '另一則完全不同的意見內容' })];
    const local = [createPublishedRecord(reviews[0], reviews[0].comment, reviews[0].suggestion, 'd1', NOW)];
    const matches = findPublishedMatches(reviews, {}, local, []);
    const { fresh, duplicates } = partitionDuplicates(items(reviews), matches);
    expect(duplicates.map((i) => i.index)).toEqual([0]);
    expect(fresh.map((i) => i.index)).toEqual([1]);
  });

  it('MR 上已有相同行內留言（沒有本地紀錄）也會被擋', () => {
    const reviews = [review()];
    const notes = [note({ body: `**[HIGH] BUG**: ${reviews[0].comment}`, position: { new_path: 'src/cart.ts', new_line: 10 } })];
    const { fresh, duplicates } = partitionDuplicates(items(reviews), findPublishedMatches(reviews, {}, [], notes));
    expect(fresh).toEqual([]);
    expect(duplicates).toHaveLength(1);
  });

  it('同一則在清單中重複出現只保留一次', () => {
    const list = [{ index: 2 }, { index: 2 }, { index: 4 }];
    const { fresh, duplicates } = partitionDuplicates(list, {});
    expect(fresh.map((i) => i.index)).toEqual([2, 4]);
    expect(duplicates).toEqual([]);
  });
});
