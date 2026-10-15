import { ParsedDiff } from '../types/diff';
import { ChecklistCoverageItem, MRReviewItem, ReviewCategory } from '../types/review';
import { REVIEW_CHECKLIST, ReviewChecklistItem } from './prompt-builder';

export interface CoverageDiscrepancy {
  missingItems: ReviewChecklistItem[];
  hitWithoutReviewItems: Array<{
    item: ReviewChecklistItem;
    files: string[];
  }>;
  hasDiscrepancy: boolean;
}

/**
 * Checks if a review matches a given checklist item.
 */
export function isReviewMatchingChecklistItem(
  review: MRReviewItem,
  item: ReviewChecklistItem
): boolean {
  // 1. Direct checklistId match
  if (review.checklistId && review.checklistId === item.id) {
    return true;
  }

  // 2. Category matching with special rule mappings
  const categoryMatches =
    review.category === item.category ||
    (item.category === 'naming' && review.category === 'readability') ||
    (item.category === 'error-handling' && review.category === 'bug') ||
    (item.id === 'side-effect-timing' && review.category === 'bug') ||
    (item.id === 'hook-deps' && review.category === 'bug') ||
    (item.id === 'stale-closure' && review.category === 'bug') ||
    (item.id === 'boundary-calculation' && review.category === 'bug') ||
    (item.id === 'state-reset' && review.category === 'bug') ||
    (item.id === 'list-key' && review.category === 'bug');

  if (!categoryMatches) {
    return false;
  }

  // 3. Keyword / description matching in comment, suggestion, or snippet
  const text = `${review.comment} ${review.suggestion} ${review.codeSnippet}`.toLowerCase();
  switch (item.id) {
    case 'hook-deps':
      return /hook|useeffect|usecallback|usememo|依賴|deps|dependency/.test(text);
    case 'stale-closure':
      return /stale|closure|setstate|functional update|prev|閉包/.test(text);
    case 'boundary-calculation':
      return /邊界|索引|off-by-one|index|計算|分頁|page|overflow|越界/.test(text);
    case 'state-reset':
      return /重置|reset|length|條件/.test(text);
    case 'list-key':
      return /key|index/.test(text);
    case 'a11y':
      return /alt|button|role|tabindex|鍵盤|無障礙|a11y|aria/.test(text);
    case 'style':
      return /色碼|inline|style|token|css|樣式/.test(text);
    case 'performance':
      return /效能|usememo|usecallback|filter|sort|map|reduce|render|記憶體|重新計算/.test(text);
    case 'naming':
      return /命名|data2|temp|obj|可讀性|name/.test(text);
    case 'error-handling':
      return /fetch|res\.ok|ok|catch|try|json\.parse|錯誤處理|exception/.test(text);
    case 'side-effect-timing':
      return /副作用|mount|post|save|寫入|觸發/.test(text);
    case 'test':
      return /測試|test|斷言|assert|render/.test(text);
    case 'config':
      return /設定|config|jsdom|setupfiles|套件|依賴|dependency/.test(text);
    default:
      return true;
  }
}

/**
 * Finds discrepancies between checklistCoverage and reviews.
 */
export function findCoverageDiscrepancies(
  checklistCoverage: ChecklistCoverageItem[] = [],
  reviews: MRReviewItem[] = [],
  checklist: ReviewChecklistItem[] = REVIEW_CHECKLIST
): CoverageDiscrepancy {
  const coverageMap = new Map<string, ChecklistCoverageItem>();
  for (const cov of checklistCoverage) {
    coverageMap.set(cov.id, cov);
  }

  const missingItems: ReviewChecklistItem[] = [];
  const hitWithoutReviewItems: Array<{ item: ReviewChecklistItem; files: string[] }> = [];

  for (const item of checklist) {
    const cov = coverageMap.get(item.id);
    if (!cov) {
      // 1. Item does not appear in checklistCoverage at all
      missingItems.push(item);
    } else if (cov.hit) {
      // 2. Item hit is true, but check if any review in reviews corresponds to it
      const hasMatchingReview = reviews.some((r) => {
        // If files are specified, review should ideally match one of them, or match by content
        const matchesFile = cov.files.length === 0 || cov.files.includes(r.file);
        return matchesFile && isReviewMatchingChecklistItem(r, item);
      });

      if (!hasMatchingReview) {
        hitWithoutReviewItems.push({
          item,
          files: cov.files,
        });
      }
    }
  }

  return {
    missingItems,
    hitWithoutReviewItems,
    hasDiscrepancy: missingItems.length > 0 || hitWithoutReviewItems.length > 0,
  };
}

/**
 * Deduplicates reviews based on (file, line, category).
 * "去除重複的意見（同檔案、同行、同 category 視為重複）"
 */
export function deduplicateReviews(reviews: MRReviewItem[]): MRReviewItem[] {
  const seen = new Set<string>();
  const deduped: MRReviewItem[] = [];

  for (const r of reviews) {
    const lineVal = r.newLine != null ? r.newLine : r.line != null ? r.line : 'null';
    const key = `${r.file}:::${lineVal}:::${r.category}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  return deduped;
}

/**
 * Merges checklist coverage items from multiple batches or re-checks.
 */
export function mergeChecklistCoverage(
  coverages: ChecklistCoverageItem[][],
  checklist: ReviewChecklistItem[] = REVIEW_CHECKLIST
): ChecklistCoverageItem[] {
  const mergedMap = new Map<string, { hit: boolean; files: Set<string> }>();

  // Initialize with all checklist items (default hit: false, files: empty)
  for (const item of checklist) {
    mergedMap.set(item.id, { hit: false, files: new Set<string>() });
  }

  for (const list of coverages) {
    for (const cov of list) {
      const existing = mergedMap.get(cov.id) || { hit: false, files: new Set<string>() };
      if (cov.hit) {
        existing.hit = true;
        for (const f of cov.files || []) {
          existing.files.add(f);
        }
      }
      mergedMap.set(cov.id, existing);
    }
  }

  return checklist.map((item) => {
    const data = mergedMap.get(item.id);
    return {
      id: item.id,
      hit: data ? data.hit : false,
      files: data ? Array.from(data.files) : [],
    };
  });
}

export interface RecheckRunnerResult {
  checklistCoverage: ChecklistCoverageItem[];
  reviews: MRReviewItem[];
}

export type RecheckRunner = (
  missingItems: ReviewChecklistItem[],
  relevantDiff: string
) => Promise<RecheckRunnerResult>;

/**
 * Checks consistency between checklistCoverage and reviews.
 * If discrepancies exist, runs targeted Gemini re-check at most once and merges results.
 */
export async function ensureCoverageConsistency(options: {
  checklistCoverage: ChecklistCoverageItem[];
  reviews: MRReviewItem[];
  parsedDiff: ParsedDiff;
  recheckRunner?: RecheckRunner;
  checklist?: ReviewChecklistItem[];
}): Promise<{
  checklistCoverage: ChecklistCoverageItem[];
  reviews: MRReviewItem[];
  recheckPerformed: boolean;
}> {
  const {
    checklistCoverage,
    reviews,
    parsedDiff,
    recheckRunner,
    checklist = REVIEW_CHECKLIST,
  } = options;

  const discrepancies = findCoverageDiscrepancies(checklistCoverage, reviews, checklist);

  if (!discrepancies.hasDiscrepancy || !recheckRunner) {
    return {
      checklistCoverage: mergeChecklistCoverage([checklistCoverage], checklist),
      reviews: deduplicateReviews(reviews),
      recheckPerformed: false,
    };
  }

  // Combine items to recheck
  const itemsToRecheckMap = new Map<string, ReviewChecklistItem>();
  const relevantFilesSet = new Set<string>();

  for (const item of discrepancies.missingItems) {
    itemsToRecheckMap.set(item.id, item);
  }

  for (const entry of discrepancies.hitWithoutReviewItems) {
    itemsToRecheckMap.set(entry.item.id, entry.item);
    for (const f of entry.files) {
      relevantFilesSet.add(f);
    }
  }

  const itemsToRecheck = Array.from(itemsToRecheckMap.values());

  // Extract relevant diff content
  let relevantDiff = '';
  if (relevantFilesSet.size > 0) {
    const relevantFiles = parsedDiff.files.filter(
      (f) => relevantFilesSet.has(f.newPath) || relevantFilesSet.has(f.oldPath)
    );
    relevantDiff = relevantFiles.map((f) => f.rawContent).filter(Boolean).join('\n\n');
  }

  // Fallback to all files diff if relevantFiles is empty
  if (!relevantDiff.trim()) {
    relevantDiff = parsedDiff.files.map((f) => f.rawContent).filter(Boolean).join('\n\n');
  }

  try {
    // 補查最多一次
    const recheckResult = await recheckRunner(itemsToRecheck, relevantDiff);

    const mergedCoverage = mergeChecklistCoverage(
      [checklistCoverage, recheckResult.checklistCoverage || []],
      checklist
    );

    const mergedReviews = deduplicateReviews([
      ...reviews,
      ...(recheckResult.reviews || []),
    ]);

    return {
      checklistCoverage: mergedCoverage,
      reviews: mergedReviews,
      recheckPerformed: true,
    };
  } catch (err) {
    // If recheck fails, do not throw; return original with merged coverage
    console.warn('Gemini 覆蓋率補查執行失敗，維持原審查結果:', err);
    return {
      checklistCoverage: mergeChecklistCoverage([checklistCoverage], checklist),
      reviews: deduplicateReviews(reviews),
      recheckPerformed: false,
    };
  }
}
