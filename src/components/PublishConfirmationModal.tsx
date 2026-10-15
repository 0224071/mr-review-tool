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
import { GitLabAuthor, GitLabDiffRefs, GitLabMergeRequestInfo } from '../types/gitlab';
import { MRReviewItem } from '../types/review';
import { plannedPublishMode } from '../services/review-publisher';
import { hasSuggestion, resolveEffectiveComment, resolveEffectiveSuggestion } from '../core/review-text';
import { formatYmd } from '../core/date-format';
import { AuthorName } from './AuthorName';

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
  /**
   * 共享分析報告（隱藏標記留言）；overwrite 為要覆寫的既有留言種類，null 表示新增一則。
   * 覆寫時帶原留言的作者（顯示名稱與 username）、發布時間與網址。
   */
  share?: {
    overwrite: 'shared' | 'summary' | null;
    overwriteAuthor?: GitLabAuthor;
    overwriteCreatedAt?: string;
    overwriteNoteUrl?: string;
  };
  summaryTitle?: string;
  /** 視窗標題；未提供時依發布內容顯示預設標題（示範模式：「模擬發布（示範，不會送到 GitLab）」） */
  title?: string;
  /** 沒有 MR 資訊時顯示的目標名稱（示範模式） */
  targetLabel?: string;
  /** 標註於標題、內容與按鈕（示範模式：「示範，未實際發布」） */
  notice?: string;
  isPublishing: boolean;
}

/** 共享確認視窗中說明留言內容的小字 */
const SHARE_CONTENT_NOTE =
  '留言包含分析摘要、意圖分組、審查意見統計，以及供本工具載入的隱藏標記與完整分析結果（JSON）。團隊成員開啟同一 MR 時，若沒有新的 commit 就會自動載入這份報告。';

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
  share,
  summaryTitle,
  title,
  targetLabel,
  notice,
  isPublishing,
}) => {
  if (!isOpen) return null;

  const generalCount = itemsToPublish.filter((i) => plannedPublishMode(i.review, diffRefs) === 'general').length;
  const unverifiedCount = itemsToPublish.filter((i) => i.review.lineVerified === false).length;
  const heading =
    title ?? (share ? '確認共享分析報告至 MR' : isPublishingSummary ? '確認發布整體摘要留言' : '確認發布審查意見至 GitLab');
  const overwriteLabel = share?.overwrite === 'shared' ? '共享報告留言' : '整體摘要留言';
  const overwriteDate = share?.overwriteCreatedAt ? formatYmd(share.overwriteCreatedAt) : null;
  // 「會覆寫 名稱 @username 於 2026/10/1 發布的共享報告留言，不會另外新增留言」
  const overwriteSentence = (
    <>
      會覆寫{' '}
      {share?.overwriteAuthor ? <AuthorName author={share.overwriteAuthor} /> : 'MR 上'}
      {overwriteDate ? ` 於 ${overwriteDate}` : ''} 發布的{overwriteLabel}，不會另外新增留言
    </>
  );
  const confirmLabel = share
    ? share.overwrite
      ? '確認共享（覆寫 1 則留言）'
      : '確認共享（新增 1 則留言）'
    : `確認發送 (${isPublishingSummary ? '1 則摘要' : `${itemsToPublish.length} 則意見`})`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
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
                {heading}
              </h2>
              <p className="text-xs text-muted text-pretty">
                {notice ? (
                  `模擬發布：${notice}`
                ) : share ? (
                  // 片語不拆行：窄螢幕上「到」不會單獨掉到下一行
                  <>
                    會在 MR 上留下一則留言，<span className="whitespace-nowrap">團隊成員都看得到</span>
                  </>
                ) : (
                  '透過 GitLab Discussions API 直接發表至 MR'
                )}
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
        <div className="p-4 sm:p-6 space-y-4 max-h-[65vh] overflow-y-auto text-xs">
          {notice && (
            <div
              role="note"
              className="p-2.5 bg-warning-subtle border border-warning-border rounded-lg text-warning-text font-semibold flex items-center gap-1.5"
            >
              <AlertCircle className="w-4 h-4 text-warning shrink-0" />
              {notice}：不會連到 GitLab，也不會產生真的留言
            </div>
          )}
          {/* Target MR Info Card */}
          <div className="bg-surface-subtle border border-surface-border rounded-lg p-3 space-y-1.5">
            <div className="text-[11px] text-muted-light uppercase font-semibold">目標 Merge Request</div>
            <div className="font-semibold text-ink text-sm flex items-center justify-between">
              <span className="truncate">{mrInfo ? mrInfo.title : targetLabel || summaryTitle || 'GitLab MR'}</span>
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

          {share ? (
            share.overwrite ? (
              <div
                role="note"
                className="p-3 bg-warning-subtle border border-warning-border rounded-lg flex items-start gap-2 text-warning-text"
              >
                <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="font-semibold">{overwriteSentence}</p>
                  {share.overwriteNoteUrl && (
                    <p className="text-[11px]">
                      <a
                        href={share.overwriteNoteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-2 hover:text-ink"
                      >
                        查看原留言
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                  )}
                  <p className="text-[11px] leading-snug opacity-90">{SHARE_CONTENT_NOTE}</p>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-primary-subtle border border-primary-border rounded-lg space-y-1">
                <div className="font-semibold text-ink flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  會在 MR 新增一則共享報告留言
                </div>
                <p className="text-[11px] text-muted-dark leading-snug">{SHARE_CONTENT_NOTE}</p>
              </div>
            )
          ) : isPublishingSummary ? (
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
                  const comment = resolveEffectiveComment(customComment, review.comment);
                  const suggestion = resolveEffectiveSuggestion(customSuggestion, review.suggestion);
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
                      <p className="text-ink whitespace-pre-wrap break-words">{comment}</p>
                      {hasSuggestion(suggestion) && (
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

          {/* 共享模式只用上面一個框說明（內容說明已併入小字），示範模式仍提示不會真的送出 */}
          {(notice || !share) && (
            <div className="p-3 bg-surface-subtle border border-surface-border rounded-lg flex items-start gap-2 text-[11px] text-muted-dark">
              <AlertCircle className="w-4 h-4 text-muted shrink-0 mt-0.5" />
              <div>
                {notice
                  ? `${notice}：送出後只在畫面上標示「已發布」，方便體驗流程。`
                  : '送出後將直接發表在 GitLab 專案中，送出成功後該項目會標示「已發布」以避免重複送出；失敗的項目可在清單中重試。'}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3.5 bg-surface-subtle border-t border-surface-border flex flex-wrap items-center justify-end gap-2.5">
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
                <span>{share ? '共享中...' : '發布中...'}</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>
                  {confirmLabel}
                  {notice && `・${notice}`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
