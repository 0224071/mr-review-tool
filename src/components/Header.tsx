import React from 'react';
import { GitPullRequest, Settings, Key, History } from 'lucide-react';

interface HeaderProps {
  onOpenSettings: () => void;
  hasApiKey: boolean;
  onLoadSample?: () => void;
  /** 未提供時（例如 IndexedDB 不可用）不顯示歷史紀錄按鈕 */
  onOpenHistory?: () => void;
  historyCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenSettings,
  hasApiKey,
  onOpenHistory,
  historyCount,
}) => {
  return (
    <header className="bg-surface border-b border-surface-border sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-gitlab via-amber-500 to-primary flex items-center justify-center text-white shadow-sm ring-2 ring-orange-100">
            <GitPullRequest className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              GitLab MR 講解與審查工具
            </h1>
          </div>
        </div>

        {/* Right Actions: Settings */}
        <div className="flex items-center gap-2 sm:gap-3">
          {onOpenHistory && (
            <button
              type="button"
              onClick={onOpenHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-dark hover:bg-surface-muted transition-colors"
            >
              <History className="w-3.5 h-3.5 text-muted" />
              <span>歷史紀錄</span>
              {historyCount !== undefined && (
                <span className="text-[10px] font-semibold text-muted bg-surface-muted rounded px-1">
                  {historyCount}
                </span>
              )}
            </button>
          )}

          {/* Settings button */}
          <button
            type="button"
            onClick={onOpenSettings}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              hasApiKey
                ? 'bg-surface border-slate-300 text-slate-700 hover:bg-slate-50'
                : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100 animate-pulse'
            }`}
          >
            {hasApiKey ? (
              <Settings className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <Key className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span>{hasApiKey ? '偏好設定' : '填寫金鑰'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
