/**
 * 分析與目前結果：左欄 diff／MR 來源、分析流程、快取命中、提示與錯誤訊息，
 * 以及隨結果保存到歷史紀錄的勾選、草稿、已發布紀錄與發布狀態。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDiffHistoryKey,
  buildMrHistoryKey,
  DraftEdits,
  HistoryRecord,
  HistorySourceType,
  normalizeHost,
  PublishedRecord,
} from '../core/history-store';
import { defaultSelectedIndices } from '../core/publish-dedup';
import {
  buildAnalysisRecord,
  findCachedRecord,
  recordKeyForResult,
  shouldServeFromCache,
} from '../core/analysis-record';
import { getProviderSettings, setProviderSettings } from '../core/settings-store';
import { enrichGroupsWithParsedDiff, parseGitDiff } from '../core/diff-parser';
import { alignReviewsWithDiff, dropUnverifiedFallbackLines } from '../core/line-resolver';
import { analyzeGitDiff } from '../services/review-service';
import { OPENROUTER_SUGGESTED_FREE_MODEL, shouldSuggestFreeModel } from '../providers/openai-compatible';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { MRAnalysisResult } from '../types/review';
import { DiffFile } from '../types/diff';
import {
  GitLabAuthor,
  GitLabDiffRefs,
  GitLabMergeRequestInfo,
  GitLabNote,
  ReviewPublishState,
} from '../types/gitlab';
import {
  findSharedAnalysisInNotes,
  isSharedAnalysisCurrent,
  parseGitLabMrUrl,
  SharedAnalysis,
} from '../services/gitlab-api';
import type { AppServices } from '../app/app-services';
import type { SettingsState } from './useSettings';
import type { HistoryState } from './useHistory';
import { formatYmd } from '../core/date-format';
import { formatAuthorText } from '../core/author-format';
import { normalizeResultReviews } from '../core/review-category';

/** 未載入的共享報告（分析版本與 MR 目前版本不符，或舊版標記沒有記錄分析版本） */
export interface StaleSharedAnalysis {
  author: GitLabAuthor;
  createdAt: string;
  /** 報告分析時的 head sha；舊版標記為 null */
  sharedHeadSha: string | null;
  /** MR 目前的 head sha */
  currentHeadSha: string | null;
}

export interface UseAnalysisOptions {
  services: Pick<AppServices, 'ai' | 'gitlab' | 'initialRawDiff'>;
  settings: Pick<
    SettingsState,
    'settings' | 'providerReady' | 'currentProviderModel' | 'setIsSetupGuideOpen' | 'handleSaveSettings'
  >;
  history: Pick<
    HistoryState,
    'historyStore' | 'refreshHistory' | 'currentRecordId' | 'setCurrentRecordId' | 'currentRecordIdRef'
  >;
}

export function useAnalysis({ services, settings: settingsState, history }: UseAnalysisOptions) {
  const { ai, gitlab } = services;
  const { settings, providerReady, currentProviderModel, setIsSetupGuideOpen, handleSaveSettings } = settingsState;
  const { historyStore, refreshHistory, currentRecordId, setCurrentRecordId, currentRecordIdRef } = history;

  const [rawDiff, setRawDiff] = useState<string>(services.initialRawDiff);
  const [analysisResult, setAnalysisResult] = useState<MRAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** OpenRouter 分析回 402 額度不足時，在錯誤橫幅提供「改用免費模型」 */
  const [freeModelSuggestedFor, setFreeModelSuggestedFor] = useState<string | null>(null);
  const suggestFreeModel = errorMessage !== null && freeModelSuggestedFor === errorMessage;
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [inspectingDiff, setInspectingDiff] = useState<{ file: DiffFile; line?: number | null } | null>(null);

  // Stage 2: GitLab Integration States
  const [gitlabMrUrl, setGitlabMrUrl] = useState<string>('');
  const [isFetchingGitLab, setIsFetchingGitLab] = useState<boolean>(false);
  const [currentGitLabMr, setCurrentGitLabMr] = useState<GitLabMergeRequestInfo | null>(null);
  const [gitlabError, setGitlabError] = useState<string | null>(null);
  /** MR 留言有共享報告，但分析版本與 MR 目前 head sha 不符（或舊版標記沒記錄）而未載入；左欄顯示提示卡片 */
  const [staleSharedAnalysis, setStaleSharedAnalysis] = useState<StaleSharedAnalysis | null>(null);
  /**
   * 來源序號：每次抓取 MR（或改看其他來源）都 +1。抓取的回應與 AI 分析的結果回來時，
   * 序號已不是最新就不套用到畫面，避免切換 MR 時較慢回來的舊請求或舊分析蓋掉新 MR 的畫面。
   */
  const fetchSeqRef = useRef(0);
  /**
   * 進行中的分析（含讀快取的空檔）所屬的來源序號；null 表示沒有分析在跑。
   * 用 ref 同步擋住重複觸發：連點「分析」時第二次在 state 更新前就會被擋下。
   */
  const analysisSeqRef = useRef<number | null>(null);
  /** 改看其他來源：序號 +1；進行中的分析改為背景完成（只寫入歷史紀錄），畫面結束分析中的狀態 */
  const bumpSourceSeq = () => {
    fetchSeqRef.current += 1;
    if (analysisSeqRef.current !== null) {
      analysisSeqRef.current = null;
      setIsLoading(false);
      setBatchProgress(null);
    }
    return fetchSeqRef.current;
  };
  /** 讓進行中的抓取作廢，並結束抓取中的狀態 */
  const cancelPendingFetch = () => {
    bumpSourceSeq();
    setIsFetchingGitLab(false);
  };
  /** 分析開始時佔用（已有分析在跑就回傳 false）；回傳的 release 只釋放自己那次 */
  const claimAnalysis = (seq: number) => {
    if (analysisSeqRef.current !== null) return null;
    analysisSeqRef.current = seq;
    return () => {
      if (analysisSeqRef.current === seq) analysisSeqRef.current = null;
    };
  };

  // Stage 2: Publishing & Discussion states（隨結果保存到歷史紀錄）
  const [publishStates, setPublishStates] = useState<Record<number, ReviewPublishState>>({});
  const [isSummaryPublished, setIsSummaryPublished] = useState<boolean>(false);
  const [isSharedToMrPublished, setIsSharedToMrPublished] = useState<boolean>(false);

  const [analyzedAt, setAnalyzedAt] = useState<number | null>(null);
  // 產生目前結果的 diff 與 diff_refs（可能與左欄最新抓取的 diff 不同，例如 MR 有新 commit）
  const [resultRawDiff, setResultRawDiff] = useState<string>('');
  const [resultDiffRefs, setResultDiffRefs] = useState<GitLabDiffRefs | undefined>(undefined);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [draftEdits, setDraftEdits] = useState<DraftEdits>({});
  const [publishedRecords, setPublishedRecords] = useState<PublishedRecord[]>([]);
  const [remoteNotes, setRemoteNotes] = useState<GitLabNote[]>([]);

  // Parse diff on the fly
  const parsedDiff = useMemo(() => {
    return parseGitDiff(rawDiff);
  }, [rawDiff]);

  const resultDiffFiles = useMemo(() => {
    return resultRawDiff ? parseGitDiff(resultRawDiff).files : parsedDiff.files;
  }, [resultRawDiff, parsedDiff]);

  // 勾選、編輯、發布狀態變動時寫回目前紀錄（update 不會重建已刪除的紀錄）
  useEffect(() => {
    if (!historyStore || !currentRecordId) return;
    historyStore
      .update(currentRecordId, {
        selectedIndices: Array.from(selectedIndices),
        draftEdits,
        published: publishedRecords,
        summaryPublished: isSummaryPublished,
        sharedPublished: isSharedToMrPublished,
      })
      .catch(() => {
        // ignore
      });
  }, [
    historyStore,
    currentRecordId,
    selectedIndices,
    draftEdits,
    publishedRecords,
    isSummaryPublished,
    isSharedToMrPublished,
  ]);

  const resetToEmpty = () => {
    cancelPendingFetch();
    setAnalysisResult(null);
    setCurrentRecordId(null);
    setAnalyzedAt(null);
    setResultRawDiff('');
    setResultDiffRefs(undefined);
    setSelectedIndices(new Set());
    setDraftEdits({});
    setPublishedRecords([]);
    setRemoteNotes([]);
    setPublishStates({});
    setIsSummaryPublished(false);
    setIsSharedToMrPublished(false);
    setRawDiff('');
    setCurrentGitLabMr(null);
    setGitlabMrUrl('');
    setStaleSharedAnalysis(null);
  };

  /**
   * 把一筆歷史紀錄套用到畫面（不呼叫 Gemini）。歷史紀錄與快取可能是舊版或被竄改的資料，
   * 先正規化 category／severity，避免畫面查不到對應的圖示或樣式而整頁白掉。
   */
  const applyRecord = (record: HistoryRecord) => {
    const result = normalizeResultReviews(record.result);
    setAnalysisResult(
      record.rawDiff
        ? { ...result, reviews: dropUnverifiedFallbackLines(result.reviews, parseGitDiff(record.rawDiff)) }
        : result
    );
    setCurrentRecordId(record.id);
    setAnalyzedAt(record.analyzedAt);
    setResultRawDiff(record.rawDiff);
    setResultDiffRefs(record.mr?.diff_refs);
    setSelectedIndices(new Set(record.selectedIndices));
    setDraftEdits(record.draftEdits || {});
    setPublishedRecords(record.published || []);
    setPublishStates({});
    setIsSummaryPublished(!!record.summaryPublished);
    setIsSharedToMrPublished(!!record.sharedPublished);
    setErrorMessage(null);
  };

  /** 從歷史抽屜開啟紀錄：套用結果，並把左欄還原成該紀錄的 diff 與 MR */
  const openRecord = (record: HistoryRecord) => {
    cancelPendingFetch();
    applyRecord(record);
    setRawDiff(record.rawDiff);
    setCurrentGitLabMr(record.mr ? (record.mr as GitLabMergeRequestInfo) : null);
    setGitlabMrUrl(record.mrUrl ?? '');
    setRemoteNotes([]);
    setStaleSharedAnalysis(null);
    setGitlabError(null);
  };

  /** 依目前來源計算歷史紀錄 key 與中繼資料 */
  const describeSource = (diffText: string, mr: GitLabMergeRequestInfo | null) => {
    if (mr) {
      try {
        const parsed = parseGitLabMrUrl(mr.web_url, settings.gitlabBaseUrl || 'https://gitlab.com');
        return {
          id: buildMrHistoryKey(parsed.baseUrl, parsed.projectPath, parsed.mrIid),
          sourceType: 'gitlab' as HistorySourceType,
          host: normalizeHost(parsed.baseUrl),
          projectPath: parsed.projectPath,
          mrIid: parsed.mrIid,
        };
      } catch {
        // 無法解析時退回以 diff hash 當 key
      }
    }
    const isSample = diffText.trim() === SAMPLE_GIT_DIFF.trim();
    return {
      id: buildDiffHistoryKey(diffText),
      sourceType: (isSample ? 'sample' : 'manual') as HistorySourceType,
    };
  };

  /**
   * 顯示一份新的分析結果並寫入歷史紀錄。
   * 同一個 key 已有紀錄時（重新分析）保留已發布紀錄與釘選狀態。
   * isStale 回傳 true 時（例如已切到其他 MR）只寫入歷史紀錄，不套用到畫面。
   */
  const commitNewResult = async (
    result: MRAnalysisResult,
    diffText: string,
    mr: GitLabMergeRequestInfo | null,
    notes: GitLabNote[],
    isStale: () => boolean = () => false
  ) => {
    const source = describeSource(diffText, mr);
    const recordKey = recordKeyForResult(source.id, result);
    let existing: HistoryRecord | undefined;
    if (historyStore) {
      try {
        existing = await historyStore.get(recordKey);
        // 用 Gemini 重新分析時沿用舊版（無 provider 後綴）紀錄的已發布狀態與釘選，並取代之
        if (!existing && result.provider === 'gemini') existing = await historyStore.get(source.id);
      } catch {
        existing = undefined;
      }
    }
    const now = Date.now();
    const record = buildAnalysisRecord({ source, result, diffText, mr, notes, existing, now });

    if (historyStore) {
      try {
        await historyStore.put(record, now);
        if (existing && existing.id !== record.id) await historyStore.remove(existing.id);
        await refreshHistory();
      } catch {
        // 寫入失敗不影響顯示
      }
    }
    if (isStale()) return;
    applyRecord(record);
    if (!historyStore) setCurrentRecordId(null);
    setStaleSharedAnalysis(null);
  };

  /** 402 額度不足後一鍵改用 OpenRouter 免費模型（使用者明確點選才切換，不自動 fallback） */
  const handleUseFreeModel = () => {
    handleSaveSettings(setProviderSettings(settings, 'openrouter', { model: OPENROUTER_SUGGESTED_FREE_MODEL }));
    setErrorMessage(null);
    setInfoMessage(`已改用 OpenRouter 免費模型 ${OPENROUTER_SUGGESTED_FREE_MODEL}，請再按一次「分析」。免費模型有請求次數上限。`);
  };

  /**
   * 呼叫 AI 分析 diffText。seq 為分析開始時的來源序號：結果回來時已切到其他來源（序號不同），
   * 結果只寫入歷史紀錄、不套用到畫面，錯誤也不顯示（與 #67 抓取 MR 的序號保護相同）。
   */
  const runAnalysis = async (diffText: string, mr: GitLabMergeRequestInfo | null, seq: number) => {
    if (!providerReady) {
      setIsSetupGuideOpen(true);
      return;
    }
    const isStale = () => seq !== fetchSeqRef.current;

    setIsSetupGuideOpen(false);
    setIsLoading(true);
    setBatchProgress(null);
    setErrorMessage(null);

    try {
      const provider = ai.createProvider(settings);
      const aiResult = await analyzeGitDiff({
        rawDiff: diffText,
        provider,
        teamRules: settings.teamRules,
        onBatchProgress: (current, total) => {
          if (!isStale()) setBatchProgress({ current, total });
        },
      });
      // AI 回傳的 category／severity 不一定在認得的範圍內，寫入歷史紀錄前先正規化
      await commitNewResult(normalizeResultReviews(aiResult), diffText, mr, remoteNotes, isStale);
    } catch (err: unknown) {
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setFreeModelSuggestedFor(
        shouldSuggestFreeModel(err, settings.llmProvider, getProviderSettings(settings).model) ? msg : null
      );
    } finally {
      if (!isStale()) {
        setIsLoading(false);
        setBatchProgress(null);
      }
    }
  };

  /** 「分析」：分析進行中（含讀快取的空檔）再按會被擋下，連點只會呼叫 AI 一次 */
  const handleAnalyze = async () => {
    const seq = fetchSeqRef.current;
    const release = claimAnalysis(seq);
    if (!release) return;
    try {
      // 有快取（且不是正在顯示的那筆）就直接顯示，不呼叫 Gemini；
      // 正在顯示的紀錄再按「分析」視為使用者要求重新分析（保留已發布紀錄）。
      if (historyStore && rawDiff.trim()) {
        const source = describeSource(rawDiff, currentGitLabMr);
        try {
          const cached = await findCachedRecord(historyStore, source.id, currentProviderModel);
          if (seq !== fetchSeqRef.current) return;
          if (
            cached &&
            shouldServeFromCache({
              sourceId: cached.id,
              currentRecordId,
              cached,
              currentHeadSha: currentGitLabMr?.diff_refs?.head_sha,
            })
          ) {
            applyRecord(cached);
            return;
          }
        } catch {
          // 讀取失敗就照常分析
        }
      }
      await runAnalysis(rawDiff, currentGitLabMr, seq);
    } finally {
      release();
    }
  };

  /**
   * 「重新分析」（新 commit 提示列與過期共享報告卡片共用）：先重新抓最新 MR 與 diff，再呼叫 AI 分析。
   * 沒有 MR（手動貼上的 diff）時直接分析左欄的 diff。
   */
  const handleReanalyze = async () => {
    if (analysisSeqRef.current !== null) return;
    const mrUrl = currentGitLabMr?.web_url;
    if (!mrUrl) {
      const seq = fetchSeqRef.current;
      const release = claimAnalysis(seq);
      if (!release) return;
      try {
        await runAnalysis(rawDiff, currentGitLabMr, seq);
      } finally {
        release();
      }
      return;
    }
    if (!providerReady) {
      setIsSetupGuideOpen(true);
      return;
    }
    // 重新抓取目前 MR 也算一次抓取：進行中的其他抓取作廢；抓取期間又切到其他 MR 時不再分析
    const seq = bumpSourceSeq();
    const release = claimAnalysis(seq);
    if (!release) return;
    const isStale = () => seq !== fetchSeqRef.current;
    try {
      setIsFetchingGitLab(true);
      setGitlabError(null);
      let latestMr: GitLabMergeRequestInfo;
      let latestDiff: string;
      try {
        const target = gitlab.resolveTarget(mrUrl, settings);
        latestMr = await gitlab.fetchMergeRequest(target);
        latestDiff = await gitlab.fetchRawDiff(target);
        if (isStale()) return;
        setCurrentGitLabMr(latestMr);
        setGitlabMrUrl(latestMr.web_url);
        setRawDiff(latestDiff);
      } catch (err: unknown) {
        if (!isStale()) setGitlabError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        if (!isStale()) setIsFetchingGitLab(false);
      }
      await runAnalysis(latestDiff, latestMr, seq);
    } finally {
      release();
    }
  };

  // Stage 2: Fetch MR and Notes from GitLab
  /** 抓取 MR、diff 與留言；只套用最新一次抓取的回應（含自動載入共享結果、錯誤與 loading 狀態） */
  const handleFetchGitLabMr = async (url: string) => {
    const seq = bumpSourceSeq();
    const isStale = () => seq !== fetchSeqRef.current;
    setIsFetchingGitLab(true);
    setGitlabError(null);
    setStaleSharedAnalysis(null);

    try {
      const target = gitlab.resolveTarget(url, settings);
      const { baseUrl, projectPath, mrIid } = target;

      // 1. Fetch MR info
      const mrInfo = await gitlab.fetchMergeRequest(target);
      if (isStale()) return;
      setCurrentGitLabMr(mrInfo);

      // 2. Fetch Raw Diff
      const fetchedDiff = await gitlab.fetchRawDiff(target);
      if (isStale()) return;
      setRawDiff(fetchedDiff);

      // 3. Check for previously shared analysis in notes（同時保留留言供重複發布比對）
      let notes: GitLabNote[] = [];
      let notesLoaded = false;
      let shared: SharedAnalysis | null = null;
      try {
        notes = await gitlab.fetchNotes(target);
        notesLoaded = true;
        shared = findSharedAnalysisInNotes(notes);
      } catch {
        // TODO(#79): 讀不到留言時要提示使用者（目前不顯示錯誤）。
        // 讀不到留言不影響抓 diff；保留既有的留言，不清成 []（發布前會重新讀，讀不到就中止）
      }
      if (isStale()) return;
      if (notesLoaded) setRemoteNotes(notes);

      // 共享報告的分析版本與 MR 目前 head sha 不同（或舊版標記沒記錄）時不載入，只顯示提示卡片
      const latestHead = mrInfo.diff_refs?.head_sha ?? null;
      const sharedIsCurrent = !!shared && isSharedAnalysisCurrent(shared, latestHead);
      if (shared && !sharedIsCurrent) {
        setStaleSharedAnalysis({
          author: shared.author,
          createdAt: shared.createdAt,
          sharedHeadSha: shared.headSha,
          currentHeadSha: latestHead,
        });
      }

      // 4. 有快取就直接顯示，不呼叫 Gemini；切到沒有快取的 MR 時清掉前一個 MR 的結果
      // 快取依 MR + 目前所選 provider / model 查找
      const sourceKey = buildMrHistoryKey(baseUrl, projectPath, mrIid);
      const cached = historyStore
        ? await findCachedRecord(historyStore, sourceKey, currentProviderModel).catch(() => undefined)
        : undefined;
      if (isStale()) return;
      const cachedIsCurrent = !!cached && !!latestHead && cached.headSha === latestHead;
      if (shared && sharedIsCurrent && !cachedIsCurrent) {
        // 5. 共享報告與 MR 目前版本相同：自動載入（不呼叫 AI）；本機已有同版本快取時以快取為準（保留草稿與發布紀錄）
        await loadSharedAnalysis(shared, fetchedDiff, mrInfo, notes, isStale);
      } else if (cached) {
        applyRecord(cached);
        if (latestHead && latestHead !== cached.latestHeadSha && historyStore) {
          await historyStore.update(cached.id, { latestHeadSha: latestHead }).catch(() => undefined);
        }
        await refreshHistory();
      } else if (
        currentRecordIdRef.current !== sourceKey &&
        !currentRecordIdRef.current?.startsWith(`${sourceKey}#`)
      ) {
        setAnalysisResult(null);
        setCurrentRecordId(null);
        setAnalyzedAt(null);
        setResultRawDiff('');
        setResultDiffRefs(undefined);
        setPublishStates({});
        setIsSummaryPublished(false);
        setIsSharedToMrPublished(false);
      }
    } catch (err: unknown) {
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : String(err);
      setGitlabError(msg);
    } finally {
      if (!isStale()) setIsFetchingGitLab(false);
    }
  };

  // Stage 2: Load shared analysis from MR note (Mechanism 1: Free of Gemini API key)
  /** 載入與 MR 目前版本相同的共享報告：以剛抓到的 diff 對齊行號後當成新結果顯示並寫入歷史紀錄 */
  const loadSharedAnalysis = async (
    shared: SharedAnalysis,
    diffText: string,
    mr: GitLabMergeRequestInfo,
    notes: GitLabNote[],
    isStale: () => boolean
  ) => {
    const parsed = parseGitDiff(diffText);
    const enrichedResult = {
      ...shared.result,
      groups: enrichGroupsWithParsedDiff(shared.result.groups, parsed),
      reviews: alignReviewsWithDiff(shared.result.reviews || [], parsed),
    };
    await commitNewResult(enrichedResult, diffText, mr, notes, isStale);
    if (isStale()) return;
    setInfoMessage(
      `已自動載入由 ${formatAuthorText(shared.author)} 於 ${formatYmd(shared.createdAt)} 共享的分析報告（與 MR 目前版本相同，未呼叫 AI）。`
    );
  };

  const handleLoadSampleDiff = () => {
    cancelPendingFetch();
    setRawDiff(SAMPLE_GIT_DIFF);
    setCurrentGitLabMr(null);
    setGitlabMrUrl('');
  };

  const handleLoadSampleAnalysis = () => {
    cancelPendingFetch();
    setRawDiff(SAMPLE_GIT_DIFF);
    const parsed = parseGitDiff(SAMPLE_GIT_DIFF);
    setAnalysisResult({
      ...SAMPLE_ANALYSIS_RESULT,
      groups: enrichGroupsWithParsedDiff(SAMPLE_ANALYSIS_RESULT.groups, parsed),
      reviews: alignReviewsWithDiff(SAMPLE_ANALYSIS_RESULT.reviews, parsed),
    });
    setErrorMessage(null);
    setPublishStates({});
    setIsSummaryPublished(false);
    setCurrentRecordId(null);
    setAnalyzedAt(null);
    setResultRawDiff(SAMPLE_GIT_DIFF);
    setResultDiffRefs(undefined);
    setSelectedIndices(defaultSelectedIndices(SAMPLE_ANALYSIS_RESULT.reviews, {}));
    setDraftEdits({});
    setPublishedRecords([]);
  };

  const handleOpenFileDiff = (file: DiffFile, line?: number | null) => {
    setInspectingDiff({ file, line });
  };

  return {
    rawDiff,
    setRawDiff,
    parsedDiff,
    analysisResult,
    isLoading,
    batchProgress,
    errorMessage,
    setErrorMessage,
    suggestFreeModel,
    infoMessage,
    setInfoMessage,
    inspectingDiff,
    setInspectingDiff,
    gitlabMrUrl,
    setGitlabMrUrl,
    isFetchingGitLab,
    currentGitLabMr,
    gitlabError,
    staleSharedAnalysis,
    publishStates,
    setPublishStates,
    isSummaryPublished,
    setIsSummaryPublished,
    isSharedToMrPublished,
    setIsSharedToMrPublished,
    analyzedAt,
    resultDiffFiles,
    resultDiffRefs,
    selectedIndices,
    setSelectedIndices,
    draftEdits,
    setDraftEdits,
    publishedRecords,
    setPublishedRecords,
    remoteNotes,
    setRemoteNotes,
    resetToEmpty,
    openRecord,
    handleUseFreeModel,
    handleAnalyze,
    handleReanalyze,
    handleFetchGitLabMr,
    handleLoadSampleDiff,
    handleLoadSampleAnalysis,
    handleOpenFileDiff,
  };
}

export type AnalysisState = ReturnType<typeof useAnalysis>;
