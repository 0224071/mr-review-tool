import React, { useEffect, useState } from 'react';
import {
  FileDiff,
  GitCommitHorizontal,
  GitPullRequest,
  MessageSquare,
  Pin,
  Trash2,
  X,
} from 'lucide-react';
import { formatHistoryTime, hasNewCommit, HistoryRecord, sortHistoryRecords } from '../core/history-store';
import { ConfirmDialog } from './ConfirmDialog';

interface HistoryDrawerProps {
  open: boolean;
  records: HistoryRecord[];
  activeId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onClearUnpinned: () => void;
}

const recordTitle = (r: HistoryRecord) => {
  if (r.sourceType === 'gitlab') return r.title;
  return r.sourceType === 'sample' ? '範例 Diff' : '手動 Diff';
};

const recordProject = (r: HistoryRecord) => {
  if (r.sourceType === 'gitlab') return `${r.projectPath ?? ''}${r.mrIid != null ? ` !${r.mrIid}` : ''}`;
  return r.result.title;
};

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  open,
  records,
  activeId,
  onClose,
  onOpen,
  onTogglePin,
  onDelete,
  onClearUnpinned,
}) => {
  const [pendingConfirm, setPendingConfirm] = useState<{ kind: 'all' } | { kind: 'one'; id: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pendingConfirm) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pendingConfirm, onClose]);

  const sorted = sortHistoryRecords(records);
  const unpinnedCount = records.filter((r) => !r.pinned).length;
  const pendingRecord =
    pendingConfirm?.kind === 'one' ? records.find((r) => r.id === pendingConfirm.id) : undefined;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-overlay/20 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        aria-label="歷史紀錄"
        aria-hidden={!open}
        className={`fixed top-0 right-0 z-50 h-full w-[400px] max-w-full bg-surface border-l border-surface-border shadow-xl flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0 visible' : 'translate-x-full invisible'
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-surface-border">
          <h2 className="text-sm font-bold text-ink">
            歷史紀錄 <span className="text-muted font-normal">（{records.length}）</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="p-1.5 rounded-lg text-muted hover:bg-surface-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-surface-border flex justify-end">
          <button
            type="button"
            disabled={unpinnedCount === 0}
            onClick={() => setPendingConfirm({ kind: 'all' })}
            className="text-xs font-medium text-danger-text hover:underline disabled:text-muted-light disabled:no-underline disabled:cursor-not-allowed"
          >
            清除全部未釘選紀錄
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-surface-border">
          {sorted.length === 0 && <li className="p-8 text-center text-xs text-muted">還沒有任何紀錄</li>}
          {sorted.map((r) => {
            const newCommit = hasNewCommit(r);
            return (
              <li
                key={r.id}
                className={`group relative ${r.id === activeId ? 'bg-primary-subtle/40' : 'hover:bg-surface-subtle'}`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(r.id)}
                  className="w-full text-left px-4 py-3 pr-20 space-y-1 focus:outline-none focus-visible:bg-surface-subtle"
                >
                  <div className="flex items-center gap-1.5">
                    {r.pinned && <Pin className="w-3 h-3 text-primary shrink-0 fill-current" aria-label="已釘選" />}
                    {r.sourceType === 'gitlab' ? (
                      <GitPullRequest className="w-3.5 h-3.5 text-gitlab shrink-0" aria-label="GitLab MR" />
                    ) : (
                      <FileDiff className="w-3.5 h-3.5 text-muted shrink-0" aria-label="Diff" />
                    )}
                    <span className="text-xs font-semibold text-ink truncate">{recordTitle(r)}</span>
                  </div>
                  <div className="text-[11px] text-muted truncate">{recordProject(r)}</div>
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                    <span>{formatHistoryTime(r.analyzedAt)}</span>
                    <span className="truncate" title="產生此結果的模型">
                      {r.provider ?? r.result.provider ?? 'gemini'}
                      {(r.model ?? r.result.model) ? ` · ${r.model ?? r.result.model}` : ''}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <MessageSquare className="w-3 h-3" />
                      {r.result.reviews.length} 則
                    </span>
                    {newCommit && (
                      <span className="inline-flex items-center gap-0.5 text-warning-text bg-warning-subtle border border-warning-border rounded px-1 font-medium">
                        <GitCommitHorizontal className="w-3 h-3" />
                        有新 commit
                      </span>
                    )}
                  </div>
                </button>
                <div className="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => onTogglePin(r.id)}
                    title={r.pinned ? '取消釘選' : '釘選'}
                    aria-label={r.pinned ? '取消釘選' : '釘選'}
                    aria-pressed={r.pinned}
                    className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-surface"
                  >
                    <Pin className={`w-3.5 h-3.5 ${r.pinned ? 'text-primary fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingConfirm({ kind: 'one', id: r.id })}
                    title="刪除"
                    aria-label="刪除"
                    className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-surface"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="px-4 py-3 border-t border-surface-border text-[11px] text-muted">
          最多 50 筆、保留 30 天，釘選的不受限。紀錄只存在這個瀏覽器。
        </p>
      </aside>

      <ConfirmDialog
        open={!!pendingConfirm}
        danger
        title={pendingConfirm?.kind === 'all' ? `清除 ${unpinnedCount} 筆未釘選紀錄？` : '刪除這筆紀錄？'}
        body={
          pendingConfirm?.kind === 'all'
            ? '釘選的紀錄會保留。此動作無法復原。'
            : `「${pendingRecord ? recordTitle(pendingRecord) : ''}」的分析結果與發布紀錄會從這個瀏覽器移除，無法復原。`
        }
        confirmLabel={pendingConfirm?.kind === 'all' ? '清除' : '刪除'}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (pendingConfirm?.kind === 'all') onClearUnpinned();
          else if (pendingConfirm) onDelete(pendingConfirm.id);
          setPendingConfirm(null);
        }}
      />
    </>
  );
};
