import React from 'react';
import {
  Send,
  AlertCircle,
  FileCode,
  X,
  ExternalLink,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { GitLabDiffRefs, GitLabMergeRequestInfo } from '../types/gitlab';
import { MRReviewItem } from '../types/review';
import { plannedPublishMode } from '../services/review-publisher';

interface PublishConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  mrInfo: GitLabMergeRequestInfo | null;
  mrUrl: string;
  itemsToPublish: Array<{
    review: MRReviewItem;
    customComment?: string;
    customSuggestion?: string;
  }>;
  /** 分析時的 diff_refs，用來預估每則是行內或一般留言 */
  diffRefs?: GitLabDiffRefs;
  isPublishingSummary?: boolean;
  summaryTitle?: string;
  isPublishing: boolean;
}

/** 確認對話框中每則的發布方式說明 */
export function describePublishMode(review: MRReviewItem, diffRefs: GitLabDiffRefs | undefined): string {
  if (review.lineVerified === false) return '一般留言（行號未驗證）';
  if (plannedPublishMode(review, diffRefs) === 'general') {
    return diffRefs ? '一般留言（沒有行號）' : '一般留言（缺少 diff 版本資訊）';
  }
  const line = review.newLine ?? review.oldLine ?? review.line;
  return `行內留言 L${line}`;
}

export const PublishConfirmationModal: React.FC<PublishConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  mrInfo,
  mrUrl,
  itemsToPublish,
  diffRefs,
  isPublishingSummary = false,
  summaryTitle,
  isPublishing,
}) => {
  if (!isOpen) return null;

  const generalCount = itemsToPublish.filter((i) => plannedPublishMode(i.review, diffRefs) === 'general').length;
  const unverifiedCount = itemsToPublish.filter((i) => i.review.lineVerified === false).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isPublishingSummary ? '確認發布整體摘要留言' : '確認發布審查意見至 GitLab'}
        className="bg-surface rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-surface-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-gitlab-subtle text-gitlab">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">
                {isPublishingSummary ? '確認發布整體摘要留言' : '確認發布審查意見至 GitLab'}
              </h2>
              <p className="text-xs text-muted">
                透過 GitLab Discussions API 直接發表至 MR
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            aria-label="關閉"
            className="text-muted-light hover:text-muted-dark p-1 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto text-xs">
          {/* Target MR Info Card */}
          <div className="bg-surface-subtle border border-surface-border rounded-lg p-3 space-y-1.5">
            <div className="text-[11px] text-muted-light uppercase font-semibold">目標 Merge Request</div>
            <div className="font-semibold text-ink text-sm flex items-center justify-between">
              <span className="truncate">{mrInfo ? mrInfo.title : summaryTitle || 'GitLab MR'}</span>
              {(mrInfo?.web_url || mrUrl) && (
                <a
                  href={mrInfo?.web_url || mrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:text-primary-hover shrink-0 ml-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            {mrInfo && (
              <div className="text-[11px] text-muted font-mono">
                !{mrInfo.iid} · {mrInfo.source_branch} → {mrInfo.target_branch}
              </div>
            )}
          </div>

          {isPublishingSummary ? (
            <div className="p-3 bg-primary-subtle border border-primary-border rounded-lg space-y-1">
              <div className="font-semibold text-ink flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                即將發送整體摘要為一般 MR 留言
              </div>
              <p className="text-muted-dark">
                包含 MR 標題、核心變更摘要項目、意圖分組清單與測試建議。
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between font-medium text-muted-dark">
                <span>將送出的審查意見 ({itemsToPublish.length} 則)：</span>
                <span className="text-muted">
                  行內 {itemsToPublish.length - generalCount} · 一般留言 {generalCount}
                </span>
              </div>

              {/* 逐則列出將發布的內容與方式 */}
              <ol className="divide-y divide-surface-border border border-surface-border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                {itemsToPublish.map(({ review, customComment, customSuggestion }, idx) => {
                  const mode = plannedPublishMode(review, diffRefs);
                  const suggestion = customSuggestion || review.suggestion;
                  return (
                    <li key={idx} className="p-2.5 bg-surface space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-muted-dark font-semibold flex items-center gap-1 min-w-0">
                          <FileCode className="w-3 h-3 text-muted-light shrink-0" />
                          <span className="truncate">{review.file}</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-surface-muted text-muted uppercase shrink-0">
                          {review.severity} · {review.category}
                        </span>
                      </div>
                      <div
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                          mode === 'inline'
                            ? 'bg-primary-subtle text-primary border-primary-border'
                            : 'bg-warning-subtle text-warning-text border-warning-border'
                        }`}
                      >
                        <MessageSquare className="w-3 h-3" />
                        {describePublishMode(review, diffRefs)}
                      </div>
                      <p className="text-ink whitespace-pre-wrap break-words">{customComment || review.comment}</p>
                      {suggestion?.trim() && (
                        <p className="text-muted whitespace-pre-wrap break-words font-mono text-[11px]">
                          建議：{suggestion}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>

              {unverifiedCount > 0 && (
                <div className="p-3 bg-warning-subtle border border-warning-border rounded-lg flex items-start gap-2 text-[11px] text-warning-text">
                  <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">包含 {unverifiedCount} 則行號未驗證的意見</span>
                    <p className="mt-0.5">
                      這些意見不會掛在程式碼行上，改以一般留言發布，開頭註明「檔案:行號（行號未驗證）」。
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="p-3 bg-surface-subtle border border-surface-border rounded-lg flex items-start gap-2 text-[11px] text-muted-dark">
            <AlertCircle className="w-4 h-4 text-muted shrink-0 mt-0.5" />
            <div>
              送出後將直接發表在 GitLab 專案中，送出成功後該項目會標示「已發布」以避免重複送出；失敗的項目可在清單中重試。
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-surface-subtle border-t border-surface-border flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="px-4 py-2 text-xs text-muted-dark hover:text-ink font-medium"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPublishing}
            className="px-4 py-2 bg-gitlab hover:bg-gitlab-hover text-surface rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {isPublishing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-surface/30 border-t-surface rounded-full animate-spin" />
                <span>發布中...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>確認發送 ({isPublishingSummary ? '1 則摘要' : `${itemsToPublish.length} 則意見`})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
