import { enrichGroupsWithParsedDiff, parseGitDiff } from '../core/diff-parser';
import { alignReviewsWithDiff } from '../core/line-resolver';
import {
  MR_ANALYSIS_RESPONSE_SCHEMA,
  RECHECK_RESPONSE_SCHEMA,
} from '../core/gemini-schema';
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
import { DiffFile, ParsedDiff } from '../types/diff';
import {
  ChecklistCoverageItem,
  MRAnalysisResult,
  MRGraphEdge,
  MRGraphNode,
  MRGroup,
  MRReviewItem,
} from '../types/review';

export interface AnalyzeOptions {
  rawDiff: string;
  apiKey: string;
  model?: string;
  teamRules?: string[];
  onBatchProgress?: (current: number, total: number) => void;
}

const GEMINI_RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const GEMINI_RETRY_DELAYS_MS = [2000, 5000];
let geminiRetryDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 測試用：替換重試等待（避免測試真的等待） */
export function setGeminiRetryDelayForTest(fn: (ms: number) => Promise<void>): void {
  geminiRetryDelay = fn;
}

/**
 * Executes a direct browser-local REST call to the Gemini API.
 */
async function callGeminiGenerateContent<T>(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  prompt: string;
  responseSchema: unknown;
}): Promise<T> {
  const { apiKey, model, systemInstruction, prompt, responseSchema } = params;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.2,
    },
  };

  let response: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`連線至 Gemini API 失敗（網路問題或 CORS 受阻）：${errorMsg}`);
    }
    // 模型暫時過載（503 high demand）等暫時性錯誤：稍候重試，避免整次分析失敗
    if (!GEMINI_RETRYABLE_STATUS.has(response.status) || attempt >= GEMINI_RETRY_DELAYS_MS.length) break;
    await geminiRetryDelay(GEMINI_RETRY_DELAYS_MS[attempt]);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedError: string = errorBody;
    try {
      const jsonErr = JSON.parse(errorBody);
      parsedError = jsonErr.error?.message || errorBody;
    } catch {
      // ignore
    }

    if (response.status === 400 && parsedError.includes('API key')) {
      throw new Error('Gemini API Key 無效，請檢查設定中的金鑰是否正確。');
    }
    if (response.status === 429) {
      throw new Error('Gemini API 請求次數超限 (Rate limit)，請稍候再試。');
    }

    throw new Error(`Gemini API 回傳錯誤 (${response.status})：${parsedError}`);
  }

  const resultJson = await response.json();
  const candidate = resultJson.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    throw new Error('Gemini API 未回傳有效的分析內容，可能被安全過濾器攔截。');
  }

  const rawText = candidate.content.parts[0].text;
  try {
    return JSON.parse(rawText) as T;
  } catch (err: unknown) {
    const parseErrMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`解析 Gemini 回傳 JSON 失敗：${parseErrMsg}`);
  }
}

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
 * Executes browser-local Gemini API call with structured output (responseSchema),
 * supporting chunked batch review and consistency verification.
 */
export async function analyzeGitDiffWithGemini(
  options: AnalyzeOptions
): Promise<MRAnalysisResult> {
  const {
    rawDiff,
    apiKey,
    model = 'gemini-3.8-flash',
    teamRules = [],
    onBatchProgress,
  } = options;

  if (!rawDiff || !rawDiff.trim()) {
    throw new Error('請提供有效的 Git Diff 內容');
  }

  if (!apiKey || !apiKey.trim()) {
    throw new Error('尚未設定 Gemini API Key，請點擊右上角設定填入您的 API 金鑰。');
  }

  // 1. Client-side diff parsing
  const parsedDiff = parseGitDiff(rawDiff);
  const diffLinesCount = rawDiff.split(/\r?\n/).length;
  const fileCount = parsedDiff.files.length;

  // 2. Batching condition:
  // "如果變更的檔案超過 8 個，或 diff 超過 1500 行，就分批呼叫，每批最多 6 個檔案"
  const shouldBatch = fileCount > 8 || diffLinesCount > 1500;

  let mergedResult: MRAnalysisResult;

  if (shouldBatch && fileCount > 0) {
    const BATCH_SIZE = 6;
    const fileBatches: DiffFile[][] = [];
    for (let i = 0; i < fileCount; i += BATCH_SIZE) {
      fileBatches.push(parsedDiff.files.slice(i, i + BATCH_SIZE));
    }

    const batchResults: MRAnalysisResult[] = [];
    for (let bIndex = 0; bIndex < fileBatches.length; bIndex++) {
      if (onBatchProgress) {
        onBatchProgress(bIndex + 1, fileBatches.length);
      }

      const batchFiles = fileBatches[bIndex];
      const batchDiff = batchFiles
        .map((f) => f.rawContent || '')
        .filter(Boolean)
        .join('\n\n') || rawDiff;

      const { systemInstruction, prompt } = buildMRAnalysisPrompt({
        rawDiff: batchDiff,
        teamRules,
      });

      const singleResult = await callGeminiGenerateContent<MRAnalysisResult>({
        apiKey,
        model,
        systemInstruction,
        prompt,
        responseSchema: MR_ANALYSIS_RESPONSE_SCHEMA,
      });

      batchResults.push(singleResult);
    }

    // Merge and deduplicate batch results
    mergedResult = mergeBatchAnalysisResults(batchResults);
  } else {
    // Single call
    const { systemInstruction, prompt } = buildMRAnalysisPrompt({
      rawDiff,
      teamRules,
    });

    mergedResult = await callGeminiGenerateContent<MRAnalysisResult>({
      apiKey,
      model,
      systemInstruction,
      prompt,
      responseSchema: MR_ANALYSIS_RESPONSE_SCHEMA,
    });
  }

  // Ensure checklistCoverage array exists
  if (!mergedResult.checklistCoverage) {
    mergedResult.checklistCoverage = mergeChecklistCoverage([]);
  }

  // 3. Consistency check and targeted re-check:
  // "比對 checklistCoverage 和 reviews：如果某項 hit 為 true 卻沒有對應的 review，
  // 或清單有項目沒出現在 coverage 裡，就針對缺少的項目再呼叫一次 Gemini 補查（只送相關檔案的 diff 和該項規則），
  // 把結果合併進 reviews。補查最多一次，避免無限迴圈。"
  const recheckRunner = async (missingItems: typeof REVIEW_CHECKLIST, relevantDiff: string) => {
    const { systemInstruction, prompt } = buildRecheckPrompt({
      missingItems,
      relevantDiff,
    });

    return await callGeminiGenerateContent<{
      checklistCoverage: ChecklistCoverageItem[];
      reviews: MRReviewItem[];
    }>({
      apiKey,
      model,
      systemInstruction,
      prompt,
      responseSchema: RECHECK_RESPONSE_SCHEMA,
    });
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

  return mergedResult;
}
