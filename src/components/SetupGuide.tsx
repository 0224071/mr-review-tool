import React from 'react';
import { FlaskConical, Key, X } from 'lucide-react';

interface SetupGuideProps {
  /** 目前缺少的設定，例如「尚未設定 Google Gemini API Key」 */
  notice: string | null;
  /** 未提供時不顯示「用範例試試看」 */
  onTryDemo?: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** 尚未設定金鑰就按「分析」時的引導：先用範例試試看，或去填寫金鑰 */
export const SetupGuide: React.FC<SetupGuideProps> = ({ notice, onTryDemo, onOpenSettings, onClose }) => (
  <div
    role="alert"
    aria-label="尚未設定金鑰"
    className="mb-4 p-4 bg-primary-subtle border border-primary-border rounded-xl text-xs flex items-start justify-between gap-3 shadow-xs"
  >
    <div className="flex items-start gap-2 min-w-0">
      <Key className="w-4 h-4 text-primary shrink-0 mt-0.5" />
      <div className="space-y-2 min-w-0">
        <div>
          <p className="font-semibold text-ink">{notice ?? '尚未設定 AI 金鑰'}，還不能分析</p>
          <p className="mt-0.5 text-muted-dark">
            可以先用範例看看完整流程（不需要金鑰、不會連線），或填寫金鑰分析自己的 MR。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onTryDemo && (
            <button
              type="button"
              onClick={onTryDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              用範例試試看
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary-border bg-surface text-primary hover:bg-primary-subtle font-semibold"
          >
            <Key className="w-3.5 h-3.5" />
            填寫金鑰
          </button>
        </div>
      </div>
    </div>
    <button type="button" onClick={onClose} aria-label="關閉引導" className="text-primary hover:text-primary-hover font-bold px-1">
      ✕
    </button>
  </div>
);
