import { describe, it, expect, vi } from 'vitest';
import {
  findCoverageDiscrepancies,
  ensureCoverageConsistency,
  deduplicateReviews,
  mergeChecklistCoverage,
  isReviewMatchingChecklistItem,
} from './coverage-check';
import { REVIEW_CHECKLIST } from './prompt-builder';
import { ChecklistCoverageItem, MRReviewItem } from '../types/review';
import { ParsedDiff } from '../types/diff';

describe('coverage-check: 逐項檢查覆蓋與一致性', () => {
  const dummyParsedDiff: ParsedDiff = {
    files: [
      {
        oldPath: 'src/App.tsx',
        newPath: 'src/App.tsx',
        status: 'modified',
        additions: 5,
        deletions: 1,
        rawContent: 'diff --git a/src/App.tsx b/src/App.tsx\n+ const a = 1;',
        hunks: [],
      },
    ],
    totalAdditions: 5,
    totalDeletions: 1,
    fileCount: 1,
  };

  it('isReviewMatchingChecklistItem: 能正確比對 checklistId 與語意分類', () => {
    const item = REVIEW_CHECKLIST.find((i) => i.id === 'hook-deps')!;

    const reviewWithId: MRReviewItem = {
      groupId: 'core',
      checklistId: 'hook-deps',
      category: 'bug',
      severity: 'high',
      file: 'src/App.tsx',
      line: 10,
      codeSnippet: 'useEffect(() => {}, [])',
      comment: '缺少依賴',
      suggestion: '補齊依賴',
    };
    expect(isReviewMatchingChecklistItem(reviewWithId, item)).toBe(true);

    const reviewWithoutId: MRReviewItem = {
      groupId: 'core',
      category: 'bug',
      severity: 'high',
      file: 'src/App.tsx',
      line: 10,
      codeSnippet: 'useEffect(() => {}, [])',
      comment: 'useEffect 依賴陣列缺少變數',
      suggestion: '請將變數加入 deps',
    };
    expect(isReviewMatchingChecklistItem(reviewWithoutId, item)).toBe(true);

    const unrelatedReview: MRReviewItem = {
      groupId: 'core',
      category: 'style',
      severity: 'low',
      file: 'src/App.tsx',
      line: 10,
      codeSnippet: 'color: "#fff"',
      comment: '寫死色碼',
      suggestion: '改用 class',
    };
    expect(isReviewMatchingChecklistItem(unrelatedReview, item)).toBe(false);
  });

  it('findCoverageDiscrepancies: 檢驗清單缺漏或 hit=true 卻無 review 的情況', () => {
    // 1. Partial coverage: 只有 2 項，缺少其餘 11 項
    const partialCoverage: ChecklistCoverageItem[] = [
      { id: 'hook-deps', hit: false, files: [] },
      { id: 'stale-closure', hit: true, files: ['src/App.tsx'] },
    ];
    const reviews: MRReviewItem[] = []; // 沒有對應 stale-closure 的 review

    const res = findCoverageDiscrepancies(partialCoverage, reviews, REVIEW_CHECKLIST);
    expect(res.hasDiscrepancy).toBe(true);
    // 缺少 11 項
    expect(res.missingItems.length).toBe(11);
    // stale-closure hit=true 但無 review
    expect(res.hitWithoutReviewItems.some((h) => h.item.id === 'stale-closure')).toBe(true);
  });

  it('findCoverageDiscrepancies: 當全部清單完整且 hit=true 皆有對應 review 時無差異', () => {
    const fullCoverage: ChecklistCoverageItem[] = REVIEW_CHECKLIST.map((item) => ({
      id: item.id,
      hit: item.id === 'hook-deps',
      files: item.id === 'hook-deps' ? ['src/App.tsx'] : [],
    }));

    const reviews: MRReviewItem[] = [
      {
        groupId: 'core',
        checklistId: 'hook-deps',
        category: 'bug',
        severity: 'high',
        file: 'src/App.tsx',
        line: 15,
        codeSnippet: 'useEffect(() => {}, [])',
        comment: 'useEffect 缺少依賴',
        suggestion: '補齊依賴',
      },
    ];

    const res = findCoverageDiscrepancies(fullCoverage, reviews, REVIEW_CHECKLIST);
    expect(res.hasDiscrepancy).toBe(false);
    expect(res.missingItems.length).toBe(0);
    expect(res.hitWithoutReviewItems.length).toBe(0);
  });

  it('ensureCoverageConsistency: 發現差異時執行補查最多一次，並合併結果與去重', async () => {
    const partialCoverage: ChecklistCoverageItem[] = [
      { id: 'hook-deps', hit: false, files: [] },
    ];
    const initialReviews: MRReviewItem[] = [];

    const mockRecheckRunner = vi.fn().mockResolvedValue({
      checklistCoverage: [
        { id: 'hook-deps', hit: false, files: [] },
        { id: 'list-key', hit: true, files: ['src/App.tsx'] },
      ],
      reviews: [
        {
          groupId: 'core',
          checklistId: 'list-key',
          category: 'bug',
          severity: 'medium',
          file: 'src/App.tsx',
          line: 20,
          codeSnippet: 'items.map((it, index) => <div key={index} />)',
          comment: '避免使用 index 作為 key',
          suggestion: '改用 it.id',
        },
      ],
    });

    const result = await ensureCoverageConsistency({
      checklistCoverage: partialCoverage,
      reviews: initialReviews,
      parsedDiff: dummyParsedDiff,
      recheckRunner: mockRecheckRunner,
    });

    expect(mockRecheckRunner).toHaveBeenCalledTimes(1);
    expect(result.recheckPerformed).toBe(true);
    expect(result.reviews.length).toBe(1);
    expect(result.reviews[0].checklistId).toBe('list-key');
    // checklistCoverage 應包含全部清單項目
    expect(result.checklistCoverage.length).toBe(REVIEW_CHECKLIST.length);
    const keyItem = result.checklistCoverage.find((c) => c.id === 'list-key');
    expect(keyItem?.hit).toBe(true);
  });

  it('deduplicateReviews: 同檔案、同行、同 category 視為重複並去除', () => {
    const reviews: MRReviewItem[] = [
      {
        groupId: 'core',
        category: 'bug',
        severity: 'high',
        file: 'src/App.tsx',
        line: 42,
        codeSnippet: 'key={index}',
        comment: '問題 1',
        suggestion: '改用 id',
      },
      {
        groupId: 'core',
        category: 'bug',
        severity: 'medium',
        file: 'src/App.tsx',
        line: 42,
        codeSnippet: 'key={index}',
        comment: '重複出現的問題 1',
        suggestion: '改用 id',
      },
      {
        groupId: 'core',
        category: 'performance',
        severity: 'low',
        file: 'src/App.tsx',
        line: 42,
        codeSnippet: 'key={index}',
        comment: '不同 category 的意見',
        suggestion: '加 useMemo',
      },
    ];

    const deduped = deduplicateReviews(reviews);
    expect(deduped.length).toBe(2);
    expect(deduped[0].category).toBe('bug');
    expect(deduped[1].category).toBe('performance');
  });

  it('mergeChecklistCoverage: 能跨批次合併命中狀態與檔案清單', () => {
    const batch1: ChecklistCoverageItem[] = [
      { id: 'hook-deps', hit: true, files: ['src/A.tsx'] },
      { id: 'a11y', hit: false, files: [] },
    ];
    const batch2: ChecklistCoverageItem[] = [
      { id: 'hook-deps', hit: true, files: ['src/B.tsx'] },
      { id: 'a11y', hit: true, files: ['src/C.tsx'] },
    ];

    const merged = mergeChecklistCoverage([batch1, batch2]);
    const hookDeps = merged.find((m) => m.id === 'hook-deps');
    expect(hookDeps?.hit).toBe(true);
    expect(hookDeps?.files).toContain('src/A.tsx');
    expect(hookDeps?.files).toContain('src/B.tsx');

    const a11y = merged.find((m) => m.id === 'a11y');
    expect(a11y?.hit).toBe(true);
    expect(a11y?.files).toEqual(['src/C.tsx']);
  });
});
