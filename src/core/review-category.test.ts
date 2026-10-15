import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVIEW_CATEGORY,
  DEFAULT_REVIEW_SEVERITY,
  normalizeResultReviews,
  normalizeReviewCategory,
  normalizeReviewSeverity,
} from './review-category';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';

describe('審查意見分類正規化（#71）', () => {
  it('認得的 category 原樣保留', () => {
    for (const c of ['bug', 'performance', 'a11y', 'readability', 'style', 'test', 'config', 'other']) {
      expect(normalizeReviewCategory(c)).toBe(c);
    }
  });

  it('不認得、非字串或缺少的 category 改為預設分類', () => {
    expect(DEFAULT_REVIEW_CATEGORY).toBe('other');
    for (const c of ['FAKE-security', 'BUG', '', null, undefined, 3, {}, '__proto__', 'toString']) {
      expect(normalizeReviewCategory(c)).toBe('other');
    }
  });

  it('不認得的 severity 改為 medium', () => {
    expect(DEFAULT_REVIEW_SEVERITY).toBe('medium');
    expect(normalizeReviewSeverity('high')).toBe('high');
    expect(normalizeReviewSeverity('FAKE-critical')).toBe('medium');
    expect(normalizeReviewSeverity(undefined)).toBe('medium');
  });

  it('normalizeResultReviews 只改 category／severity，其他欄位與結果內容不變', () => {
    const [first, ...rest] = SAMPLE_ANALYSIS_RESULT.reviews;
    const out = normalizeResultReviews({
      ...SAMPLE_ANALYSIS_RESULT,
      reviews: [{ ...first, category: 'FAKE' as never }, ...rest],
    });
    expect(out.reviews[0]).toEqual({ ...first, category: 'other' });
    expect(out.reviews.slice(1)).toEqual(rest);
    expect(out.title).toBe(SAMPLE_ANALYSIS_RESULT.title);
    expect(normalizeResultReviews(SAMPLE_ANALYSIS_RESULT)).toEqual(SAMPLE_ANALYSIS_RESULT);
  });
});
