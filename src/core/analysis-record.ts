/**
 * 「分析」按鈕的快取判斷與分析結果紀錄建立（純函式，供 App 與測試使用）
 */
import { MRAnalysisResult } from '../types/review';
import { GitLabMergeRequestInfo, GitLabNote } from '../types/gitlab';
import { HistoryRecord, HistorySourceType, HistoryStore, toMrSnapshot } from './history-store';
import { defaultSelectedIndices, findPublishedMatches } from './publish-dedup';

export interface HistorySourceInfo {
  id: string;
  sourceType: HistorySourceType;
  host?: string;
  projectPath?: string;
  mrIid?: number;
}

export interface ProviderModel {
  provider: string;
  model: string;
}

/** 快取 key：來源 key + provider + model（不同模型的結果分開快取） */
export function buildProviderCacheKey(sourceId: string, { provider, model }: ProviderModel): string {
  return `${sourceId}#${provider}:${model}`;
}

/**
 * 結果的紀錄 key：有標記 provider 的結果用 buildProviderCacheKey；
 * 未標記的結果（舊版快取、舊版分享到 MR 的分析）沿用來源 key，視為 gemini 相容。
 */
export function recordKeyForResult(sourceId: string, result: Pick<MRAnalysisResult, 'provider' | 'model'>): string {
  return result.provider
    ? buildProviderCacheKey(sourceId, { provider: result.provider, model: result.model ?? '' })
    : sourceId;
}

/**
 * 依序查找快取的候選 key。
 * 舊版紀錄（沒有 provider/model 後綴）視為 gemini 相容，只在選用 gemini 時命中。
 */
export function cacheKeyCandidates(sourceId: string, pm: ProviderModel): string[] {
  const keys = [buildProviderCacheKey(sourceId, pm)];
  if (pm.provider === 'gemini') keys.push(sourceId);
  return keys;
}

/** 從快取找第一筆符合的紀錄 */
export async function findCachedRecord(
  store: Pick<HistoryStore, 'get'>,
  sourceId: string,
  pm: ProviderModel
): Promise<HistoryRecord | undefined> {
  for (const key of cacheKeyCandidates(sourceId, pm)) {
    const hit = await store.get(key);
    if (hit) return hit;
  }
  return undefined;
}

/** 紀錄或結果的 provider / model（舊資料視為 gemini） */
export function recordProviderModel(record: Pick<HistoryRecord, 'provider' | 'model' | 'result'>): ProviderModel {
  return {
    provider: record.provider ?? record.result.provider ?? 'gemini',
    model: record.model ?? record.result.model ?? '',
  };
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
 * 建立新的分析結果紀錄（id 見 recordKeyForResult）。同一個 key 已有紀錄（重新分析）時保留已發布紀錄與釘選狀態，
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
    id: recordKeyForResult(source.id, result),
    provider: result.provider ?? 'gemini',
    model: result.model,
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
