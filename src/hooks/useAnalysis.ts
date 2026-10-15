/**
 * 分析與目前結果：左欄 diff／MR 來源、分析流程、快取命中、提示與錯誤訊息，
 * 以及隨結果保存到歷史紀錄的勾選、草稿、已發布紀錄與發布狀態。
 */
import { useEffect, useMemo, useState } from 'react';
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

/** 未載入的共享報告（分析版本與 MR 目前版本不符，或舊版標記沒有記錄分析版本） */
export interface StaleSharedAnalysis {
  author: string;
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

  /** 把一筆歷史紀錄套用到畫面（不呼叫 Gemini） */
  const applyRecord = (record: HistoryRecord) => {
    setAnalysisResult(
      record.rawDiff
        ? { ...record.result, reviews: dropUnverifiedFallbackLines(record.result.reviews, parseGitDiff(record.rawDiff)) }
        : record.result
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
   */
  const commitNewResult = async (
    result: MRAnalysisResult,
    diffText: string,
    mr: GitLabMergeRequestInfo | null,
    notes: GitLabNote[]
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

  const runAnalysis = async (diffText: string, mr: GitLabMergeRequestInfo | null) => {
    if (!providerReady) {
      setIsSetupGuideOpen(true);
      return;
    }

    setIsSetupGuideOpen(false);
    setIsLoading(true);
    setBatchProgress(null);
    setErrorMessage(null);

    try {
      const provider = ai.createProvider(settings);
      const result = await analyzeGitDiff({
        rawDiff: diffText,
        provider,
        teamRules: settings.teamRules,
        onBatchProgress: (current, total) => {
          setBatchProgress({ current, total });
        },
      });
      await commitNewResult(result, diffText, mr, remoteNotes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setFreeModelSuggestedFor(
        shouldSuggestFreeModel(err, settings.llmProvider, getProviderSettings(settings).model) ? msg : null
      );
    } finally {
      setIsLoading(false);
      setBatchProgress(null);
    }
  };

  const handleAnalyze = async () => {
    // 有快取（且不是正在顯示的那筆）就直接顯示，不呼叫 Gemini；
    // 正在顯示的紀錄再按「分析」視為使用者要求重新分析（保留已發布紀錄）。
    if (historyStore && rawDiff.trim()) {
      const source = describeSource(rawDiff, currentGitLabMr);
      try {
        const cached = await findCachedRecord(historyStore, source.id, currentProviderModel);
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
    await runAnalysis(rawDiff, currentGitLabMr);
  };

  /** 新 commit 提示列的「重新分析」：先抓最新 MR 與 diff，再分析 */
  const handleReanalyze = async () => {
    const mrUrl = currentGitLabMr?.web_url;
    if (!mrUrl) {
      await runAnalysis(rawDiff, currentGitLabMr);
      return;
    }
    if (!providerReady) {
      setIsSetupGuideOpen(true);
      return;
    }
    setIsFetchingGitLab(true);
    setGitlabError(null);
    let latestMr: GitLabMergeRequestInfo;
    let latestDiff: string;
    try {
      const target = gitlab.resolveTarget(mrUrl, settings);
      latestMr = await gitlab.fetchMergeRequest(target);
      latestDiff = await gitlab.fetchRawDiff(target);
      setCurrentGitLabMr(latestMr);
      setGitlabMrUrl(latestMr.web_url);
      setRawDiff(latestDiff);
    } catch (err: unknown) {
      setGitlabError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setIsFetchingGitLab(false);
    }
    await runAnalysis(latestDiff, latestMr);
  };

  // Stage 2: Fetch MR and Notes from GitLab
  const handleFetchGitLabMr = async (url: string) => {
    setIsFetchingGitLab(true);
    setGitlabError(null);
    setStaleSharedAnalysis(null);

    try {
      const target = gitlab.resolveTarget(url, settings);
      const { baseUrl, projectPath, mrIid } = target;

      // 1. Fetch MR info
      const mrInfo = await gitlab.fetchMergeRequest(target);
      setCurrentGitLabMr(mrInfo);

      // 2. Fetch Raw Diff
      const fetchedDiff = await gitlab.fetchRawDiff(target);
      setRawDiff(fetchedDiff);

      // 3. Check for previously shared analysis in notes（同時保留留言供重複發布比對）
      let notes: GitLabNote[] = [];
      let shared: SharedAnalysis | null = null;
      try {
        notes = await gitlab.fetchNotes(target);
        shared = findSharedAnalysisInNotes(notes);
      } catch {
        // notes checking failure does not block diff fetching
      }
      setRemoteNotes(notes);

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
      const cachedIsCurrent = !!cached && !!latestHead && cached.headSha === latestHead;
      if (shared && sharedIsCurrent && !cachedIsCurrent) {
        // 5. 共享報告與 MR 目前版本相同：自動載入（不呼叫 AI）；本機已有同版本快取時以快取為準（保留草稿與發布紀錄）
        await loadSharedAnalysis(shared, fetchedDiff, mrInfo, notes);
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
      const msg = err instanceof Error ? err.message : String(err);
      setGitlabError(msg);
    } finally {
      setIsFetchingGitLab(false);
    }
  };

  // Stage 2: Load shared analysis from MR note (Mechanism 1: Free of Gemini API key)
  /** 載入與 MR 目前版本相同的共享報告：以剛抓到的 diff 對齊行號後當成新結果顯示並寫入歷史紀錄 */
  const loadSharedAnalysis = async (
    shared: SharedAnalysis,
    diffText: string,
    mr: GitLabMergeRequestInfo,
    notes: GitLabNote[]
  ) => {
    const parsed = parseGitDiff(diffText);
    const enrichedResult = {
      ...shared.result,
      groups: enrichGroupsWithParsedDiff(shared.result.groups, parsed),
      reviews: alignReviewsWithDiff(shared.result.reviews || [], parsed),
    };
    await commitNewResult(enrichedResult, diffText, mr, notes);
    setInfoMessage(
      `已自動載入由 @${shared.author} 於 ${new Date(shared.createdAt).toLocaleDateString()} 共享的分析報告（與 MR 目前版本相同，未呼叫 AI）。`
    );
  };

  const handleLoadSampleDiff = () => {
    setRawDiff(SAMPLE_GIT_DIFF);
    setCurrentGitLabMr(null);
    setGitlabMrUrl('');
  };

  const handleLoadSampleAnalysis = () => {
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
