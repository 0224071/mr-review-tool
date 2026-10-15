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
import { PublishedMatch } from '../core/publish-dedup';

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
    }>
  ) => void;
  publishStates?: Record<number, ReviewPublishState>;
  /** 發布作業進行中：停用發布與重試按鈕，避免重複送出 */
  isPublishing?: boolean;
  isGitLabConfigured?: boolean;
  onPublishSummaryToMr?: () => void;
  onShareAnalysisToMr?: () => void;
  isSharingToMr?: boolean;
  isSummaryPublished?: boolean;
  isSharedToMrPublished?: boolean;
  mrUrl?: string;

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
  isSummaryPublished = false,
  isSharedToMrPublished = false,
  mrUrl = '',
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

  // Batch publish trigger
  const handlePublishSelectedBatch = () => {
    if (!onPublishBatchReviews || selectedIndices.size === 0) return;
    const items = Array.from(selectedIndices).map((idx) => ({
      review: result.reviews[idx],
      customComment: draftEdits[idx]?.comment,
      customSuggestion: draftEdits[idx]?.suggestion,
      index: idx,
    }));
    onPublishBatchReviews(items);
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
      }))
    );
  };

  // Parse MR IID if connected
  const hasGitLabMr = Boolean(mrUrl && mrUrl.trim());
  const mrMatch = mrUrl ? mrUrl.match(/merge_requests\/(\d+)/) : null;
  const mrIid = mrMatch ? mrMatch[1] : '';

  // 7. Checklist coverage banner: ONLY render when ?debug is in URL
  const isDebugMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('debug');
  }, []);

  return (
    <div className="space-y-4 pb-6">
      {/* 新 commit 提示列：快取結果的 head SHA 與 MR 目前不同 */}
      {hasNewCommit && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-warning-border bg-warning-subtle text-xs text-warning-text"
        >
          <span className="flex items-center gap-2">
            <GitCommitHorizontal className="w-4 h-4 text-warning shrink-0" />
            此 MR 在分析後有新的 commit，目前顯示的是舊結果
          </span>
          {onReanalyze && (
            <button
              type="button"
              onClick={onReanalyze}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-warning-border bg-surface font-semibold text-warning-text hover:bg-warning-hover"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              重新分析
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
              className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg font-medium transition-colors shadow-2xs"
            >
              <Send className="w-3.5 h-3.5 text-gitlab" />
              <span>發布至 MR ▾</span>
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
                  disabled={isSummaryPublished}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  <div className="font-semibold text-slate-800 flex items-center justify-between">
                    <span>發布摘要至 MR</span>
                    {isSummaryPublished && <span className="text-[10px] text-emerald-600 font-bold">已發布</span>}
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
                  disabled={isSharingToMr || isSharedToMrPublished}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 border-t border-slate-100"
                >
                  <div className="font-semibold text-slate-800 flex items-center justify-between">
                    <span>共享分析（免 Key 共享）</span>
                    {isSharedToMrPublished && <span className="text-[10px] text-emerald-600 font-bold">已共享</span>}
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
        <div className="sticky bottom-4 z-30 mt-4 animate-in slide-in-from-bottom duration-200">
          <div className="bg-slate-900/95 backdrop-blur-md text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700/80 flex items-center justify-between gap-4">
            {/* Left: Selected count & MR info */}
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold">
                已選 <strong className="text-orange-400 text-sm font-bold">{selectedIndices.size}</strong> 則
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-300 font-mono">
                MR !{mrIid || '連結中'}
              </span>
            </div>

            {/* Right: The ONE Solid Primary Button: 發布已選 N 則 + Secondary 更多 ▾ */}
            <div className="flex items-center gap-2">
              {/* Secondary More Dropdown */}
              <div className="relative" ref={stickyMoreRef}>
                <button
                  type="button"
                  onClick={() => setIsStickyMoreOpen(!isStickyMoreOpen)}
                  className="px-2.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
                >
                  更多 ▾
                </button>

                {isStickyMoreOpen && (
                  <div className="absolute right-0 bottom-full mb-2 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-1.5 z-50 space-y-1 text-xs text-white">
                    <button
                      type="button"
                      onClick={() => {
                        if (onPublishSummaryToMr) onPublishSummaryToMr();
                        setIsStickyMoreOpen(false);
                      }}
                      disabled={isSummaryPublished}
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
                      disabled={isSharingToMr || isSharedToMrPublished}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 border-t border-slate-700"
                    >
                      <div className="font-semibold">共享分析（免 Key 共享）</div>
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
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>重試失敗 {failedIndices.length} 則</span>
                </button>
              )}

              {/* The ONE Primary Button: Orange Solid */}
              <button
                type="button"
                onClick={handlePublishSelectedBatch}
                disabled={selectedIndices.size === 0 || isPublishing}
                className="px-4 py-2 bg-gitlab hover:bg-gitlab-hover text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-40 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>發布已選 {selectedIndices.size} 則</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
