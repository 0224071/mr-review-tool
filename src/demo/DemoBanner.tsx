import React from 'react';
import { FlaskConical, LogOut } from 'lucide-react';
import { DEMO_BANNER_SHORT_TEXT, DEMO_BANNER_TEXT } from './demo-mode';

/** 示範模式固定橫幅：捲動時停在頁首下方；手機窄螢幕改用短文案，維持一行 */
export const DemoBanner: React.FC<{ onExit: () => void }> = ({ onExit }) => (
  <div
    role="status"
    data-testid="demo-banner"
    className="sticky top-16 z-20 mb-3 sm:mb-4 px-3 sm:px-4 py-1.5 sm:py-2.5 rounded-xl border border-warning-border bg-warning-subtle text-warning-text text-xs flex sm:flex-wrap items-center justify-between gap-2 shadow-xs"
  >
    <span className="flex items-center gap-2 font-semibold min-w-0">
      <FlaskConical className="w-4 h-4 text-warning shrink-0" />
      <span className="sm:hidden truncate">{DEMO_BANNER_SHORT_TEXT}</span>
      <span className="hidden sm:inline">{DEMO_BANNER_TEXT}</span>
    </span>
    <button
      type="button"
      onClick={onExit}
      className="shrink-0 inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg border border-warning-border bg-surface font-semibold text-warning-text hover:bg-warning-hover"
    >
      <LogOut className="w-3.5 h-3.5" />
      離開示範
    </button>
  </div>
);
