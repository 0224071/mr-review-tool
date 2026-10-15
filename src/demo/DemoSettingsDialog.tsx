import React from 'react';
import { Key, X } from 'lucide-react';
import type { SettingsDialogProps } from '../app/app-services';

/**
 * 示範模式的設定對話框：不顯示金鑰欄位、不測試連線，只引導離開示範後再填寫金鑰。
 */
export function createDemoSettingsDialog(onExit: () => void): React.FC<SettingsDialogProps> {
  const DemoSettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-xs p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="示範模式不使用金鑰"
          className="bg-surface rounded-xl shadow-2xl max-w-sm w-full border border-surface-border p-5 space-y-3 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <Key className="w-4 h-4 text-primary" />
              示範模式不使用金鑰
            </h2>
            <button type="button" onClick={onClose} aria-label="關閉" className="text-muted-light hover:text-muted-dark p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-muted-dark leading-relaxed">
            示範中的分析與發布都是模擬的，不會讀取或保存任何金鑰。要分析自己的 MR，請離開示範後填寫金鑰。
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-muted-dark hover:text-ink font-medium">
              繼續示範
            </button>
            <button
              type="button"
              onClick={onExit}
              className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg font-semibold"
            >
              離開示範
            </button>
          </div>
        </div>
      </div>
    );
  };
  return DemoSettingsDialog;
}
