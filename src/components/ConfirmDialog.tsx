import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  /** true：紅色（刪除）；false：橘色警告（重複發布） */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40 p-4"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm bg-surface rounded-xl border border-surface-border shadow-xl p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${danger ? 'text-danger' : 'text-gitlab'}`} />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-ink">{title}</h3>
            {body && <div className="text-xs text-muted leading-relaxed">{body}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-dark hover:bg-surface-muted"
          >
            取消
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-surface ${
              danger ? 'bg-danger hover:bg-danger-hover' : 'bg-gitlab hover:bg-gitlab-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
