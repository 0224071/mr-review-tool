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
import { GitLabMergeRequestInfo } from '../types/gitlab';
import { MRReviewItem } from '../types/review';

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
  isPublishingSummary?: boolean;
  summaryTitle?: string;
  isPublishing: boolean;
}

export const PublishConfirmationModal: React.FC<PublishConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  mrInfo,
  mrUrl,
  itemsToPublish,
  isPublishingSummary = false,
  summaryTitle,
  isPublishing,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                {isPublishingSummary ? '確認發布整體摘要留言' : '確認發布審查意見至 GitLab'}
              </h2>
              <p className="text-xs text-slate-500">
                透過 GitLab Discussions API 直接發表至 MR
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto text-xs">
          {/* Target MR Info Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
            <div className="text-[11px] text-slate-400 uppercase font-semibold">目標 Merge Request</div>
            <div className="font-semibold text-slate-800 text-sm flex items-center justify-between">
              <span className="truncate">{mrInfo ? mrInfo.title : summaryTitle || 'GitLab MR'}</span>
              {(mrInfo?.web_url || mrUrl) && (
                <a
                  href={mrInfo?.web_url || mrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 shrink-0 ml-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            {mrInfo && (
              <div className="text-[11px] text-slate-500 font-mono">
                !{mrInfo.iid} · {mrInfo.source_branch} → {mrInfo.target_branch}
              </div>
            )}
          </div>

          {isPublishingSummary ? (
            <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-lg space-y-1">
              <div className="font-semibold text-indigo-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                即將發送整體摘要為一般 MR 留言
              </div>
              <p className="text-slate-600">
                包含 MR 標題、核心變更摘要項目、意圖分組清單與測試建議。
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between font-medium text-slate-700">
                <span>將送出的審查意見清單 ({itemsToPublish.length} 則)：</span>
                <span className="text-indigo-600 font-bold">精準錨定行號</span>
              </div>

              {/* Items List Preview */}
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {itemsToPublish.map(({ review, customComment }, idx) => (
                  <div key={idx} className="p-2.5 bg-white hover:bg-slate-50 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-slate-700 font-semibold flex items-center gap-1">
                        <FileCode className="w-3 h-3 text-slate-400" />
                        {review.file}{review.line != null ? `:L${review.line}` : review.lineVerified === false ? ':行號未驗證' : ''}
                        {review.lineVerified === false && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-100 text-amber-800 border border-amber-300">
                            此意見行號可能不準確
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-slate-100 text-slate-600 uppercase">
                        {review.severity} · {review.category}
                      </span>
                    </div>
                    <p className="text-slate-600 truncate">{customComment || review.comment}</p>
                  </div>
                ))}
              </div>

              {itemsToPublish.some((i) => i.review.lineVerified === false) && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2 text-[11px] text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">⚠️ 提醒：包含行號未驗證的審查意見！</span>
                    <p className="text-amber-800 mt-0.5">
                      部分選取的意見未能於 Diff 中精確錨定到相符程式碼行，此意見行號可能不準確，送出時可能無法正確對應至 GitLab 行號。
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2 text-[11px] text-slate-700">
            <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <div>
              送出後將直接發表在 GitLab 專案中，送出成功後該項目會標示「已發布」以避免重複送出。
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 font-medium"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPublishing}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {isPublishing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
