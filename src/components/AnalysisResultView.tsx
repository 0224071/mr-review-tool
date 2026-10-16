import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  FileText,
  Network,
  Download,
  Share2,
  FileCode,
  Sparkles,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  AlertTriangle,
  Send,
  Users,
  ExternalLink,
  GitCommitHorizontal,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { DiffFile } from '../types/diff';
import { MRAnalysisResult, MRReviewItem } from '../types/review';
import { ReviewPublishState } from '../types/gitlab';
import { generateOfflineHtmlReport } from '../utils/export-offline';
import { GroupFilterBar } from './GroupFilterBar';
import { MROverviewCard } from './MROverviewCard';
import { ReviewCommentsList } from './ReviewCommentsList';
import { StructuralGraphView } from './StructuralGraphView';
import { ChecklistCoverageBanner } from './ChecklistCoverageBanner';
import { DraftEdits } from '../core/history-store';
import { filterPublishableItems } from '../core/review-text';
import { PublishedMatch } from '../core/publish-dedup';
import { DisabledReasonText, TapForReason, useDisabledReason } from './DisabledReason';

/** 按鈕內的小 spinner（讀取留言中…），顏色由呼叫端指定 */
const Spinner: React.FC<{ className: string }> = ({ className }) => (
  <span aria-hidden="true" className={`inline-block w-3.5 h-3.5 border-2 rounded-full animate-spin shrink-0 ${className}`} />
);

/** 手機點到停用的「發布已選 0 則」時顯示的原因 */
export const PUBLISH_NONE_SELECTED_REASON = '還沒有勾選意見：先在清單勾選要發布的意見';

interface AnalysisResultViewProps {
  result: MRAnalysisResult;
  diffFiles?: DiffFile[];
  onOpenFileDiff?: (file: DiffFile, line?: number | null) => void;

  // Stage 2 GitLab actions
  onPublishSingleReview?: (
    review: MRReviewItem,
    customComment?: string,
    customSuggestion?: string,
    index?: number
  ) => void;
  onPublishBatchReviews?: (
    items: Array<{
      review: MRReviewItem;
      customComment?: string;
      customSuggestion?: string;
      index: number;
    }>,
    /** 「發布已選」或「重試失敗 N 則」：讀留言失敗後重試時依此重新組出目前要發布的意見 */
    source?: 'selected' | 'failed'
  ) => void;
  publishStates?: Record<number, ReviewPublishState>;
  /** 發布作業進行中（含發布前讀留言、共享分析）：停用所有發布相關按鈕，避免重複送出 */
  isPublishing?: boolean;
  isGitLabConfigured?: boolean;
  onPublishSummaryToMr?: () => void;
  onShareAnalysisToMr?: () => void;
  isSharingToMr?: boolean;
  /** 共享分析前正在用 GET 讀取 MR 留言（尚未寫入）：發布按鈕顯示「讀取留言中」 */
  isReadingShareNotes?: boolean;
  /** 「發布已選」前正在讀取 MR 留言：「發布已選」顯示「讀取留言中…」 */
  isReadingPublishNotes?: boolean;
  /** 「重試失敗 N 則」前正在讀取 MR 留言：該按鈕顯示「讀取留言中…」 */
  isReadingRetryFailedNotes?: boolean;
  /** 單則發布前正在讀取 MR 留言（「發布已選」不顯示讀取中，spinner 在該則的單則按鈕上） */
  isReadingSingleNotes?: boolean;
  /** 正在進行單則發布的意見位置：該則的單則按鈕顯示 spinner */
  singlePublishingIndex?: number | null;
  /** 發布前讀取 MR 留言失敗的原因（已中止、沒有送出任何留言）；顯示在發布列上方並提供重試 */
  notesReadError?: string | null;
  /** 讀取失敗的動作名稱（例如「共享分析」），顯示成「共享分析：已中止發布」 */
  notesReadAction?: string | null;
  onRetryNotesRead?: () => void;
  onDismissNotesReadError?: () => void;
  isSummaryPublished?: boolean;
  isSharedToMrPublished?: boolean;
  mrUrl?: string;
  /** 沒有 MR 網址時仍可發布的目標名稱（示範模式） */
  publishTargetLabel?: string;
  /** 發布狀態旁的標註（示範模式：「示範，未實際發布」） */
  publishNotice?: string;

  // 勾選與編輯狀態由 App 管理（存入歷史紀錄）
  selectedIndices: Set<number>;
  onSelectedIndicesChange: (next: Set<number>) => void;
  draftEdits: DraftEdits;
  onDraftEditsChange: (next: DraftEdits) => void;

  // 快取與歷史紀錄
  publishedMatches?: Record<number, PublishedMatch>;
  analyzedAtLabel?: string;
  /** 產生結果的 provider / model 標記 */
  generatedByLabel?: string;
  hasNewCommit?: boolean;
  onReanalyze?: () => void;
}

export const AnalysisResultView: React.FC<AnalysisResultViewProps> = ({
  result,
  diffFiles = [],
  onOpenFileDiff,
  onPublishSingleReview,
  onPublishBatchReviews,
  publishStates = {},
  isPublishing = false,
  isGitLabConfigured = false,
  onPublishSummaryToMr,
  onShareAnalysisToMr,
  isSharingToMr = false,
  isReadingShareNotes = false,
  isReadingPublishNotes = false,
  isReadingRetryFailedNotes = false,
  isReadingSingleNotes = false,
  singlePublishingIndex = null,
  notesReadError = null,
  notesReadAction = null,
  onRetryNotesRead,
  onDismissNotesReadError,
  isSummaryPublished = false,
  isSharedToMrPublished = false,
  mrUrl = '',
  publishTargetLabel,
  publishNotice,
  selectedIndices,
  onSelectedIndicesChange: setSelectedIndices,
  draftEdits,
  onDraftEditsChange: setDraftEdits,
  publishedMatches = {},
  analyzedAtLabel,
  generatedByLabel,
  hasNewCommit = false,
  onReanalyze,
}) => {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'review' | 'graph' | 'files'>('review');

  // File tab collapse state: default all collapsed
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFileExpanded = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const allFilePaths = useMemo(() => {
    return diffFiles.map((df) => df.newPath || df.oldPath).filter(Boolean);
  }, [diffFiles]);

  const isAllFilesExpanded =
    allFilePaths.length > 0 && expandedFiles.size === allFilePaths.length;

  const toggleExpandAllFiles = () => {
    if (isAllFilesExpanded) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(allFilePaths));
    }
  };

  // Dropdown menus states
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isPublishMenuOpen, setIsPublishMenuOpen] = useState(false);
  const [isStickyMoreOpen, setIsStickyMoreOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const exportMenuRef = useRef<HTMLDivElement>(null);
  const publishMenuRef = useRef<HTMLDivElement>(null);
  const stickyMoreRef = useRef<HTMLDivElement>(null);
  const publishBarRef = useRef<HTMLDivElement>(null);
  // 手機點到停用的「發布已選 0 則」時，在發布列上方說明原因
  const [publishBarHint, showPublishBarHint] = useDisabledReason<'bar'>();

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (publishMenuRef.current && !publishMenuRef.current.contains(e.target as Node)) {
        setIsPublishMenuOpen(false);
      }
      if (stickyMoreRef.current && !stickyMoreRef.current.contains(e.target as Node)) {
        setIsStickyMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Review counts per group
  const reviewCountsByGroup = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of result.reviews) {
      counts[r.groupId] = (counts[r.groupId] || 0) + 1;
    }
    return counts;
  }, [result.reviews]);

  // Diff files map
  const diffFileMap = useMemo(() => {
    const map = new Map<string, DiffFile>();
    for (const df of diffFiles) {
      map.set(df.newPath, df);
      map.set(df.oldPath, df);
    }
    return map;
  }, [diffFiles]);

  const handleSelectFile = (filePath: string, line?: number | null) => {
    const df = diffFileMap.get(filePath);
    if (df && onOpenFileDiff) {
      onOpenFileDiff(df, line);
    }
  };

  // Export handlers
  const handleCopyAnalysisJson = () => {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopyFeedback('已複製分析 JSON');
    setIsExportMenuOpen(false);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const handleCopyFullResult = () => {
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopyFeedback('已複製完整回傳結果');
    setIsExportMenuOpen(false);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const handleCopyMarkdown = () => {
    const fullMarkdown = `# ${result.title}\n\n${result.description}\n\n## 測試驗證建議\n${result.testSuggestions
      .map((t) => `- [ ] ${t}`)
      .join('\n')}`;
    navigator.clipboard.writeText(fullMarkdown);
    setCopyFeedback('已複製 MR 描述 Markdown');
    setIsExportMenuOpen(false);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const handleDownloadJson = () => {
    const jsonStr = JSON.stringify(result, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mr-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  };

  const handleDownloadHtml = () => {
    const html = generateOfflineHtmlReport(result);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mr-review-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  };

  // 「發布已選 N 則」：N 與發布時 filterPublishableItems 過濾後實際送出的則數一致
  const publishableSelectedItems = filterPublishableItems(
    Array.from(selectedIndices)
      .filter((idx) => result.reviews[idx])
      .map((idx) => ({
        review: result.reviews[idx],
        customComment: draftEdits[idx]?.comment,
        customSuggestion: draftEdits[idx]?.suggestion,
        index: idx,
      }))
  );
  const publishableSelectedCount = publishableSelectedItems.length;

  // Batch publish trigger
  const handlePublishSelectedBatch = () => {
    if (!onPublishBatchReviews || publishableSelectedCount === 0) return;
    onPublishBatchReviews(publishableSelectedItems, 'selected');
  };

  // 上次發布失敗的項目，一次重試
  const failedIndices = Object.entries(publishStates)
    .filter(([, state]) => state.status === 'error')
    .map(([idx]) => Number(idx))
    .filter((idx) => result.reviews[idx]);
  const handleRetryFailed = () => {
    if (!onPublishBatchReviews || failedIndices.length === 0) return;
    onPublishBatchReviews(
      failedIndices.map((idx) => ({
        review: result.reviews[idx],
        customComment: draftEdits[idx]?.comment,
        customSuggestion: draftEdits[idx]?.suggestion,
        index: idx,
      })),
      'failed'
    );
  };

  // Parse MR IID if connected
  const hasGitLabMr = Boolean((mrUrl && mrUrl.trim()) || publishTargetLabel);
  const mrMatch = mrUrl ? mrUrl.match(/merge_requests\/(\d+)/) : null;
  const mrIid = mrMatch ? mrMatch[1] : '';

  // 浮動發布列會疊在內容上：把它佔的高度加上 sticky 的 bottom 間距寫進 --publish-bar-space，
  // 讓頁面捲動（scroll-padding）與意見清單底部留白都避開它，最後一則也能完整捲出來
  useEffect(() => {
    const bar = publishBarRef.current;
    const root = document.documentElement;
    if (!bar) return;
    const update = () => {
      // bottom 由樣式決定（目前為 bottom-4），讀實際值而不寫死；讀不到（如 auto）時當作 0
      const bottom = parseFloat(getComputedStyle(bar).bottom) || 0;
      root.style.setProperty('--publish-bar-space', `${bar.offsetHeight + bottom}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--publish-bar-space');
    };
  }, [hasGitLabMr]);

  // 7. Checklist coverage banner: ONLY render when ?debug is in URL
  const isDebugMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('debug');
  }, []);

  /** 讀取留言中／發布中的狀態，給螢幕報讀器（aria-live）；按鈕上的文字與 spinner 是給看得到的人 */
  const isReadingAnyNotes =
    isReadingShareNotes || isReadingPublishNotes || isReadingRetryFailedNotes || isReadingSingleNotes;
  const publishStatusText = isReadingAnyNotes ? '正在讀取 MR 留言，尚未送出任何留言…' : isPublishing ? '發布中…' : '';

  return (
    <div className="space-y-4 pb-6">
      {/* 新 commit 提示列：快取結果的 head SHA 與 MR 目前不同 */}
      {hasNewCommit && (
        <div
          role="status"
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 px-4 py-2.5 rounded-xl border border-warning-border bg-warning-subtle text-xs text-warning-text"
        >
          {/* 手機：按鈕在文字下方獨立一列、全寬；sm 以上與文字同列靠右。只渲染一顆按鈕（比照過期共享報告卡片） */}
          <span className="flex items-center gap-2 min-w-0">
            <GitCommitHorizontal className="w-4 h-4 text-warning shrink-0" />
            此 MR 在分析後有新的 commit，目前顯示的是舊結果
          </span>
          {onReanalyze && (
            <button
              type="button"
              onClick={onReanalyze}
              className="shrink-0 inline-flex items-center justify-center gap-1 w-full sm:w-auto px-2.5 py-1 rounded-lg border border-warning-border bg-surface font-semibold text-warning-text hover:bg-warning-hover"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              抓最新內容重新分析
            </button>
          )}
        </div>
      )}

      {/* 1. Checklist Coverage Banner at the very top (debug mode only) */}
      {isDebugMode && (
        <ChecklistCoverageBanner
          checklistCoverage={result.checklistCoverage}
          reviews={result.reviews}
          onSelectFile={(filePath) => handleSelectFile(filePath)}
        />
      )}

      {/* 2. Top Overview Card: MR title, 3 core summaries, stats, accordions */}
      <MROverviewCard
        result={result}
        hasGitLabMr={hasGitLabMr}
        analyzedAtLabel={analyzedAtLabel}
        generatedByLabel={generatedByLabel}
      />

      {/* 3. Navigation Tabs and Unified Export & Publish Dropdowns */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-border pb-2 pt-1">
        {/* Tabs: 審查 (Review), 結構圖 (Graph), 檔案 (Files) */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('review')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'review'
                ? 'bg-surface text-primary shadow-xs font-semibold'
                : 'text-muted-dark hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>審查</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('graph')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'graph'
                ? 'bg-surface text-primary shadow-xs font-semibold'
                : 'text-muted-dark hover:text-slate-900'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>結構圖 (Dagre)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
              activeTab === 'files'
                ? 'bg-surface text-primary shadow-xs font-semibold'
                : 'text-muted-dark hover:text-slate-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>檔案</span>
          </button>
        </div>

        {/* Action Menus: 發布至 MR ▾ and 匯出 ▾ */}
        <div className="flex items-center gap-2 text-xs">
          {copyFeedback && (
            <span className="text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-1 rounded text-[11px] animate-in fade-in">
              {copyFeedback}
            </span>
          )}

          {/* 發布至 MR ▾ Dropdown (Secondary style) */}
          <div className="relative" ref={publishMenuRef}>
            <button
              type="button"
              onClick={() => setIsPublishMenuOpen(!isPublishMenuOpen)}
              disabled={isPublishing}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg font-medium transition-colors shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isReadingShareNotes ? (
                <>
                  <Spinner className="border-slate-300 border-t-gitlab" />
                  <span>讀取留言中…</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 text-gitlab" />
                  <span>發布至 MR ▾</span>
                </>
              )}
            </button>

            {isPublishMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-surface border border-surface-border rounded-xl shadow-lg p-1.5 z-30 space-y-1 text-xs">
                {/* Option 1: Publish Summary */}
                <button
                  type="button"
                  onClick={() => {
                    if (onPublishSummaryToMr) onPublishSummaryToMr();
                    setIsPublishMenuOpen(false);
                  }}
                  disabled={isSummaryPublished || isPublishing}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  <div className="font-semibold text-slate-800 flex items-center justify-between">
                    <span>發布摘要至 MR</span>
                    {isSummaryPublished && (
                      <span className="text-[10px] text-emerald-600 font-bold">
                        {publishNotice ? `已發布（${publishNotice}）` : '已發布'}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted mt-0.5 leading-snug">
                    將整體標題、變更摘要與測試建議發布至 MR 討論區
                  </p>
                </button>

                {/* Option 2: Share Analysis */}
                <button
                  type="button"
                  onClick={() => {
                    if (onShareAnalysisToMr) onShareAnalysisToMr();
                    setIsPublishMenuOpen(false);
                  }}
                  disabled={isSharingToMr || isPublishing || isSharedToMrPublished}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 border-t border-slate-100"
                >
                  <div className="font-semibold text-slate-800 flex items-center justify-between">
                    <span>{isReadingShareNotes ? '讀取留言中…' : '共享分析（免 Key 共享）'}</span>
                    {isSharedToMrPublished && (
                      <span className="text-[10px] text-emerald-600 font-bold">
                        {publishNotice ? `已共享（${publishNotice}）` : '已共享'}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted mt-0.5 leading-snug">
                    以隱藏標記留言至 MR，團隊成員開啟同一 MR 即可直接載入
                  </p>
                </button>
              </div>
            )}
          </div>

          {/* 匯出 ▾ Dropdown (Secondary style) */}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg font-medium transition-colors shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>匯出 ▾</span>
            </button>

            {isExportMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-surface border border-surface-border rounded-xl shadow-lg p-1.5 z-30 space-y-0.5 text-xs">
                <button
                  type="button"
                  onClick={handleCopyAnalysisJson}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-2"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>複製分析 JSON</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyFullResult}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-2"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>複製完整回傳結果</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-2"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span>複製 MR 描述 Markdown</span>
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-2"
                >
                  <Share2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>匯出 JSON</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadHtml}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 text-slate-700 flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  <span>匯出 HTML</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Tab Contents */}
      {/* Tab: Review (Includes GroupFilterBar and ReviewCommentsList) */}
      {activeTab === 'review' && (
        <div className="space-y-3">
          {/* Group Filter Bar inside Review Tab */}
          <GroupFilterBar
            groups={result.groups}
            selectedGroupId={selectedGroupId}
            onSelectGroup={setSelectedGroupId}
            reviewCountsByGroup={reviewCountsByGroup}
          />

          <ReviewCommentsList
            reviews={result.reviews}
            groups={result.groups}
            selectedGroupId={selectedGroupId}
            onSelectFile={handleSelectFile}
            fullResult={result}
            diffFiles={diffFiles}
            onPublishSingle={onPublishSingleReview}
            publishStates={publishStates}
            isPublishing={isPublishing}
            singlePublishingIndex={singlePublishingIndex}
            publishedMatches={publishedMatches}
            isGitLabConfigured={isGitLabConfigured}
            selectedIndices={selectedIndices}
            onSelectIndicesChange={setSelectedIndices}
            draftEdits={draftEdits}
            onDraftEditsChange={setDraftEdits}
          />
        </div>
      )}

      {/* Tab: Structural Graph (No duplicate review list; clicking node switches to Review tab) */}
      {activeTab === 'graph' && (
        <div className="space-y-3">
          <StructuralGraphView
            graph={result.graph}
            groups={result.groups}
            selectedGroupId={selectedGroupId}
            onSelectGroup={(groupId) => {
              setSelectedGroupId(groupId);
              setActiveTab('review');
            }}
          />
        </div>
      )}

      {/* Tab: Files Change List (Per-file collapsible diff blocks) */}
      {activeTab === 'files' && (
        <div className="bg-surface rounded-xl border border-surface-border overflow-hidden shadow-xs text-xs">
          {/* Top Bar with All Expand / All Collapse Toggle */}
          <div className="p-3 bg-surface-subtle border-b border-surface-border flex items-center justify-between font-semibold text-slate-700">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-slate-500" />
              <span>變更檔案清單 ({diffFiles.length} 個檔案)</span>
            </div>
            <button
              type="button"
              onClick={toggleExpandAllFiles}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 bg-surface border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              title={isAllFilesExpanded ? '全部收合' : '全部展開'}
            >
              <ChevronsUpDown className="w-3.5 h-3.5 text-slate-500" />
              <span>{isAllFilesExpanded ? '全部收合' : '全部展開'}</span>
            </button>
          </div>

          {/* Files List: Collapsible per file */}
          <div className="divide-y divide-surface-border">
            {diffFiles.length === 0 ? (
              <div className="p-8 text-center text-muted">無變更檔案資料</div>
            ) : (
              diffFiles.map((df) => {
                const filePath = df.newPath || df.oldPath;
                const isExpanded = expandedFiles.has(filePath);
                const fileReviews = result.reviews.filter(
                  (r) => r.file === df.newPath || r.file === df.oldPath
                );

                return (
                  <div key={filePath} className="overflow-hidden">
                    {/* Collapsible File Header Bar */}
                    <div className="p-3 bg-surface hover:bg-slate-50 transition-colors flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => toggleFileExpanded(filePath)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <FileCode className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="font-mono font-semibold text-slate-800 text-xs truncate">
                          {filePath}
                        </span>
                        <div className="font-mono text-[11px] flex items-center gap-1.5 shrink-0 ml-1">
                          <span className="text-emerald-600 font-semibold">+{df.additions}</span>
                          <span className="text-rose-600 font-semibold">-{df.deletions}</span>
                        </div>
                        {fileReviews.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 shrink-0 ml-2">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                            <span>{fileReviews.length} 則意見</span>
                          </span>
                        )}
                      </button>

                      {/* Secondary button: '查看完整檔案' (DiffViewerModal) */}
                      {onOpenFileDiff && (
                        <button
                          type="button"
                          onClick={() => onOpenFileDiff(df)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 transition-colors shrink-0 cursor-pointer"
                          title="在彈出視窗中檢視完整檔案 Diff"
                        >
                          <span>查看完整檔案</span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </button>
                      )}
                    </div>

                    {/* Inline Diff Content When Expanded */}
                    {isExpanded && (
                      <div className="bg-slate-900 font-mono text-xs p-3 overflow-x-auto divide-y divide-slate-800 border-t border-slate-700/60">
                        {df.hunks.length === 0 ? (
                          <div className="p-4 text-center text-slate-500 text-[11px]">
                            此檔案無文字變更內容
                          </div>
                        ) : (
                          df.hunks.map((hunk, hIdx) => (
                            <div key={hIdx} className="py-2">
                              <div className="text-slate-500 text-[11px] py-0.5 select-none font-semibold">
                                {hunk.header}
                              </div>
                              <div className="space-y-0.5 mt-1">
                                {hunk.lines.map((line, lIdx) => {
                                  const lineReview = fileReviews.find(
                                    (r) =>
                                      (r.newLine != null && r.newLine === line.newLineNumber) ||
                                      (r.oldLine != null && r.oldLine === line.oldLineNumber) ||
                                      (r.line != null &&
                                        (r.line === line.newLineNumber ||
                                          r.line === line.oldLineNumber))
                                  );

                                  let lineBg = 'hover:bg-slate-800/60';
                                  let lineText = 'text-slate-300';
                                  let sign = ' ';

                                  if (line.type === 'add') {
                                    lineBg = 'bg-emerald-950/40 text-emerald-300';
                                    sign = '+';
                                  } else if (line.type === 'delete') {
                                    lineBg = 'bg-rose-950/40 text-rose-300';
                                    sign = '-';
                                  }

                                  if (lineReview) {
                                    lineBg =
                                      'bg-amber-950/80 text-amber-200 ring-1 ring-amber-400 font-semibold';
                                  }

                                  return (
                                    <div
                                      key={lIdx}
                                      className={`flex items-start px-2 py-0.5 rounded-xs transition-colors ${lineBg} ${lineText}`}
                                    >
                                      {/* Review marker badge: clicking switches to review tab */}
                                      <div className="w-5 shrink-0 flex items-center justify-center">
                                        {lineReview && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveTab('review');
                                            }}
                                            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-slate-950 font-bold text-[9px] hover:bg-amber-300 hover:scale-110 transition-transform cursor-pointer"
                                            title={`點選切換至審查意見：[${lineReview.severity}] ${lineReview.comment}`}
                                          >
                                            !
                                          </button>
                                        )}
                                      </div>

                                      <span className="w-9 shrink-0 text-slate-500 text-right pr-2 select-none text-[10px]">
                                        {line.oldLineNumber || ''}
                                      </span>
                                      <span className="w-9 shrink-0 text-slate-500 text-right pr-2 select-none text-[10px]">
                                        {line.newLineNumber || ''}
                                      </span>
                                      <span className="w-4 shrink-0 text-center select-none opacity-60">
                                        {sign}
                                      </span>
                                      <span className="flex-1 whitespace-pre-wrap break-all">
                                        {line.content}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 5. Sticky Action Bar: ONLY appears when analysisResult exists AND connected to GitLab MR */}
      {hasGitLabMr && (
        <div ref={publishBarRef} role="region" aria-label="發布列" className="sticky bottom-4 z-30 mt-4 animate-in slide-in-from-bottom duration-200">
          {/* 疊在發布列上方，不改變發布列高度 */}
          {publishBarHint && (
            <DisabledReasonText message={publishBarHint.message} className="absolute bottom-full right-0 mb-2 shadow-md" />
          )}
          {/* 發布前讀不到 MR 留言：已中止、沒有送出任何留言；就在發布按鈕上方顯示原因，只提供重試（不提供略過） */}
          {notesReadError && (
            <div
              role="alert"
              className="mb-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start justify-between gap-3 shadow-md animate-in fade-in duration-150"
            >
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-semibold text-rose-900">
                    {notesReadAction ? `${notesReadAction}：已中止發布` : '已中止發布'}
                  </p>
                  <p className="mt-0.5 break-all">{notesReadError}</p>
                  <p className="mt-0.5">按「重試」會以目前內容重新送出（先重新讀取留言，仍會檢查並請你確認）。</p>
                  {onRetryNotesRead && (
                    <button
                      type="button"
                      onClick={onRetryNotesRead}
                      disabled={isPublishing}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface border border-rose-300 text-rose-800 hover:bg-rose-100 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      重試
                    </button>
                  )}
                </div>
              </div>
              {onDismissNotesReadError && (
                <button
                  type="button"
                  onClick={onDismissNotesReadError}
                  aria-label="關閉錯誤"
                  className="text-rose-500 hover:text-rose-700 font-bold px-1"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="bg-slate-900/95 backdrop-blur-md text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700/80 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {/* Left: Selected count & MR info */}
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="font-semibold">
                已選 <strong className="text-orange-400 text-sm font-bold">{publishableSelectedCount}</strong> 則
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-300 font-mono truncate">
                {publishTargetLabel ?? `MR !${mrIid || '連結中'}`}
              </span>
            </div>

            {/* Right: The ONE Solid Primary Button: 發布已選 N 則 + Secondary 更多 ▾ */}
            <div className="flex items-center gap-2">
              {/* Secondary More Dropdown */}
              <div className="relative" ref={stickyMoreRef}>
                <button
                  type="button"
                  onClick={() => setIsStickyMoreOpen(!isStickyMoreOpen)}
                  disabled={isPublishing}
                  className="px-2.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isReadingShareNotes ? (
                    <>
                      <Spinner className="border-slate-500 border-t-white" />
                      <span>讀取留言中…</span>
                    </>
                  ) : (
                    '更多 ▾'
                  )}
                </button>

                {isStickyMoreOpen && (
                  <div className="absolute right-0 bottom-full mb-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-1.5 z-50 space-y-1 text-xs text-white">
                    <button
                      type="button"
                      onClick={() => {
                        if (onPublishSummaryToMr) onPublishSummaryToMr();
                        setIsStickyMoreOpen(false);
                      }}
                      disabled={isSummaryPublished || isPublishing}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                      <div className="font-semibold">發布摘要至 MR</div>
                      <p className="text-[10px] text-slate-400">將核心摘要發布為討論區留言</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onShareAnalysisToMr) onShareAnalysisToMr();
                        setIsStickyMoreOpen(false);
                      }}
                      disabled={isSharingToMr || isPublishing || isSharedToMrPublished}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 border-t border-slate-700"
                    >
                      <div className="font-semibold">{isReadingShareNotes ? '讀取留言中…' : '共享分析（免 Key 共享）'}</div>
                      <p className="text-[10px] text-slate-400">隱藏標記回貼 MR 筆記</p>
                    </button>
                  </div>
                )}
              </div>

              {failedIndices.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  disabled={isPublishing}
                  className="px-2.5 py-2 text-xs font-semibold text-danger-subtle bg-danger hover:bg-danger-hover rounded-lg disabled:opacity-40 transition-colors flex items-center gap-1.5"
                >
                  {isReadingRetryFailedNotes ? (
                    <>
                      <Spinner className="border-danger-subtle/40 border-t-danger-subtle" />
                      <span>讀取留言中…</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>重試失敗 {failedIndices.length} 則</span>
                    </>
                  )}
                </button>
              )}

              {/* The ONE Primary Button: Orange Solid */}
              <TapForReason
                reason={publishableSelectedCount === 0 && !isPublishing ? PUBLISH_NONE_SELECTED_REASON : null}
                onReason={(message) => showPublishBarHint('bar', message)}
              >
                <button
                  type="button"
                  onClick={handlePublishSelectedBatch}
                  disabled={publishableSelectedCount === 0 || isPublishing}
                  className="px-4 py-2 bg-gitlab hover:bg-gitlab-hover text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-40 disabled:pointer-events-none transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {isReadingPublishNotes ? (
                    <>
                      <Spinner className="border-white/40 border-t-white" />
                      <span>讀取留言中…</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>發布已選 {publishableSelectedCount} 則</span>
                    </>
                  )}
                </button>
              </TapForReason>
            </div>
          </div>
        </div>
      )}

      {/* 讀取留言中／發布中的狀態（螢幕報讀器）；一直渲染，內容變動時才會被讀出 */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {publishStatusText}
      </p>
    </div>
  );
};
