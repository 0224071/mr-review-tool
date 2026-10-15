import React, { useState, useMemo } from 'react';
import { Header } from './components/Header';
import { DiffInputPanel } from './components/DiffInputPanel';
import { AnalysisResultView } from './components/AnalysisResultView';
import { SettingsModal } from './components/SettingsModal';
import { DiffViewerModal } from './components/DiffViewerModal';
import { PublishConfirmationModal } from './components/PublishConfirmationModal';
import { enrichGroupsWithParsedDiff, parseGitDiff } from './core/diff-parser';
import { alignReviewsWithDiff } from './core/line-resolver';
import { analyzeGitDiffWithGemini } from './services/gemini-service';
import { SAMPLE_GIT_DIFF } from './services/diff-sources/sample-diffs';
import { SAMPLE_ANALYSIS_RESULT } from './services/diff-sources/sample-analysis';
import { AppSettings, DEFAULT_SETTINGS } from './types/settings';
import { MRAnalysisResult, MRReviewItem } from './types/review';
import { DiffFile } from './types/diff';
import {
  GitLabDiscussionPosition,
  GitLabMergeRequestInfo,
  ReviewPublishState,
} from './types/gitlab';
import {
  createGitLabDiscussion,
  createGitLabNote,
  fetchGitLabMergeRequest,
  fetchGitLabMrNotes,
  fetchGitLabMrRawDiff,
  findExistingOverallNote,
  findSharedAnalysisInNotes,
  parseGitLabMrUrl,
  postSharedAnalysisToMr,
  SUMMARY_TAG,
  updateGitLabNote,
} from './services/gitlab-api';
import { AlertCircle, Info, Sparkles } from 'lucide-react';

const SETTINGS_STORAGE_KEY = 'gitlab_mr_reviewer_settings';

export default function App() {
  // Load settings from localStorage
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  const [rawDiff, setRawDiff] = useState<string>('');
  const [analysisResult, setAnalysisResult] = useState<MRAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
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

  // Parse diff on the fly
  const parsedDiff = useMemo(() => {
    return parseGitDiff(rawDiff);
  }, [rawDiff]);

  // Persist settings
  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    } catch {
      // ignore
    }
  };

  const handleAnalyze = async () => {
    if (!settings.geminiApiKey) {
      setIsSettingsOpen(true);
      return;
    }

    setIsLoading(true);
    setBatchProgress(null);
    setErrorMessage(null);

    try {
      const result = await analyzeGitDiffWithGemini({
        rawDiff,
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        teamRules: settings.teamRules,
        onBatchProgress: (current, total) => {
          setBatchProgress({ current, total });
        },
      });
      setAnalysisResult(result);
      // Reset publishing states for new analysis
      setPublishStates({});
      setIsSummaryPublished(false);
      setIsSharedToMrPublished(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
      setBatchProgress(null);
    }
  };

  // Stage 2: Fetch MR and Notes from GitLab
  const handleFetchGitLabMr = async (url: string) => {
    setIsFetchingGitLab(true);
    setGitlabError(null);
    setSharedAnalysisAvailable(null);

    try {
      const { baseUrl, projectPath, mrIid } = parseGitLabMrUrl(
        url,
        settings.gitlabBaseUrl || 'https://gitlab.com'
      );

      // 1. Fetch MR info
      const mrInfo = await fetchGitLabMergeRequest(
        baseUrl,
        settings.gitlabToken,
        projectPath,
        mrIid
      );
      setCurrentGitLabMr(mrInfo);

      // 2. Fetch Raw Diff
      const fetchedDiff = await fetchGitLabMrRawDiff(
        baseUrl,
        settings.gitlabToken,
        projectPath,
        mrIid
      );
      setRawDiff(fetchedDiff);

      // 3. Check for previously shared analysis in notes
      try {
        const notes = await fetchGitLabMrNotes(baseUrl, settings.gitlabToken, projectPath, mrIid);
        const shared = findSharedAnalysisInNotes(notes);
        if (shared) {
          setSharedAnalysisAvailable(shared);
        }
      } catch {
        // notes checking failure does not block diff fetching
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGitlabError(msg);
    } finally {
      setIsFetchingGitLab(false);
    }
  };

  // Stage 2: Load shared analysis from MR note (Mechanism 1: Free of Gemini API key)
  const handleLoadSharedAnalysis = () => {
    if (sharedAnalysisAvailable) {
      const enrichedResult = {
        ...sharedAnalysisAvailable.result,
        groups: enrichGroupsWithParsedDiff(sharedAnalysisAvailable.result.groups, parsedDiff),
        reviews: alignReviewsWithDiff(sharedAnalysisAvailable.result.reviews || [], parsedDiff),
      };
      setAnalysisResult(enrichedResult);
      setSharedAnalysisAvailable(null);
      setErrorMessage(null);
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
  };

  const handleOpenFileDiff = (file: DiffFile, line?: number | null) => {
    setInspectingDiff({ file, line });
  };

  // Stage 2: Single Review Comment Publish Trigger
  const handlePublishSingleReview = (
    review: MRReviewItem,
    customComment?: string,
    customSuggestion?: string,
    index?: number
  ) => {
    if (!settings.gitlabToken) {
      setIsSettingsOpen(true);
      return;
    }

    setPublishModalConfig({
      isPublishingSummary: false,
      itemsToPublish: [
        {
          review,
          customComment,
          customSuggestion,
          index: index !== undefined ? index : 0,
        },
      ],
    });
    setIsPublishModalOpen(true);
  };

  // Stage 2: Batch Review Comments Publish Trigger
  const handlePublishBatchReviews = (
    items: Array<{
      review: MRReviewItem;
      customComment?: string;
      customSuggestion?: string;
      index: number;
    }>
  ) => {
    if (!settings.gitlabToken) {
      setIsSettingsOpen(true);
      return;
    }

    setPublishModalConfig({
      isPublishingSummary: false,
      itemsToPublish: items,
    });
    setIsPublishModalOpen(true);
  };

  // Stage 2: Publish General Summary to MR Note Trigger
  const handlePublishSummaryToMr = () => {
    if (!settings.gitlabToken) {
      setIsSettingsOpen(true);
      return;
    }

    setPublishModalConfig({
      isPublishingSummary: true,
      itemsToPublish: [],
    });
    setIsPublishModalOpen(true);
  };

  // Stage 2: Confirm and Execute Publishing (Discussions API or Notes API)
  const handleConfirmPublish = async () => {
    const targetMrUrl = currentGitLabMr?.web_url || gitlabMrUrl;
    if (!targetMrUrl) {
      setErrorMessage('請先輸入或指定目標 GitLab MR 網址');
      setIsPublishModalOpen(false);
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = parseGitLabMrUrl(targetMrUrl, settings.gitlabBaseUrl || 'https://gitlab.com');
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
        const notes = await fetchGitLabMrNotes(
          parsedUrl.baseUrl,
          settings.gitlabToken,
          parsedUrl.projectPath,
          parsedUrl.mrIid
        );
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
          await updateGitLabNote(
            parsedUrl.baseUrl,
            settings.gitlabToken,
            parsedUrl.projectPath,
            parsedUrl.mrIid,
            summaryNote.id,
            summaryBody
          );
        } else {
          await createGitLabNote(
            parsedUrl.baseUrl,
            settings.gitlabToken,
            parsedUrl.projectPath,
            parsedUrl.mrIid,
            summaryBody
          );
        }

        setIsSummaryPublished(true);
      } else {
        // Publish Review Items via Discussions API
        const diffRefs = currentGitLabMr?.diff_refs;

        for (const item of publishModalConfig.itemsToPublish) {
          // Update status to sending
          setPublishStates((prev) => ({
            ...prev,
            [item.index]: { status: 'sending' },
          }));

          const commentText = item.customComment || item.review.comment;
          const suggestionText = item.customSuggestion || item.review.suggestion;

          try {
            if (item.review.lineVerified === false) {
              // lineVerified === false 的意見不可帶 position，一律以 MR 一般留言發出，開頭加上「檔案:行號（行號未驗證）」
              const lineDisplay = item.review.line !== null ? item.review.line : '未知';
              const generalNoteBody = `${item.review.file}:${lineDisplay}（行號未驗證）\n\n**[${item.review.severity.toUpperCase()}] ${item.review.category.toUpperCase()}**: ${commentText}\n\n> 💡 **修改建議**：\n> ${suggestionText}\n\n*— 來自 GitLab MR 審查工具*`;

              const res = await createGitLabNote(
                parsedUrl.baseUrl,
                settings.gitlabToken,
                parsedUrl.projectPath,
                parsedUrl.mrIid,
                generalNoteBody
              );

              setPublishStates((prev) => ({
                ...prev,
                [item.index]: {
                  status: 'published',
                  discussionId: res.id,
                },
              }));
            } else {
              const discussionBody = `**[${item.review.severity.toUpperCase()}] ${item.review.category.toUpperCase()}**: ${commentText}\n\n> 💡 **修改建議**：\n> ${suggestionText}\n\n*— 來自 GitLab MR 審查工具*`;

              const payload: {
                body: string;
                position?: GitLabDiscussionPosition;
              } = {
                body: discussionBody,
              };

              // 送出 inline comment 時，position 依對齊結果帶入：
              // 新增行只帶 new_line；刪除行只帶 old_line；未變更行同時帶 new_line 與 old_line。
              if (diffRefs && (item.review.newLine != null || item.review.oldLine != null || item.review.line !== null)) {
                const pos: GitLabDiscussionPosition = {
                  base_sha: diffRefs.base_sha,
                  start_sha: diffRefs.start_sha,
                  head_sha: diffRefs.head_sha,
                  position_type: 'text',
                  new_path: item.review.file,
                  old_path: item.review.file,
                };

                if (item.review.newLine != null && item.review.oldLine != null) {
                  // 未變更行 (context)：同時帶 new_line 與 old_line
                  pos.new_line = item.review.newLine;
                  pos.old_line = item.review.oldLine;
                  payload.position = pos;
                } else if (item.review.newLine != null) {
                  // 新增行：只帶 new_line
                  pos.new_line = item.review.newLine;
                  payload.position = pos;
                } else if (item.review.oldLine != null) {
                  // 刪除行：只帶 old_line
                  pos.old_line = item.review.oldLine;
                  payload.position = pos;
                } else if (item.review.line !== null) {
                  // 退回使用 AI 給的 line
                  pos.new_line = item.review.line;
                  payload.position = pos;
                }
              }

              const res = await createGitLabDiscussion(
                parsedUrl.baseUrl,
                settings.gitlabToken,
                parsedUrl.projectPath,
                parsedUrl.mrIid,
                payload
              );

              setPublishStates((prev) => ({
                ...prev,
                [item.index]: {
                  status: 'published',
                  discussionId: res.id,
                },
              }));
            }
          } catch (itemErr: unknown) {
            const errDetail = itemErr instanceof Error ? itemErr.message : String(itemErr);
            setPublishStates((prev) => ({
              ...prev,
              [item.index]: {
                status: 'error',
                errorMessage: errDetail,
              },
            }));
          }
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
    const targetMrUrl = currentGitLabMr?.web_url || gitlabMrUrl;
    if (!targetMrUrl) {
      setErrorMessage('請先提供目標 GitLab MR 網址以發布共享報告');
      return;
    }

    if (!settings.gitlabToken) {
      setIsSettingsOpen(true);
      return;
    }

    setIsSharingToMr(true);
    try {
      const parsedUrl = parseGitLabMrUrl(
        targetMrUrl,
        settings.gitlabBaseUrl || 'https://gitlab.com'
      );

      // 4. 整體留言去重：若使用者先發整體摘要、後發分享報告，分享報告改為更新既有的摘要留言，讓 MR 上只保留一則整體留言
      const notes = await fetchGitLabMrNotes(
        parsedUrl.baseUrl,
        settings.gitlabToken,
        parsedUrl.projectPath,
        parsedUrl.mrIid
      );
      const { sharedNote, summaryNote } = findExistingOverallNote(notes);
      const targetNoteId = sharedNote ? sharedNote.id : summaryNote ? summaryNote.id : null;

      await postSharedAnalysisToMr(
        parsedUrl.baseUrl,
        settings.gitlabToken,
        parsedUrl.projectPath,
        parsedUrl.mrIid,
        analysisResult,
        targetNoteId
      );
      setIsSharedToMrPublished(true);
      setIsSummaryPublished(true);
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
        hasApiKey={!!settings.geminiApiKey}
      />

      {/* 2. Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* Info / Notice notification banner if any */}
        {infoMessage && (
          <div className="mb-4 p-4 bg-sky-50 border border-sky-200 rounded-xl text-sky-900 text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in duration-150">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sky-950">系統提示</p>
                <p className="mt-0.5 text-sky-800">{infoMessage}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInfoMessage(null)}
              className="text-sky-500 hover:text-sky-700 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error notification banner if any */}
        {errorMessage && (
          <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in duration-150">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-900">操作過程發生錯誤</p>
                <p className="mt-0.5">{errorMessage}</p>
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
          <div className="lg:col-span-5 h-auto max-h-[calc(100vh-100px)] sticky top-20 overflow-y-auto">
            <DiffInputPanel
              rawDiff={rawDiff}
              onDiffChange={setRawDiff}
              parsedDiff={parsedDiff}
              onAnalyze={handleAnalyze}
              onLoadSampleDiff={handleLoadSampleDiff}
              onLoadSampleAnalysis={handleLoadSampleAnalysis}
              isLoading={isLoading}
              hasApiKey={!!settings.geminiApiKey}
              onOpenSettings={() => setIsSettingsOpen(true)}
              // Stage 2 GitLab props
              gitlabMrUrl={gitlabMrUrl}
              onGitlabMrUrlChange={setGitlabMrUrl}
              onFetchGitLabMr={handleFetchGitLabMr}
              isFetchingGitLab={isFetchingGitLab}
              currentGitLabMr={currentGitLabMr}
              sharedAnalysisAvailable={sharedAnalysisAvailable}
              onLoadSharedAnalysis={handleLoadSharedAnalysis}
              hasGitLabToken={!!settings.gitlabToken}
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
                result={analysisResult}
                diffFiles={parsedDiff.files}
                onOpenFileDiff={handleOpenFileDiff}
                // Stage 2 GitLab props
                onPublishSingleReview={handlePublishSingleReview}
                onPublishBatchReviews={handlePublishBatchReviews}
                publishStates={publishStates}
                isGitLabConfigured={!!settings.gitlabToken}
                onPublishSummaryToMr={handlePublishSummaryToMr}
                onShareAnalysisToMr={handleShareAnalysisToMr}
                isSharingToMr={isSharingToMr}
                isSummaryPublished={isSummaryPublished}
                isSharedToMrPublished={isSharedToMrPublished}
                mrUrl={currentGitLabMr?.web_url || gitlabMrUrl}
              />
            ) : (
              <div className="bg-surface rounded-xl border border-surface-border p-12 text-center shadow-xs space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary-subtle text-primary flex items-center justify-center mx-auto shadow-inner">
                  <Sparkles className="w-8 h-8" />
                </div>
                <div className="max-w-md mx-auto space-y-2">
                  <h3 className="text-base font-bold text-slate-800">
                    準備進行 MR 講解與結構審查
                  </h3>
                  <p className="text-xs text-muted leading-relaxed">
                    在左側輸入 GitLab MR 網址抓取，或貼上 git diff；點擊「分析」開始。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 3. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
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
        isPublishingSummary={publishModalConfig.isPublishingSummary}
        summaryTitle={analysisResult?.title}
        isPublishing={isPublishingInProgress}
      />
    </div>
  );
}
