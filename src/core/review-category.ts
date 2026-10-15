/**
 * 審查意見的分類與嚴重程度正規化：共享標記來自 MR 留言，任何人都能寫入，
 * 不認得的 category／severity 改成預設值，避免畫面查不到對應的圖示或樣式而整頁白掉。
 */
import { MRAnalysisResult, MRReviewItem, ReviewCategory, ReviewSeverity } from '../types/review';

export const DEFAULT_REVIEW_CATEGORY: ReviewCategory = 'other';
export const DEFAULT_REVIEW_SEVERITY: ReviewSeverity = 'medium';

const KNOWN_CATEGORIES: readonly ReviewCategory[] = [
  'bug',
  'performance',
  'a11y',
  'readability',
  'style',
  'test',
  'config',
  'other',
];
const KNOWN_SEVERITIES: readonly ReviewSeverity[] = ['high', 'medium', 'low'];

export function normalizeReviewCategory(value: unknown): ReviewCategory {
  return KNOWN_CATEGORIES.includes(value as ReviewCategory) ? (value as ReviewCategory) : DEFAULT_REVIEW_CATEGORY;
}

export function normalizeReviewSeverity(value: unknown): ReviewSeverity {
  return KNOWN_SEVERITIES.includes(value as ReviewSeverity) ? (value as ReviewSeverity) : DEFAULT_REVIEW_SEVERITY;
}

/** 把結果裡每則意見的 category／severity 換成認得的值；reviews 不是陣列時視為沒有意見，非物件的項目略過 */
export function normalizeResultReviews(result: MRAnalysisResult): MRAnalysisResult {
  const reviews: unknown = result.reviews;
  return {
    ...result,
    reviews: (Array.isArray(reviews) ? reviews : [])
      .filter((r): r is MRReviewItem => !!r && typeof r === 'object')
      .map((r) => ({
        ...r,
        category: normalizeReviewCategory(r.category),
        severity: normalizeReviewSeverity(r.severity),
      })),
  };
}
