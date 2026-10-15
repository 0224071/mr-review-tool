/**
 * 發布到 GitLab：重複發布比對與警告、發布確認視窗、逐則／整體摘要發布，以及分享分析報告。
 * 發布結果寫回 useAnalysis 持有的發布狀態與已發布紀錄（隨結果保存到歷史紀錄）。
 */
import { useMemo, useRef, useState } from 'react';
import { DraftEdits } from '../core/history-store';
import { createPublishedRecord, findPublishedMatches, partitionDuplicates } from '../core/publish-dedup';
import { MRAnalysisResult, MRReviewItem } from '../types/review';
import type { GitLabAuthor, GitLabNote } from '../types/gitlab';
import { findExistingOverallNote, SUMMARY_TAG } from '../services/gitlab-api';
import { PublishTarget } from '../services/review-publisher';
import { filterPublishableItems, resolveEffectiveComment, resolveEffectiveSuggestion } from '../core/review-text';
import { GitLabGateway, withNotice } from '../app/app-services';
import type { SettingsState } from './useSettings';
import type { AnalysisState } from './useAnalysis';

export type PublishItem = {
  review: MRReviewItem;
  customComment?: string;
  customSuggestion?: string;
  index: number;
};

/** 共享分析確認視窗的內容 */
export interface ShareConfirmState {
  target: PublishTarget;
  /** 要覆寫的留言；null 表示新增一則 */
  targetNoteId: number | null;
  /** 覆寫的是既有分享報告或整體摘要留言；null 表示新增 */
  overwrite: 'shared' | 'summary' | null;
  /** 被覆寫留言的作者（顯示名稱與 GitLab username） */
  overwriteAuthor?: GitLabAuthor;
  /** 被覆寫留言的發布時間（ISO 字串） */
  overwriteCreatedAt?: string;
  /** 被覆寫留言的網址（MR 網址 + #note_<id>） */
  overwriteNoteUrl?: string;
}

/** 共享分析的進度：讀取 MR 留言（GET，尚未寫入）或寫入分享留言 */
export type ShareStage = 'reading' | 'writing';

/** 發布前讀取 MR 留言失敗的是哪條發布路徑；按「重試」時依此從頭再跑一次 */
export type NotesReadRetry =
  | { kind: 'reviews'; items: PublishItem[] }
  | { kind: 'summary' }
  | { kind: 'share' };

interface NotesReadFailure {
  message: string;
  retry: NotesReadRetry;
  /** 失敗當時的 MR 與分析結果；切到別的 MR 或結果後不再顯示（重試對象已不同） */
  mrUrl: string;
  result: MRAnalysisResult | null;
}

/** 發布前讀不到 MR 留言時的錯誤訊息：沒有送出任何留言，只能重試（不提供略過重複檢查） */
export function buildNotesReadErrorMessage(err: unknown): string {
  const detail = err instanceof Error && err.message ? err.message : '讀取 MR 留言失敗';
  return `沒有送出任何留言：發布前讀取 MR 現有留言失敗（${detail}），無法確認是否會重複發布。請按「重試」重新讀取留言。`;
}

/** MR 上某則留言的網址：MR 網址（去掉既有的 #）+ #note_<id> */
export function buildNoteUrl(mrWebUrl: string, noteId: number): string {
  return `${mrWebUrl.split('#')[0]}#note_${noteId}`;
}

export interface UsePublishOptions {
  gitlab: GitLabGateway;
  settings: Pick<SettingsState, 'settings' | 'setIsSettingsOpen'>;
  analysis: Pick<
    AnalysisState,
    | 'analysisResult'
    | 'currentGitLabMr'
    | 'gitlabMrUrl'
    | 'resultDiffRefs'
    | 'remoteNotes'
    | 'setRemoteNotes'
    | 'draftEdits'
    | 'publishedRecords'
    | 'setPublishedRecords'
    | 'setSelectedIndices'
    | 'setPublishStates'
    | 'setIsSummaryPublished'
    | 'setIsSharedToMrPublished'
    | 'setErrorMessage'
    | 'setInfoMessage'
  >;
}

export function usePublish({ gitlab, settings: settingsState, analysis }: UsePublishOptions) {
  const { settings, setIsSettingsOpen } = settingsState;
  const {
    analysisResult,
    currentGitLabMr,
    gitlabMrUrl,
    resultDiffRefs,
    remoteNotes,
    setRemoteNotes,
    draftEdits,
    publishedRecords,
    setPublishedRecords,
    setSelectedIndices,
    setPublishStates,
    setIsSummaryPublished,
    setIsSharedToMrPublished,
    setErrorMessage,
    setInfoMessage,
  } = analysis;

  /** 共享分析進行中的階段；null 表示沒有進行中的作業 */
  const [shareStage, setShareStage] = useState<ShareStage | null>(null);
  const isSharingToMr = shareStage !== null;

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
  const [duplicateWarning, setDuplicateWarning] = useState<{ fresh: PublishItem[]; duplicates: PublishItem[] } | null>(null);
  /** 共享分析的確認視窗：開啟時已讀好留言並決定新增或覆寫哪一則；按確認前不送出任何寫入請求 */
  const [shareConfirm, setShareConfirm] = useState<ShareConfirmState | null>(null);
  /** 發布前讀取 MR 留言失敗（已中止，沒有送出任何留言） */
  const [notesReadFailure, setNotesReadFailure] = useState<NotesReadFailure | null>(null);
  /**
   * 發布作業（從讀留言開始到寫入結束）進行中的同步鎖：state 要等重新 render 才更新，
   * 同一輪連點兩次時靠這個擋下第二次，留言只讀一次。
   */
  const publishLockRef = useRef(false);
  /** 任何發布作業進行中（讀留言或寫入）：所有發布相關按鈕停用 */
  const isPublishBusy = isPublishingInProgress || isSharingToMr;

  // 發布時使用的 diff_refs：結果產生時的版本 → 目前 MR → 服務提供的備用版本（示範模式）
  const publishDiffRefs = resultDiffRefs ?? currentGitLabMr?.diff_refs ?? gitlab.fallbackDiffRefs;
  /** 發布目標 MR 網址：目前 MR 優先，否則用輸入框的網址 */
  const mrUrl = currentGitLabMr?.web_url || gitlabMrUrl;

  const failNotesRead = (err: unknown, retry: NotesReadRetry) =>
    setNotesReadFailure({ message: buildNotesReadErrorMessage(err), retry, mrUrl, result: analysisResult });
  /** 只顯示目前 MR 與結果的讀取失敗 */
  const notesReadError =
    notesReadFailure && notesReadFailure.mrUrl === mrUrl && notesReadFailure.result === analysisResult
      ? notesReadFailure.message
      : null;

  const publishedMatches = useMemo(() => {
    if (!analysisResult) return {};
    return findPublishedMatches(analysisResult.reviews, draftEdits, publishedRecords, remoteNotes);
  }, [analysisResult, draftEdits, publishedRecords, remoteNotes]);

  /** 要發布的意見內文：草稿優先，清空也不退回 AI 原值 */
  const publishCommentFor = (item: PublishItem) => resolveEffectiveComment(item.customComment, item.review.comment);

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
  const requestPublishReviews = async (requested: PublishItem[]) => {
    if (!gitlab.isConfigured(settings)) {
      setIsSettingsOpen(true);
      return;
    }
    if (!analysisResult || requested.length === 0 || publishLockRef.current) return;
    // 內文是空的意見不發布（「發布已選」、單則發布與重試共用此入口）
    const items = filterPublishableItems(requested);
    if (items.length < requested.length) {
      setInfoMessage(`已略過 ${requested.length - items.length} 則內文是空的意見，不會發布。`);
    }
    if (items.length === 0) return;

    let target: PublishTarget;
    try {
      target = gitlab.resolveTarget(mrUrl, settings);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : '無效的 GitLab MR 網址');
      return;
    }

    // 發布前一定要讀到 MR 現有留言才比對重複；讀不到就中止（不改用先前讀到的留言），從這裡開始算發布中
    publishLockRef.current = true;
    setIsPublishingInProgress(true);
    setNotesReadFailure(null);
    let notes: GitLabNote[];
    try {
      notes = await gitlab.fetchNotes(target);
    } catch (err: unknown) {
      failNotesRead(err, { kind: 'reviews', items: requested });
      return;
    } finally {
      publishLockRef.current = false;
      setIsPublishingInProgress(false);
    }
    setRemoteNotes(notes);

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
    if (isPublishBusy || publishLockRef.current) return;
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
    if (publishLockRef.current) return;

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
    if (publishLockRef.current) return;
    let target: PublishTarget;
    try {
      target = gitlab.resolveTarget(mrUrl, settings);
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : '無效的 GitLab MR 網址');
      setIsPublishModalOpen(false);
      return;
    }

    publishLockRef.current = true;
    setIsPublishingInProgress(true);
    setNotesReadFailure(null);

    try {
      if (publishModalConfig.isPublishingSummary) {
        // Publish General Summary Note
        if (!analysisResult) return;

        // 4. 整體留言去重：送出「整體摘要」前，先讀取 MR notes；讀不到就中止，不送出
        let notes: GitLabNote[];
        try {
          notes = await gitlab.fetchNotes(target);
        } catch (err: unknown) {
          failNotesRead(err, { kind: 'summary' });
          return;
        }
        const { sharedNote, summaryNote } = findExistingOverallNote(notes);

        if (sharedNote) {
          // 若已存在分享報告留言（含 GITLAB_MR_REVIEWER_START 標記），就不再另外發整體摘要，改為提示使用者「分享報告已包含摘要」
          setInfoMessage('分享報告已包含摘要，無需重複發布整體留言。');
          setIsSummaryPublished(true);
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

        const items = publishModalConfig.itemsToPublish;
        const byIndex = new Map(items.map((item) => [item.index, item]));
        const outcomes = await gitlab.publishBatch(
          target,
          items.map((item) => ({
            index: item.index,
            review: item.review,
            comment: publishCommentFor(item),
            suggestion: resolveEffectiveSuggestion(item.customSuggestion, item.review.suggestion),
          })),
          publishDiffRefs,
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
                    publishCommentFor(item),
                    resolveEffectiveSuggestion(item.customSuggestion, item.review.suggestion),
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
      publishLockRef.current = false;
      setIsPublishingInProgress(false);
      setIsPublishModalOpen(false);
    }
  };

  // Stage 2: Mechanism 1 - Post complete analysis JSON back to MR note
  /**
   * 「共享分析」第一步：只讀取 MR 留言（GET）判斷要新增或覆寫哪一則，再開確認視窗；
   * 使用者按確認（handleConfirmShareAnalysis）才寫入 GitLab。
   */
  const handleShareAnalysisToMr = async () => {
    if (!analysisResult || isPublishBusy || publishLockRef.current) return;
    let target: PublishTarget;
    try {
      target = gitlab.resolveTarget(mrUrl, settings);
    } catch {
      setErrorMessage('請先提供目標 GitLab MR 網址以發布共享報告');
      return;
    }

    if (!gitlab.isConfigured(settings)) {
      setIsSettingsOpen(true);
      return;
    }

    // 這段只用 GET 讀留言，按鈕顯示「讀取留言中」
    publishLockRef.current = true;
    setShareStage('reading');
    setNotesReadFailure(null);
    try {
      // 4. 整體留言去重：若使用者先發整體摘要、後發分享報告，分享報告改為更新既有的摘要留言，讓 MR 上只保留一則整體留言
      let notes: GitLabNote[];
      try {
        notes = await gitlab.fetchNotes(target);
      } catch (err: unknown) {
        // 讀不到留言就不知道該新增或覆寫哪一則：中止，不開確認視窗
        failNotesRead(err, { kind: 'share' });
        return;
      }
      const { sharedNote, summaryNote } = findExistingOverallNote(notes);
      const overwriteNote = sharedNote ?? summaryNote;
      setShareConfirm({
        target,
        targetNoteId: overwriteNote ? overwriteNote.id : null,
        overwrite: sharedNote ? 'shared' : summaryNote ? 'summary' : null,
        overwriteAuthor: overwriteNote
          ? { name: overwriteNote.author.name ?? '', username: overwriteNote.author.username ?? '' }
          : undefined,
        overwriteCreatedAt: overwriteNote?.created_at,
        overwriteNoteUrl: overwriteNote ? buildNoteUrl(mrUrl, overwriteNote.id) : undefined,
      });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '讀取 MR 留言失敗，未共享分析報告');
    } finally {
      publishLockRef.current = false;
      setShareStage(null);
    }
  };

  /** 確認視窗按「確認共享」：寫入（新增或覆寫）分享留言，標記中帶分析當時的 head sha */
  const handleConfirmShareAnalysis = async () => {
    if (!analysisResult || !shareConfirm || publishLockRef.current) return;
    publishLockRef.current = true;
    setShareStage('writing');
    try {
      await gitlab.shareAnalysis(
        shareConfirm.target,
        analysisResult,
        shareConfirm.targetNoteId,
        resultDiffRefs?.head_sha ?? null
      );
      setIsSharedToMrPublished(true);
      setIsSummaryPublished(true);
      setInfoMessage(withNotice('已共享分析報告。', gitlab.notice));
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '分享報告至 MR 留言失敗');
    } finally {
      publishLockRef.current = false;
      setShareStage(null);
      setShareConfirm(null);
    }
  };

  /** 確認視窗按「取消」：不送出任何請求 */
  const cancelShareAnalysis = () => {
    if (!isSharingToMr) setShareConfirm(null);
  };

  /** 重複發布警告的「仍要全部發布」：未發布與重複的一起依原順序送進發布確認 */
  const publishAllDespiteDuplicates = () => {
    const items = duplicateWarning ? [...duplicateWarning.fresh, ...duplicateWarning.duplicates] : [];
    setDuplicateWarning(null);
    openPublishModal(items.sort((a, b) => a.index - b.index));
  };

  /** 重複發布警告的主要按鈕：有未發布的只發未發布的，否則仍要重複發布 */
  const confirmDuplicateWarning = () => {
    if (!duplicateWarning) return;
    const items = duplicateWarning.fresh.length > 0 ? duplicateWarning.fresh : duplicateWarning.duplicates;
    setDuplicateWarning(null);
    openPublishModal(items);
  };

  const cancelDuplicateWarning = () => setDuplicateWarning(null);

  /** 讀留言失敗後按「重試」：重新讀留言並從頭跑該路徑的完整檢查（重複比對、確認視窗） */
  const retryNotesRead = () => {
    if (!notesReadError || !notesReadFailure || isPublishBusy || publishLockRef.current) return;
    const { retry } = notesReadFailure;
    setNotesReadFailure(null);
    if (retry.kind === 'reviews') void requestPublishReviews(retry.items);
    else if (retry.kind === 'summary') handlePublishSummaryToMr();
    else void handleShareAnalysisToMr();
  };

  const dismissNotesReadError = () => setNotesReadFailure(null);

  return {
    mrUrl,
    publishDiffRefs,
    publishedMatches,
    isPublishModalOpen,
    setIsPublishModalOpen,
    isPublishingInProgress,
    publishModalConfig,
    isSharingToMr,
    isPublishBusy,
    shareStage,
    notesReadError,
    retryNotesRead,
    dismissNotesReadError,
    shareConfirm,
    duplicateWarning,
    handlePublishSingleReview,
    handlePublishBatchReviews,
    handlePublishSummaryToMr,
    handleConfirmPublish,
    handleShareAnalysisToMr,
    handleConfirmShareAnalysis,
    cancelShareAnalysis,
    publishAllDespiteDuplicates,
    confirmDuplicateWarning,
    cancelDuplicateWarning,
  };
}

export type PublishState = ReturnType<typeof usePublish>;
