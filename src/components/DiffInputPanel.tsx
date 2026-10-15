import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  FileText,
  FileCode2,
  Trash2,
  Sparkles,
  GitPullRequest,
  ExternalLink,
  Users,
  AlertCircle,
  DownloadCloud,
  ChevronDown,
  ChevronUp,
  Key,
} from 'lucide-react';
import { ParsedDiff } from '../types/diff';
import type { StaleSharedAnalysis } from '../hooks/useAnalysis';
import { GitLabMergeRequestInfo } from '../types/gitlab';
import { getMixedContentWarning } from '../core/mixed-content';
import { formatYmd } from '../core/date-format';
import { AuthorName } from './AuthorName';

interface DiffInputPanelProps {
  rawDiff: string;
  onDiffChange: (diff: string) => void;
  parsedDiff: ParsedDiff;
  onAnalyze: () => void;
  /** 過期共享報告卡片的「抓最新內容重新分析」：先重新抓 MR 再分析（與新 commit 提示列相同） */
  onReanalyze: () => void;
  onLoadSampleDiff: () => void;
  onLoadSampleAnalysis: () => void;
  isLoading: boolean;
  /** 目前所選模型供應商尚缺的設定（例如「尚未設定 OpenRouter API Key」）；null 表示已可分析 */
  setupNotice: string | null;
  onOpenSettings: () => void;

  // GitLab Props
  gitlabMrUrl: string;
  onGitlabMrUrlChange: (url: string) => void;
  onFetchGitLabMr: (url: string) => Promise<void>;
  isFetchingGitLab: boolean;
  currentGitLabMr: GitLabMergeRequestInfo | null;
  /** MR 留言有共享報告但與 MR 目前版本不符而未載入（版本相同時會自動載入，不顯示卡片） */
  staleSharedAnalysis: StaleSharedAnalysis | null;
  hasGitLabToken: boolean;
  gitlabError: string | null;
  batchProgress?: { current: number; total: number } | null;

  // Hierarchy optimization props
  hasResult?: boolean;
}

export const DiffInputPanel: React.FC<DiffInputPanelProps> = ({
  rawDiff,
  onDiffChange,
  parsedDiff,
  onAnalyze,
  onReanalyze,
  onLoadSampleDiff,
  isLoading,
  setupNotice,
  onOpenSettings,
  gitlabMrUrl,
  onGitlabMrUrlChange,
  onFetchGitLabMr,
  isFetchingGitLab,
  currentGitLabMr,
  staleSharedAnalysis,
  hasGitLabToken,
  gitlabError,
  batchProgress,
  hasResult = false,
}) => {
  const [sourceTab, setSourceTab] = useState<'gitlab' | 'manual'>('gitlab');
  const mrUrlMixedContentWarning = getMixedContentWarning(gitlabMrUrl);
  const [isDragging, setIsDragging] = useState(false);
  // Default collapsed when there is an analysis result
  const [isDiffExpanded, setIsDiffExpanded] = useState(!hasResult);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When result appears, collapse diff editor by default
  useEffect(() => {
    if (hasResult) {
      setIsDiffExpanded(false);
    }
  }, [hasResult]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const text = await file.text();
      onDiffChange(text);
      setSourceTab('manual');
      setIsDiffExpanded(true);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const text = await file.text();
      onDiffChange(text);
      setIsDiffExpanded(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFetchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (gitlabMrUrl.trim()) {
      onFetchGitLabMr(gitlabMrUrl.trim());
    }
  };

  const diffLineCount = rawDiff ? rawDiff.split('\n').length : 0;

  return (
    <div
      className={`flex flex-col h-auto bg-surface rounded-xl border transition-colors shadow-xs ${
        isDragging ? 'border-primary bg-primary-subtle ring-2 ring-primary-border' : 'border-surface-border'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 1. Source Selector Tabs */}
      <div className="p-2.5 border-b border-surface-border flex items-center justify-between bg-surface-subtle rounded-t-xl">
        <div className="flex items-center gap-1 bg-slate-200/60 p-0.5 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setSourceTab('gitlab')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
              sourceTab === 'gitlab'
                ? 'bg-surface text-gitlab shadow-xs font-semibold'
                : 'text-muted-dark hover:text-slate-900'
            }`}
          >
            <GitPullRequest className="w-3.5 h-3.5 text-gitlab" />
            <span>GitLab</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceTab('manual')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
              sourceTab === 'manual'
                ? 'bg-surface text-primary shadow-xs font-semibold'
                : 'text-muted-dark hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-primary" />
            <span>手動貼上</span>
          </button>
        </div>

        {/* Load Sample Diff action (only here in left column) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onLoadSampleDiff();
              setIsDiffExpanded(true);
            }}
            className="text-xs px-2 py-1 text-slate-500 hover:text-primary flex items-center gap-1 font-medium transition-colors cursor-pointer hover:underline"
            title="載入購物車範例 Diff"
          >
            <FileCode2 className="w-3.5 h-3.5 text-slate-400" />
            <span>範例 Diff</span>
          </button>

          {rawDiff && (
            <button
              type="button"
              onClick={() => onDiffChange('')}
              className="text-xs p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              title="清空 Diff 內容"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Main Input Content */}
      <div className={`p-3.5 space-y-3 flex flex-col ${hasResult && !isDiffExpanded ? '' : 'flex-1 overflow-y-auto'}`}>
        {sourceTab === 'gitlab' ? (
          <>
            {/* GitLab MR URL Input Form */}
            <form onSubmit={handleFetchSubmit} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-700">
                <label className="font-semibold">GitLab Merge Request 網址</label>
                {!hasGitLabToken && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-[11px] text-amber-700 hover:underline flex items-center gap-0.5"
                  >
                    <AlertCircle className="w-3 h-3" /> 設定 Token (私有 MR)
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={gitlabMrUrl}
                  onChange={(e) => onGitlabMrUrlChange(e.target.value)}
                  placeholder="https://gitlab.com/owner/project/-/merge_requests/123"
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-border focus:border-primary font-mono bg-white"
                />
                {/* Secondary styled fetch button */}
                <button
                  type="submit"
                  disabled={isFetchingGitLab || !gitlabMrUrl.trim()}
                  className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-2xs disabled:opacity-50 transition-colors flex items-center gap-1.5 shrink-0"
                >
                  {isFetchingGitLab ? (
                    <>
                      <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                      <span>抓取中...</span>
                    </>
                  ) : (
                    <>
                      <DownloadCloud className="w-3.5 h-3.5 text-slate-600" />
                      <span>抓取</span>
                    </>
                  )}
                </button>
              </div>
              {mrUrlMixedContentWarning && (
                <p className="text-[11px] text-amber-700 flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  {mrUrlMixedContentWarning}
                </p>
              )}
            </form>

            {/* Error notice if fetch failed */}
            {gitlabError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-semibold">抓取失敗</span>
                  <p className="text-[11px] text-rose-700">{gitlabError}</p>
                </div>
              </div>
            )}

            {/* 未載入的共享報告：分析版本與 MR 目前版本不符，需重新分析 */}
            {staleSharedAnalysis && (
              <div
                role="status"
                className="p-2.5 bg-warning-subtle border border-warning-border rounded-lg space-y-1.5 animate-in fade-in duration-200 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-warning-text flex items-center gap-1 min-w-0">
                    <Users className="w-3.5 h-3.5 text-warning shrink-0" />
                    MR 上的共享分析報告已過期，未載入
                  </span>
                  {/* 與新 commit 提示列的「抓最新內容重新分析」相同：先重新抓 MR 與 diff，再呼叫 AI 分析 */}
                  <button
                    type="button"
                    onClick={onReanalyze}
                    disabled={isLoading || isFetchingGitLab || !rawDiff.trim()}
                    className="text-[11px] bg-surface hover:bg-warning-subtle text-warning-text border border-warning-border px-2 py-0.5 rounded-md font-semibold shrink-0 flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-3 h-3" />
                    抓最新內容重新分析
                  </button>
                </div>
                <p className="text-[11px] text-warning-text">
                  由 <AuthorName author={staleSharedAnalysis.author} /> 於{' '}
                  {formatYmd(staleSharedAnalysis.createdAt)} 發布
                </p>
                {/* 句尾片語不拆行：窄螢幕上「準。」不會單獨掉到下一行 */}
                <p className="text-[11px] text-warning-text leading-snug text-pretty">
                  {staleSharedAnalysis.sharedHeadSha ? (
                    <>
                      這份報告分析完後，MR 又有新的 commit，<span className="whitespace-nowrap">內容可能已經不準。</span>
                    </>
                  ) : (
                    <>
                      這份報告由舊版工具分享，沒有記錄分析時的 commit，無法確認是否對應{' '}
                      <span className="whitespace-nowrap">MR 目前的版本。</span>
                    </>
                  )}
                </p>
                {staleSharedAnalysis.sharedHeadSha && (
                  <p className="text-[10px] text-muted font-mono break-all">
                    報告 {staleSharedAnalysis.sharedHeadSha.slice(0, 8)}
                    {staleSharedAnalysis.currentHeadSha
                      ? ` → 目前 ${staleSharedAnalysis.currentHeadSha.slice(0, 8)}`
                      : ' · 無法取得 MR 目前的版本'}
                  </p>
                )}
              </div>
            )}

            {/* Current MR Info Badge */}
            {currentGitLabMr && (
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5 truncate">
                    <GitPullRequest className="w-3.5 h-3.5 text-gitlab" />
                    !{currentGitLabMr.iid} · {currentGitLabMr.title}
                  </span>
                  <a
                    href={currentGitLabMr.web_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline flex items-center gap-0.5 text-[11px] shrink-0 ml-2"
                  >
                    <span>開啟</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {currentGitLabMr.source_branch} → {currentGitLabMr.target_branch}
                </div>
              </div>
            )}

            {/* Diff content view (Collapsible when result exists) */}
            <div className={`flex flex-col space-y-1 ${hasResult && !isDiffExpanded ? '' : 'flex-1 min-h-[140px]'}`}>
              {isFetchingGitLab ? (
                <div className="flex-1 flex items-center justify-center bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 p-8">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-gitlab border-t-transparent rounded-full animate-spin" />
                    <span>正在載入變更…</span>
                  </div>
                </div>
              ) : hasResult && !isDiffExpanded ? (
                <button
                  type="button"
                  onClick={() => setIsDiffExpanded(true)}
                  className="w-full p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600 font-medium flex items-center justify-between transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>顯示 Diff（{diffLineCount} 行／{rawDiff.length.toLocaleString()} 字元）</span>
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
              ) : (
                <div className="flex-1 flex flex-col space-y-1 min-h-[140px]">
                  {hasResult && (
                    <div className="flex items-center justify-between text-xs text-slate-500 pb-1">
                      <span>Diff 內容（{diffLineCount} 行／{rawDiff.length.toLocaleString()} 字元）</span>
                      <button
                        type="button"
                        onClick={() => setIsDiffExpanded(false)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>收合</span>
                        <ChevronUp className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <textarea
                    value={rawDiff}
                    onChange={(e) => onDiffChange(e.target.value)}
                    placeholder="抓取成功後，變更 diff 將呈現於此..."
                    className="w-full h-44 p-2.5 text-xs font-mono text-slate-800 resize-y focus:outline-none bg-slate-900/[0.02] border border-slate-200 rounded-lg leading-relaxed"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          /* Manual Diff Input Area */
          <div className={`relative flex flex-col space-y-1 ${hasResult && !isDiffExpanded ? '' : 'flex-1 min-h-[200px]'}`}>
            {hasResult && !isDiffExpanded ? (
              <button
                type="button"
                onClick={() => setIsDiffExpanded(true)}
                className="w-full p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-600 font-medium flex items-center justify-between transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  <span>顯示 Diff（{diffLineCount} 行／{rawDiff.length.toLocaleString()} 字元）</span>
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
            ) : (
              <div className="flex-1 flex flex-col border border-slate-200 rounded-lg overflow-hidden min-h-[200px]">
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500 border-b border-slate-200">
                  <span>貼上 Unified Diff 或拖曳檔案</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="hover:text-primary flex items-center gap-1 text-slate-600 cursor-pointer"
                    >
                      <Upload className="w-3 h-3" />
                      <span>選取檔案</span>
                    </button>
                    {hasResult && (
                      <button
                        type="button"
                        onClick={() => setIsDiffExpanded(false)}
                        className="text-slate-500 hover:text-slate-800 flex items-center gap-0.5 ml-1 cursor-pointer"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".diff,.patch,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>

                <textarea
                  value={rawDiff}
                  onChange={(e) => onDiffChange(e.target.value)}
                  placeholder={`在此貼上 git diff 內容...\n例如：\ndiff --git a/src/App.tsx b/src/App.tsx\n--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -10,4 +10,6 @@\n+ import { useCoupon } from './hooks/useCoupon';`}
                  className="w-full h-44 p-3 text-xs font-mono text-slate-800 placeholder:text-slate-400 resize-y focus:outline-none bg-white leading-relaxed"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Combined Stats Bar: One compact line */}
      <div className="px-3.5 py-1.5 bg-surface-subtle border-t border-surface-border flex items-center justify-between text-[11px] text-muted">
        <span>
          變更檔案 <strong className="text-slate-800 font-semibold">{parsedDiff.fileCount}</strong> 個 ·{' '}
          <span className="text-emerald-700 font-mono font-medium">+{parsedDiff.totalAdditions}</span> /{' '}
          <span className="text-rose-700 font-mono font-medium">-{parsedDiff.totalDeletions}</span> 行
        </span>
        {rawDiff.length > 0 && (
          <span className="font-mono text-[10px] text-muted-light">
            {rawDiff.length.toLocaleString()} 字元
          </span>
        )}
      </div>

      {/* 4. Action Controls: The ONE solid primary button */}
      <div className="p-3.5 border-t border-surface-border bg-surface rounded-b-xl space-y-2">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isLoading || !rawDiff.trim()}
          className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
            hasResult
              ? 'bg-surface border border-slate-300 text-slate-700 hover:bg-slate-50'
              : 'bg-primary hover:bg-primary-hover text-white shadow-xs'
          }`}
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-slate-400 border-t-primary rounded-full animate-spin" />
              <span>
                {batchProgress
                  ? `分批分析中 (第 ${batchProgress.current}/${batchProgress.total} 批)...`
                  : '分析中...'}
              </span>
            </>
          ) : (
            <>
              <Sparkles className={`w-4 h-4 ${hasResult ? 'text-primary' : 'text-indigo-200'}`} />
              {/* 有結果時仍只分析輸入框目前的 diff（onAnalyze），不重新抓 MR；與過期卡片／新 commit 提示列的「抓最新內容重新分析」區分 */}
              <span>{hasResult ? '用目前的 Diff 重新分析' : '分析'}</span>
            </>
          )}
        </button>

        {/* 依目前所選 provider 顯示缺少的設定，single line with link */}
        {setupNotice && (
          <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Key className="w-3 h-3 text-amber-600 shrink-0" />
              {setupNotice}
            </span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-primary hover:underline font-semibold"
            >
              前往設定
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
