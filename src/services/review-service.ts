/**
 * 與 provider 無關的 MR 審查流程：分批（>8 檔或 >1500 行 → 每批 6 檔）、合併去重、
 * checklist 補查、群組行數與行號驗證。實際模型呼叫交給所選的 LlmProvider，不自動 fallback。
 */
import { enrichGroupsWithParsedDiff, parseGitDiff } from '../core/diff-parser';
import { alignReviewsWithDiff } from '../core/line-resolver';
import {
  buildMRAnalysisPrompt,
  buildRecheckPrompt,
  REVIEW_CHECKLIST,
} from '../core/prompt-builder';
import {
  deduplicateReviews,
  ensureCoverageConsistency,
  mergeChecklistCoverage,
} from '../core/coverage-check';
import { LlmProvider } from '../providers/types';
import { DiffFile } from '../types/diff';
import {
  ChecklistCoverageItem,
  MRAnalysisResult,
  MRGraphEdge,
  MRGraphNode,
  MRGroup,
  MRReviewItem,
} from '../types/review';

export interface AnalyzeWithProviderOptions {
  rawDiff: string;
  provider: LlmProvider;
  teamRules?: string[];
  onBatchProgress?: (current: number, total: number) => void;
}

export const BATCH_FILE_THRESHOLD = 8;
export const BATCH_LINE_THRESHOLD = 1500;
export const BATCH_SIZE = 6;

/**
 * Merges batch review results and deduplicates reviews.
 * "去除重複的意見（同檔案、同行、同 category 視為重複）"
 */
export function mergeBatchAnalysisResults(results: MRAnalysisResult[]): MRAnalysisResult {
  if (results.length === 0) {
    throw new Error('無可合併的審查結果');
  }
  if (results.length === 1) {
    return {
      ...results[0],
      checklistCoverage: mergeChecklistCoverage(
        results[0].checklistCoverage ? [results[0].checklistCoverage] : []
      ),
      reviews: deduplicateReviews(results[0].reviews || []),
    };
  }

  const base = results[0];
  const allSummaries = new Set<string>();
  const allTestSuggestions = new Set<string>();
  const groupMap = new Map<string, MRGroup>();
  const nodeMap = new Map<string, MRGraphNode>();
  const edgeMap = new Map<string, MRGraphEdge>();
  const allReviews: MRReviewItem[] = [];
  const allCoverages: ChecklistCoverageItem[][] = [];

  for (const res of results) {
    for (const s of res.summary || []) allSummaries.add(s);
    for (const t of res.testSuggestions || []) allTestSuggestions.add(t);

    for (const g of res.groups || []) {
      if (!groupMap.has(g.id)) {
        groupMap.set(g.id, { ...g, files: [...(g.files || [])] });
      } else {
        const existing = groupMap.get(g.id)!;
        existing.files = Array.from(new Set([...existing.files, ...(g.files || [])]));
      }
    }

    for (const n of res.graph?.nodes || []) {
      nodeMap.set(n.id, n);
    }
    for (const e of res.graph?.edges || []) {
      const key = `${e.from}->${e.to}`;
      edgeMap.set(key, e);
    }

    if (res.checklistCoverage) {
      allCoverages.push(res.checklistCoverage);
    }
    if (res.reviews) {
      allReviews.push(...res.reviews);
    }
  }

  return {
    schemaVersion: 1,
    title: base.title,
    description: base.description,
    summary: Array.from(allSummaries),
    testSuggestions: Array.from(allTestSuggestions),
    groups: Array.from(groupMap.values()),
    graph: {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    },
    checklistCoverage: mergeChecklistCoverage(allCoverages),
    reviews: deduplicateReviews(allReviews),
  };
}

/**
 * 呼叫所選 provider 分析 diff，結果標記 provider / model。
 */
export async function analyzeGitDiff(options: AnalyzeWithProviderOptions): Promise<MRAnalysisResult> {
  const { rawDiff, provider, teamRules = [], onBatchProgress } = options;

  if (!rawDiff || !rawDiff.trim()) {
    throw new Error('請提供有效的 Git Diff 內容');
  }

  // 1. Client-side diff parsing
  const parsedDiff = parseGitDiff(rawDiff);
  const diffLinesCount = rawDiff.split(/\r?\n/).length;
  const fileCount = parsedDiff.files.length;

  // 2. Batching condition:
  // "如果變更的檔案超過 8 個，或 diff 超過 1500 行，就分批呼叫，每批最多 6 個檔案"
  const shouldBatch = fileCount > BATCH_FILE_THRESHOLD || diffLinesCount > BATCH_LINE_THRESHOLD;

  let mergedResult: MRAnalysisResult;

  if (shouldBatch && fileCount > 0) {
    const fileBatches: DiffFile[][] = [];
    for (let i = 0; i < fileCount; i += BATCH_SIZE) {
      fileBatches.push(parsedDiff.files.slice(i, i + BATCH_SIZE));
    }

    const batchResults: MRAnalysisResult[] = [];
    for (let bIndex = 0; bIndex < fileBatches.length; bIndex++) {
      if (onBatchProgress) {
        onBatchProgress(bIndex + 1, fileBatches.length);
      }

      const batchDiff = fileBatches[bIndex]
        .map((f) => f.rawContent || '')
        .filter(Boolean)
        .join('\n\n') || rawDiff;

      const { systemInstruction, prompt } = buildMRAnalysisPrompt({ rawDiff: batchDiff, teamRules });
      batchResults.push(await provider.review({ kind: 'analysis', systemInstruction, prompt }));
    }

    // Merge and deduplicate batch results
    mergedResult = mergeBatchAnalysisResults(batchResults);
  } else {
    const { systemInstruction, prompt } = buildMRAnalysisPrompt({ rawDiff, teamRules });
    mergedResult = await provider.review({ kind: 'analysis', systemInstruction, prompt });
  }

  // Ensure checklistCoverage array exists
  if (!mergedResult.checklistCoverage) {
    mergedResult.checklistCoverage = mergeChecklistCoverage([]);
  }

  // 3. Consistency check and targeted re-check（補查最多一次，用同一個 provider）
  const recheckRunner = async (missingItems: typeof REVIEW_CHECKLIST, relevantDiff: string) => {
    const { systemInstruction, prompt } = buildRecheckPrompt({ missingItems, relevantDiff });
    return provider.review({ kind: 'recheck', systemInstruction, prompt });
  };

  const consistencyChecked = await ensureCoverageConsistency({
    checklistCoverage: mergedResult.checklistCoverage,
    reviews: mergedResult.reviews || [],
    parsedDiff,
    recheckRunner,
  });

  mergedResult.checklistCoverage = consistencyChecked.checklistCoverage;
  mergedResult.reviews = consistencyChecked.reviews;

  // 4. Enrich groups additions/deletions on client-side
  mergedResult.groups = enrichGroupsWithParsedDiff(mergedResult.groups || [], parsedDiff);

  // 5. Align reviews with parsed diff (line numbers, verification status)
  mergedResult.reviews = alignReviewsWithDiff(mergedResult.reviews || [], parsedDiff);

  // 6. 標記產生此結果的 provider / model
  mergedResult.provider = provider.id;
  mergedResult.model = provider.model;

  return mergedResult;
}
