/**
 * 「分析」按鈕的快取判斷與分析結果紀錄建立（純函式，供 App 與測試使用）
 */
import { MRAnalysisResult } from '../types/review';
import { GitLabMergeRequestInfo, GitLabNote } from '../types/gitlab';
import { HistoryRecord, HistorySourceType, toMrSnapshot } from './history-store';
import { defaultSelectedIndices, findPublishedMatches } from './publish-dedup';

export interface HistorySourceInfo {
  id: string;
  sourceType: HistorySourceType;
  host?: string;
  projectPath?: string;
  mrIid?: number;
}

/**
 * 按「分析」時是否直接顯示快取（不呼叫 Gemini）。
 * - 正在顯示的那筆紀錄再按「分析」＝使用者要求重新分析 → false
 * - 快取的 head SHA 與目前 MR 不同（有新 commit）→ false
 */
export function shouldServeFromCache(params: {
  sourceId: string;
  currentRecordId: string | null;
  cached: Pick<HistoryRecord, 'headSha'> | undefined;
  currentHeadSha: string | null | undefined;
}): boolean {
  const { sourceId, currentRecordId, cached, currentHeadSha } = params;
  if (!cached) return false;
  if (sourceId === currentRecordId) return false;
  return !cached.headSha || !currentHeadSha || cached.headSha === currentHeadSha;
}

/**
 * 建立新的分析結果紀錄。同一個 key 已有紀錄（重新分析）時保留已發布紀錄與釘選狀態，
 * 已發布（本地紀錄或 MR 留言）的意見預設不勾選。
 */
export function buildAnalysisRecord(params: {
  source: HistorySourceInfo;
  result: MRAnalysisResult;
  diffText: string;
  mr: GitLabMergeRequestInfo | null;
  notes: GitLabNote[];
  existing: HistoryRecord | undefined;
  now: number;
}): HistoryRecord {
  const { source, result, diffText, mr, notes, existing, now } = params;
  const published = existing?.published ?? [];
  const matches = findPublishedMatches(result.reviews, {}, published, notes);
  return {
    ...source,
    title: mr ? mr.title : result.title,
    mrUrl: mr?.web_url,
    mr: mr ? toMrSnapshot(mr) : undefined,
    headSha: mr?.diff_refs?.head_sha ?? null,
    latestHeadSha: mr?.diff_refs?.head_sha ?? null,
    rawDiff: diffText,
    analyzedAt: now,
    result,
    selectedIndices: Array.from(defaultSelectedIndices(result.reviews, matches)),
    draftEdits: {},
    published,
    summaryPublished: false,
    sharedPublished: false,
    pinned: existing?.pinned ?? false,
  };
}
