import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { DiffInputPanel } from './components/DiffInputPanel';
import { AnalysisResultView } from './components/AnalysisResultView';
import { DiffViewerModal } from './components/DiffViewerModal';
import { PublishConfirmationModal } from './components/PublishConfirmationModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { ConfirmDialog } from './components/ConfirmDialog';
import {
  buildDiffHistoryKey,
  buildMrHistoryKey,
  DraftEdits,
  formatHistoryTime,
  hasNewCommit,
  HistoryRecord,
  HistorySourceType,
  HistoryStore,
  normalizeHost,
  PublishedRecord,
} from './core/history-store';
import {
  createPublishedRecord,
  defaultSelectedIndices,
  findPublishedMatches,
  partitionDuplicates,
} from './core/publish-dedup';
import {
  buildAnalysisRecord,
  findCachedRecord,
  recordKeyForResult,
  shouldServeFromCache,
} from './core/analysis-record';
import { getProviderSettings, setProviderSettings } from './core/settings-store';
import { enrichGroupsWithParsedDiff, parseGitDiff } from './core/diff-parser';
import { alignReviewsWithDiff, dropUnverifiedFallbackLines } from './core/line-resolver';
import { analyzeGitDiff } from './services/review-service';
import { PROVIDER_META } from './providers/registry';
import { ProviderId } from './providers/types';
import { OPENROUTER_SUGGESTED_FREE_MODEL, shouldSuggestFreeModel } from './providers/openai-compatible';
import { SAMPLE_GIT_DIFF } from './services/diff-sources/sample-diffs';
import { SAMPLE_ANALYSIS_RESULT } from './services/diff-sources/sample-analysis';
import { AppSettings } from './types/settings';
import { MRAnalysisResult, MRReviewItem } from './types/review';
import { DiffFile } from './types/diff';
import {
  GitLabDiffRefs,
  GitLabMergeRequestInfo,
  GitLabNote,
  ReviewPublishState,
} from './types/gitlab';
import {
  findExistingOverallNote,
  findSharedAnalysisInNotes,
  parseGitLabMrUrl,
  SUMMARY_TAG,
} from './services/gitlab-api';
import { PublishTarget } from './services/review-publisher';
import { AppServices, withNotice } from './app/app-services';
import { SetupGuide } from './components/SetupGuide';
import { AlertCircle, DatabaseZap, FlaskConical, Info, Sparkles } from 'lucide-react';

type PublishItem = {
  review: MRReviewItem;
  customComment?: string;
  customSuggestion?: string;
  index: number;
};

/** 結果標記：「OpenAI · gpt-4.1-mini」；舊結果沒有標記時不顯示 */
function formatGeneratedBy(result: MRAnalysisResult): string | undefined {
  if (!result.provider) return undefined;
  const label = PROVIDER_META[result.provider as ProviderId]?.label ?? result.provider;
  return result.model ? `${label} · ${result.model}` : label;
}

/**
 * 主畫面。設定儲存、AI、GitLab 與歷史紀錄都由 services 注入（正式版或示範模式），App 本身不分辨模式。
 */
export default function App({ services }: { services: AppServices }) {
  const { settings: settingsGateway, ai, gitlab } = services;
  const SettingsDialog = settingsGateway.Dialog;
  const [settings, setSettings] = useState<AppSettings>(() => settingsGateway.load());
  const providerSetupNotice = ai.setupNotice(settings);
  const providerReady = providerSetupNotice === null;
  /** 目前所選 provider / model，作為快取 key 的一部分 */
  const currentProviderModel = {
    provider: settings.llmProvider,
    model: getProviderSettings(settings).model.trim(),
  };

  const [rawDiff, setRawDiff] = useState<string>(services.initialRawDiff);
  const [analysisResult, setAnalysisResult] = useState<MRAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** OpenRouter 分析回 402 額度不足時，在錯誤橫幅提供「改用免費模型」 */
  const [freeModelSuggestedFor, setFreeModelSuggestedFor] = useState<string | null>(null);
  const suggestFreeModel = errorMessage !== null && freeModelSuggestedFor === errorMessage;
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  /** 尚未設定金鑰就按「分析」時顯示的引導 */
  const [isSetupGuideOpen, setIsSetupGuideOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [inspectingDiff, setInspectingDiff] = useState<{ file: DiffFile; line?: number | null } | null>(null);

  // Stage 2: GitLab Integration States
  const [gitlabMrUrl, setGitlabMrUrl] = useState<string>('');
  const [isFetchingGitLab, setIsFetchingGitLab] = useState<boolean>(false);
  const [currentGitLabMr, setCurrentGitLabMr] = useState<GitLabMergeRequestInfo | null>(null);
  const [gitlabError, setGitlabError] = useState<string | null>(null);
  const [sharedAnalysisAvailable, setSharedAnalysisAvailable] = useState<{
    result: MRAnalysisResult;
    noteId: number;
    author: string;
    createdAt: string;
  } | null>(null);

  // Stage 2: Publishing & Discussion states
  const [publishStates, setPublishStates] = useState<Record<number, ReviewPublishState>>({});
  const [isSummaryPublished, setIsSummaryPublished] = useState<boolean>(false);
  const [isSharedToMrPublished, setIsSharedToMrPublished] = useState<boolean>(false);
  const [isSharingToMr, setIsSharingToMr] = useState<boolean>(false);

  // Confirmation Modal state
  const [isPublishModalOpen, setIsPublishModalOpen] = useState<boolean>(false);
  const [isPublishingInProgress, setIsPublishingInProgress] = useState<boolean>(false);
  const [publishModalConfig, setPublishModalConfig] = useState<{
    isPublishingSummary: boolean;
    itemsToPublish: Array<{
      review: MRReviewItem;
      customComment?: string;
      customSuggestion?: string;
      index: number;
    }>;
  }>({
    isPublishingSummary: false,
    itemsToPublish: [],
  });

  // 快取與歷史紀錄
  const [historyStore, setHistoryStore] = useState<HistoryStore | null>(null);
  // null = 檢查中；false = 此瀏覽器無法使用 IndexedDB
  const [historyAvailable, setHistoryAvailable] = useState<boolean | null>(null);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);
  const currentRecordIdRef = useRef<string | null>(null);
  currentRecordIdRef.current = currentRecordId;
  const [analyzedAt, setAnalyzedAt] = useState<number | null>(null);
  // 產生目前結果的 diff 與 diff_refs（可能與左欄最新抓取的 diff 不同，例如 MR 有新 commit）
  const [resultRawDiff, setResultRawDiff] = useState<string>('');
  const [resultDiffRefs, setResultDiffRefs] = useState<GitLabDiffRefs | undefined>(undefined);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [draftEdits, setDraftEdits] = useState<DraftEdits>({});
  const [publishedRecords, setPublishedRecords] = useState<PublishedRecord[]>([]);
  const [remoteNotes, setRemoteNotes] = useState<GitLabNote[]>([]);
  const [duplicateWarning, setDuplicateWarning] = useState<{ fresh: PublishItem[]; duplicates: PublishItem[] } | null>(null);

  // Parse diff on the fly
  const parsedDiff = useMemo(() => {
    return parseGitDiff(rawDiff);
  }, [rawDiff]);

  const resultDiffFiles = useMemo(() => {
    return resultRawDiff ? parseGitDiff(resultRawDiff).files : parsedDiff.files;
  }, [resultRawDiff, parsedDiff]);

  const publishedMatches = useMemo(() => {
    if (!analysisResult) return {};
    return findPublishedMatches(analysisResult.reviews, draftEdits, publishedRecords, remoteNotes);
  }, [analysisResult, draftEdits, publishedRecords, remoteNotes]);

  const currentRecord = useMemo(
    () => historyRecords.find((r) => r.id === currentRecordId) ?? null,
    [historyRecords, currentRecordId]
  );

  const refreshHistory = useCallback(async (store: HistoryStore | null = historyStore) => {
    if (!store) return;
    try {
      setHistoryRecords(await store.list());
    } catch {
      // ignore
    }
  }, [historyStore]);

  // App 啟動：開啟 IndexedDB 並清理過期／超量紀錄
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await services.openHistoryStore();
      if (cancelled) return;
      if (!store) {
        setHistoryAvailable(false);
        return;
      }
      try {
        await store.prune();
        const list = await store.list();
        if (cancelled) return;
        setHistoryRecords(list);
        setHistoryStore(store);
        setHistoryAvailable(true);
      } catch {
        if (!cancelled) setHistoryAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setSharedAnalysisAvailable(null);
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
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    settingsGateway.save(newSettings);
  };

  /** 402 額度不足後一鍵改用 OpenRouter 免費模型（使用者明確點選才切換，不自動 fallback） */
  const handleUseFreeModel = () => {
    handleSaveSettings(setProviderSettings(settings, 'openrouter', { model: OPENROUTER_SUGGESTED_FREE_MODEL }));
    setErrorMessage(null);
    setInfoMessage(`已改用 OpenRouter 免費模型 ${OPENROUTER_SUGGESTED_FREE_MODEL}，請再按一次「分析」。免費模型有請求次數上限。`);
  };

  /** 「清除 key」：立即移除該 provider 的金鑰 */
  const handleClearProviderKey = (id: ProviderId) => {
    setSettings(settingsGateway.clearKey(settings, id));
  };

  const openSettingsFromGuide = () => {
    setIsSetupGuideOpen(false);
    setIsSettingsOpen(true);
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

  /** 從抽屜開啟紀錄；MR 紀錄會在背景確認是否有新 commit 並讀取現有留言 */
  const handleOpenRecord = async (id: string) => {
    if (!historyStore) return;
    const record = await historyStore.get(id).catch(() => undefined);
    if (!record) {
      await refreshHistory();
      return;
    }
    setIsHistoryOpen(false);
    applyRecord(record);
    setRawDiff(record.rawDiff);
    setCurrentGitLabMr(record.mr ? (record.mr as GitLabMergeRequestInfo) : null);
    setGitlabMrUrl(record.mrUrl ?? '');
    setRemoteNotes([]);
    setSharedAnalysisAvailable(null);
    setGitlabError(null);

    if (record.sourceType !== 'gitlab' || !record.mrUrl) return;
    try {
      const target = gitlab.resolveTarget(record.mrUrl, settings);
      const [latestMr, notes] = await Promise.all([gitlab.fetchMergeRequest(target), gitlab.fetchNotes(target)]);
      if (currentRecordIdRef.current !== id) return;
      setRemoteNotes(notes);
      const latestHead = latestMr.diff_refs?.head_sha ?? null;
      if (latestHead && latestHead !== record.latestHeadSha) {
        await historyStore.update(id, { latestHeadSha: latestHead });
        await refreshHistory();
      }
    } catch {
      // 連不到 GitLab 時仍顯示快取結果
    }
  };

  const handleTogglePin = async (id: string) => {
    if (!historyStore) return;
    const record = historyRecords.find((r) => r.id === id);
    await historyStore.update(id, { pinned: !record?.pinned }).catch(() => undefined);
    await refreshHistory();
  };

  const handleDeleteRecord = async (id: string) => {
    if (!historyStore) return;
    await historyStore.remove(id).catch(() => undefined);
    if (id === currentRecordId) resetToEmpty();
    await refreshHistory();
  };

  const handleClearUnpinned = async () => {
    if (!historyStore) return;
    await historyStore.clearUnpinned().catch(() => 0);
    if (currentRecord && !currentRecord.pinned) resetToEmpty();
    await refreshHistory();
  };

  // Stage 2: Fetch MR and Notes from GitLab
  const handleFetchGitLabMr = async (url: string) => {
    setIsFetchingGitLab(true);
    setGitlabError(null);
    setSharedAnalysisAvailable(null);

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
      try {
        notes = await gitlab.fetchNotes(target);
        const shared = findSharedAnalysisInNotes(notes);
        if (shared) {
          setSharedAnalysisAvailable(shared);
        }
      } catch {
        // notes checking failure does not block diff fetching
      }
      setRemoteNotes(notes);

      // 4. 有快取就直接顯示，不呼叫 Gemini；切到沒有快取的 MR 時清掉前一個 MR 的結果
      // 快取依 MR + 目前所選 provider / model 查找
      const sourceKey = buildMrHistoryKey(baseUrl, projectPath, mrIid);
      const cached = historyStore
        ? await findCachedRecord(historyStore, sourceKey, currentProviderModel).catch(() => undefined)
        : undefined;
      if (cached) {
        const latestHead = mrInfo.diff_refs?.head_sha ?? null;
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
  const handleLoadSharedAnalysis = async () => {
    if (sharedAnalysisAvailable) {
      const enrichedResult = {
        ...sharedAnalysisAvailable.result,
        groups: enrichGroupsWithParsedDiff(sharedAnalysisAvailable.result.groups, parsedDiff),
        reviews: alignReviewsWithDiff(sharedAnalysisAvailable.result.reviews || [], parsedDiff),
      };
      setSharedAnalysisAvailable(null);
      await commitNewResult(enrichedResult, rawDiff, currentGitLabMr, remoteNotes);
    }
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

  const openPublishModal = (items: PublishItem[]) => {
    setPublishModalConfig({
      isPublishingSummary: false,
      itemsToPublish: items,
    });
    setIsPublishModalOpen(true);
  };

  /**
   * 發布前比對本地發布紀錄＋MR 現有留言；有重複時先跳橘色警告，按「仍要發布」才進原本的發布確認。
   */
  const requestPublishReviews = async (items: PublishItem[]) => {
    if (!gitlab.isConfigured(settings)) {
      setIsSettingsOpen(true);
      return;
    }
    if (!analysisResult || items.length === 0 || isPublishingInProgress) return;

    let notes = remoteNotes;
    try {
      const fresh = await gitlab.fetchNotes(gitlab.resolveTarget(currentGitLabMr?.web_url || gitlabMrUrl, settings));
      if (fresh.length > 0) {
        notes = fresh;
        setRemoteNotes(fresh);
      }
    } catch {
      // 沒有目標 MR 或讀不到留言時，只用本地紀錄與先前讀到的留言比對
    }

    const drafts: DraftEdits = { ...draftEdits };
    items.forEach((item) => {
      if (item.customComment !== undefined || item.customSuggestion !== undefined) {
        drafts[item.index] = {
          comment: item.customComment ?? item.review.comment,
          suggestion: item.customSuggestion ?? item.review.suggestion,
        };
      }
    });
    const matches = findPublishedMatches(analysisResult.reviews, drafts, publishedRecords, notes);
    const { fresh, duplicates } = partitionDuplicates(items, matches);
    if (duplicates.length > 0) {
      setDuplicateWarning({ fresh, duplicates });
      return;
    }
    openPublishModal(fresh);
  };

  // Stage 2: Single Review Comment Publish Trigger
  const handlePublishSingleReview = (
    review: MRReviewItem,
    customComment?: string,
    customSuggestion?: string,
    index?: number
  ) => {
    // 單則發布與重試入口：有發布作業進行中時忽略
    if (isPublishingInProgress) return;
    void requestPublishReviews([
      {
        review,
        customComment,
        customSuggestion,
        index: index !== undefined ? index : 0,
      },
    ]);
  };

  // Stage 2: Batch Review Comments Publish Trigger
  const handlePublishBatchReviews = (items: PublishItem[]) => {
    void requestPublishReviews(items);
  };

  // Stage 2: Publish General Summary to MR Note Trigger
  const handlePublishSummaryToMr = () => {
    if (!gitlab.isConfigured(settings)) {
      setIsSettingsOpen(true);
      return;
    }

    setPublishModalConfig({
      isPublishingSummary: true,
      itemsToPublish: [],
    });
    setIsPublishModalOpen(true);
  };

  /** 發布成功：寫入本地發布紀錄並取消勾選 */
  const markPublished = (
    item: PublishItem,
    commentText: string,
    suggestionText: string,
    discussionId: string | number
  ) => {
    setPublishedRecords((prev) => [
      ...prev,
      createPublishedRecord(item.review, commentText, suggestionText, discussionId),
    ]);
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      next.delete(item.index);
      return next;
    });
  };

  // Stage 2: Confirm and Execute Publishing (Discussions API or Notes API)
  const handleConfirmPublish = async () => {
    let target: PublishTarget;
    try {
      target = gitlab.resolveTarget(currentGitLabMr?.web_url || gitlabMrUrl, settings);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : '無效的 GitLab MR 網址');
      setIsPublishModalOpen(false);
      return;
    }

    setIsPublishingInProgress(true);

    try {
      if (publishModalConfig.isPublishingSummary) {
        // Publish General Summary Note
        if (!analysisResult) return;

        // 4. 整體留言去重：送出「整體摘要」前，先讀取 MR notes
        const notes = await gitlab.fetchNotes(target);
        const { sharedNote, summaryNote } = findExistingOverallNote(notes);

        if (sharedNote) {
          // 若已存在分享報告留言（含 GITLAB_MR_REVIEWER_START 標記），就不再另外發整體摘要，改為提示使用者「分享報告已包含摘要」
          setInfoMessage('分享報告已包含摘要，無需重複發布整體留言。');
          setIsSummaryPublished(true);
          setIsPublishModalOpen(false);
          setIsPublishingInProgress(false);
          return;
        }

        const summaryBody = `${SUMMARY_TAG}
### 📋 MR 審查整體摘要

**標題**：${analysisResult.title}

#### 主要變更摘要
${analysisResult.summary.map((s) => `- ${s}`).join('\n')}

#### 意圖分組 (${analysisResult.groups.length} 組)
${analysisResult.groups.map((g) => `- **${g.name}** (+${g.additions} / -${g.deletions}): ${g.summary}`).join('\n')}

#### 建議測試清單
${analysisResult.testSuggestions.map((t) => `- [ ] ${t}`).join('\n')}

---
*由 GitLab MR 講解與審查工具自動發布*`;

        if (summaryNote) {
          await gitlab.updateNote(target, summaryNote.id, summaryBody);
        } else {
          await gitlab.createNote(target, summaryBody);
        }

        setIsSummaryPublished(true);
        setInfoMessage(withNotice('已發布整體摘要。', gitlab.notice));
      } else {
        // Publish Review Items via Discussions API
        // 使用產生目前結果時的 diff_refs，行號才會對到同一個版本
        const diffRefs = resultDiffRefs ?? currentGitLabMr?.diff_refs;

        const items = publishModalConfig.itemsToPublish;
        const byIndex = new Map(items.map((item) => [item.index, item]));
        const outcomes = await gitlab.publishBatch(
          target,
          items.map((item) => ({
            index: item.index,
            review: item.review,
            comment: item.customComment || item.review.comment,
            suggestion: item.customSuggestion || item.review.suggestion,
          })),
          diffRefs,
          {
            onStart: (index) => setPublishStates((prev) => ({ ...prev, [index]: { status: 'sending' } })),
            onDone: (outcome) => {
              if (outcome.ok) {
                const { result } = outcome;
                setPublishStates((prev) => ({
                  ...prev,
                  [outcome.index]: {
                    status: 'published',
                    discussionId: result.discussionId,
                    mode: result.mode,
                    fallbackReason: result.fallbackReason,
                    notice: result.notice,
                  },
                }));
                const item = byIndex.get(outcome.index);
                if (item) {
                  markPublished(
                    item,
                    item.customComment || item.review.comment,
                    item.customSuggestion || item.review.suggestion,
                    result.discussionId
                  );
                }
              } else {
                setPublishStates((prev) => ({
                  ...prev,
                  [outcome.index]: { status: 'error', errorMessage: outcome.error },
                }));
              }
            },
          }
        );
        const failed = outcomes.filter((o) => !o.ok).length;
        if (outcomes.length > 1 || failed > 0) {
          setInfoMessage(
            withNotice(
              failed > 0
                ? `已發布 ${outcomes.length - failed} 則，失敗 ${failed} 則；失敗的項目可在清單中按「重試」。`
                : `已發布 ${outcomes.length} 則審查意見。`,
              gitlab.notice
            )
          );
        }
      }
    } catch (generalErr: unknown) {
      setErrorMessage(
        generalErr instanceof Error ? generalErr.message : '發布至 GitLab 過程中發生錯誤'
      );
    } finally {
      setIsPublishingInProgress(false);
      setIsPublishModalOpen(false);
    }
  };

  // Stage 2: Mechanism 1 - Post complete analysis JSON back to MR note
  const handleShareAnalysisToMr = async () => {
    if (!analysisResult) return;
    let target: PublishTarget;
    try {
      target = gitlab.resolveTarget(currentGitLabMr?.web_url || gitlabMrUrl, settings);
    } catch {
      setErrorMessage('請先提供目標 GitLab MR 網址以發布共享報告');
      return;
    }

    if (!gitlab.isConfigured(settings)) {
      setIsSettingsOpen(true);
      return;
    }

    setIsSharingToMr(true);
    try {
      // 4. 整體留言去重：若使用者先發整體摘要、後發分享報告，分享報告改為更新既有的摘要留言，讓 MR 上只保留一則整體留言
      const notes = await gitlab.fetchNotes(target);
      const { sharedNote, summaryNote } = findExistingOverallNote(notes);
      const targetNoteId = sharedNote ? sharedNote.id : summaryNote ? summaryNote.id : null;

      await gitlab.shareAnalysis(target, analysisResult, targetNoteId);
      setIsSharedToMrPublished(true);
      setIsSummaryPublished(true);
      setInfoMessage(withNotice('已共享分析報告。', gitlab.notice));
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '分享報告至 MR 留言失敗');
    } finally {
      setIsSharingToMr(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 flex flex-col font-sans">
      {/* 1. Header */}
      <Header
        onOpenSettings={() => setIsSettingsOpen(true)}
        hasApiKey={providerReady}
        onOpenHistory={historyAvailable ? () => setIsHistoryOpen(true) : undefined}
        historyCount={historyAvailable ? historyRecords.length : undefined}
      />

      {/* 2. Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {services.banner}

        {historyAvailable === false && (
          <p className="mb-3 text-xs text-muted flex items-center gap-1.5">
            <DatabaseZap className="w-3.5 h-3.5 text-muted-light" />
            此瀏覽器無法保存歷史紀錄
          </p>
        )}

        {/* Info / Notice notification banner if any */}
        {infoMessage && (
          <div
            role="status"
            className="mb-4 p-4 bg-primary-subtle border border-primary-border rounded-xl text-ink text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in duration-150"
          >
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-ink">系統提示</p>
                <p className="mt-0.5 text-muted-dark">{infoMessage}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInfoMessage(null)}
              aria-label="關閉提示"
              className="text-primary hover:text-primary-hover font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {isSetupGuideOpen && (
          <SetupGuide
            notice={providerSetupNotice}
            onTryDemo={services.onTryDemo}
            onOpenSettings={openSettingsFromGuide}
            onClose={() => setIsSetupGuideOpen(false)}
          />
        )}

        {/* Error notification banner if any */}
        {errorMessage && (
          <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in duration-150">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-900">
                  {suggestFreeModel ? '額度不足，可改用免費模型' : '操作過程發生錯誤'}
                </p>
                <p className="mt-0.5">{errorMessage}</p>
                {suggestFreeModel && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleUseFreeModel}
                      className="px-2.5 py-1 rounded-md bg-surface border border-rose-300 text-rose-800 hover:bg-rose-100 font-semibold"
                    >
                      改用免費模型 {OPENROUTER_SUGGESTED_FREE_MODEL}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSettingsOpen(true)}
                      className="px-2.5 py-1 rounded-md text-rose-700 hover:underline"
                    >
                      到設定挑選其他免費模型
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-500 hover:text-rose-700 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Two-Column Responsive Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Diff Input & Controls (5 cols on lg) */}
          <div className="lg:col-span-5 h-auto lg:max-h-[calc(100vh-100px)] lg:sticky lg:top-20 lg:overflow-y-auto">
            <DiffInputPanel
              rawDiff={rawDiff}
              onDiffChange={setRawDiff}
              parsedDiff={parsedDiff}
              onAnalyze={handleAnalyze}
              onLoadSampleDiff={handleLoadSampleDiff}
              onLoadSampleAnalysis={handleLoadSampleAnalysis}
              isLoading={isLoading}
              setupNotice={providerSetupNotice}
              onOpenSettings={() => setIsSettingsOpen(true)}
              // Stage 2 GitLab props
              gitlabMrUrl={gitlabMrUrl}
              onGitlabMrUrlChange={setGitlabMrUrl}
              onFetchGitLabMr={handleFetchGitLabMr}
              isFetchingGitLab={isFetchingGitLab}
              currentGitLabMr={currentGitLabMr}
              sharedAnalysisAvailable={sharedAnalysisAvailable}
              onLoadSharedAnalysis={handleLoadSharedAnalysis}
              hasGitLabToken={gitlab.isConfigured(settings)}
              gitlabError={gitlabError}
              batchProgress={batchProgress}
              hasResult={!!analysisResult}
            />
          </div>

          {/* Right Column: Analysis Results (7 cols on lg) */}
          <div className="lg:col-span-7 space-y-4">
            {isLoading ? (
              /* Loading Skeleton Screen */
              <div className="bg-surface rounded-xl border border-surface-border p-6 shadow-xs space-y-6 animate-pulse">
                {/* Title and stats skeleton */}
                <div className="space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-1/4" />
                  <div className="h-6 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/3" />
                </div>
                {/* 3 Core Summaries skeleton */}
                <div className="space-y-2.5 pt-2">
                  <div className="h-4 bg-slate-200 rounded w-1/5" />
                  <div className="h-3 bg-slate-100 rounded w-full" />
                  <div className="h-3 bg-slate-100 rounded w-5/6" />
                  <div className="h-3 bg-slate-100 rounded w-4/5" />
                </div>
                {/* 2 Review Cards skeleton */}
                <div className="space-y-3 pt-2">
                  <div className="h-4 bg-slate-200 rounded w-1/5" />
                  <div className="p-4 border border-surface-border rounded-xl space-y-2 bg-surface-subtle/50">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-slate-200 rounded" />
                      <div className="h-4 bg-rose-100 rounded w-14" />
                      <div className="h-4 bg-slate-200 rounded w-28" />
                      <div className="h-4 bg-slate-200 rounded flex-1" />
                    </div>
                    <div className="h-12 bg-primary-subtle/40 rounded-lg" />
                  </div>
                  <div className="p-4 border border-surface-border rounded-xl space-y-2 bg-surface-subtle/50">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-slate-200 rounded" />
                      <div className="h-4 bg-amber-100 rounded w-14" />
                      <div className="h-4 bg-slate-200 rounded w-32" />
                      <div className="h-4 bg-slate-200 rounded flex-1" />
                    </div>
                    <div className="h-12 bg-primary-subtle/40 rounded-lg" />
                  </div>
                </div>
              </div>
            ) : analysisResult ? (
              <AnalysisResultView
                key={`${currentRecordId ?? 'unsaved'}-${analyzedAt ?? 0}`}
                result={analysisResult}
                diffFiles={resultDiffFiles}
                onOpenFileDiff={handleOpenFileDiff}
                // Stage 2 GitLab props
                onPublishSingleReview={handlePublishSingleReview}
                onPublishBatchReviews={handlePublishBatchReviews}
                publishStates={publishStates}
                isPublishing={isPublishingInProgress}
                isGitLabConfigured={gitlab.isConfigured(settings)}
                onPublishSummaryToMr={handlePublishSummaryToMr}
                onShareAnalysisToMr={handleShareAnalysisToMr}
                isSharingToMr={isSharingToMr}
                isSummaryPublished={isSummaryPublished}
                isSharedToMrPublished={isSharedToMrPublished}
                mrUrl={currentGitLabMr?.web_url || gitlabMrUrl}
                publishTargetLabel={gitlab.targetLabel}
                publishNotice={gitlab.notice}
                selectedIndices={selectedIndices}
                onSelectedIndicesChange={setSelectedIndices}
                draftEdits={draftEdits}
                onDraftEditsChange={setDraftEdits}
                publishedMatches={publishedMatches}
                analyzedAtLabel={
                  historyAvailable && analyzedAt ? formatHistoryTime(analyzedAt) : undefined
                }
                generatedByLabel={formatGeneratedBy(analysisResult)}
                hasNewCommit={historyAvailable === true && !!currentRecord && hasNewCommit(currentRecord)}
                onReanalyze={handleReanalyze}
              />
            ) : (
              <div className="bg-surface rounded-xl border border-surface-border p-6 sm:p-12 text-center shadow-xs space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary-subtle text-primary flex items-center justify-center mx-auto shadow-inner">
                  <Sparkles className="w-8 h-8" />
                </div>
                <div className="max-w-md mx-auto space-y-2">
                  <h3 className="text-base font-bold text-slate-800">
                    準備進行 MR 講解與結構審查
                  </h3>
                  <p className="text-xs text-muted leading-relaxed">{services.homeHint}</p>
                </div>
                <div className="pt-2 space-y-1.5">
                  <button
                    type="button"
                    onClick={services.onTryDemo}
                    className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-xs transition-colors"
                  >
                    <FlaskConical className="w-4 h-4" />
                    用範例試試看
                  </button>
                  <p className="text-[11px] text-muted-light">不需要金鑰，不會連到 AI 或 GitLab</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 3. Settings Modal */}
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        onClearKey={handleClearProviderKey}
      />

      {/* 4. Diff Viewer Modal */}
      {inspectingDiff && (
        <DiffViewerModal
          file={inspectingDiff.file}
          targetLine={inspectingDiff.line}
          onClose={() => setInspectingDiff(null)}
        />
      )}

      {/* 5. Stage 2 Publish Confirmation Modal */}
      <PublishConfirmationModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        onConfirm={handleConfirmPublish}
        mrInfo={currentGitLabMr}
        mrUrl={currentGitLabMr?.web_url || gitlabMrUrl}
        itemsToPublish={publishModalConfig.itemsToPublish}
        diffRefs={resultDiffRefs ?? currentGitLabMr?.diff_refs}
        isPublishingSummary={publishModalConfig.isPublishingSummary}
        summaryTitle={analysisResult?.title}
        targetLabel={gitlab.targetLabel}
        notice={gitlab.notice}
        isPublishing={isPublishingInProgress}
      />

      {/* 6. 重複發布警告（橘色）：預設 focus「取消」，按發布類按鈕才進入原本的發布確認 */}
      <ConfirmDialog
        open={!!duplicateWarning}
        cancelIsPrimary
        title={`有 ${duplicateWarning?.duplicates.length ?? 0} 則已發布過（依本地紀錄與 MR 現有留言比對）`}
        body={
          duplicateWarning && duplicateWarning.fresh.length > 0
            ? `可略過已發布的意見，只發布其餘 ${duplicateWarning.fresh.length} 則。重複發布會在 MR 上出現相同的留言。`
            : '重複發布會在 MR 上出現相同的留言。'
        }
        confirmLabel={
          duplicateWarning && duplicateWarning.fresh.length > 0
            ? `只發布未發布的 ${duplicateWarning.fresh.length} 則`
            : '仍要重複發布'
        }
        secondaryLabel={duplicateWarning && duplicateWarning.fresh.length > 0 ? '仍要全部發布' : undefined}
        onSecondary={() => {
          const items = duplicateWarning ? [...duplicateWarning.fresh, ...duplicateWarning.duplicates] : [];
          setDuplicateWarning(null);
          openPublishModal(items.sort((a, b) => a.index - b.index));
        }}
        onCancel={() => setDuplicateWarning(null)}
        onConfirm={() => {
          if (!duplicateWarning) return;
          const items = duplicateWarning.fresh.length > 0 ? duplicateWarning.fresh : duplicateWarning.duplicates;
          setDuplicateWarning(null);
          openPublishModal(items);
        }}
      />

      {/* 7. 歷史紀錄抽屜（IndexedDB 不可用時不顯示） */}
      {historyAvailable && (
        <HistoryDrawer
          open={isHistoryOpen}
          records={historyRecords}
          activeId={currentRecordId}
          onClose={() => setIsHistoryOpen(false)}
          onOpen={(id) => void handleOpenRecord(id)}
          onTogglePin={(id) => void handleTogglePin(id)}
          onDelete={(id) => void handleDeleteRecord(id)}
          onClearUnpinned={() => void handleClearUnpinned()}
        />
      )}
    </div>
  );
}
