/**
 * 停用按鈕的原因提示：手機（觸控）沒有 hover，看不到 title。
 * 停用中的按鈕加上 disabled:pointer-events-none，點擊會落到外層 TapForReason，改為就地顯示原因。
 */
import React, { useCallback, useEffect, useState } from 'react';

export const DISABLED_REASON_TIMEOUT_MS = 3000;

export interface DisabledReasonHint<K> {
  key: K;
  message: string;
}

/** 目前顯示的原因（key 用來決定顯示在哪裡），數秒後自動消失 */
export function useDisabledReason<K>(timeoutMs = DISABLED_REASON_TIMEOUT_MS) {
  const [hint, setHint] = useState<DisabledReasonHint<K> | null>(null);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), timeoutMs);
    return () => clearTimeout(timer);
  }, [hint, timeoutMs]);
  const show = useCallback((key: K, message: string) => setHint({ key, message }), []);
  return [hint, show] as const;
}

interface TapForReasonProps {
  /** 按鈕停用的原因；null 表示目前可用（或停用但不需說明），點擊不做事 */
  reason: string | null;
  onReason: (reason: string) => void;
  className?: string;
  children: React.ReactNode;
}

/** 包住可能停用的按鈕；按鈕本身需有 disabled:pointer-events-none */
export const TapForReason: React.FC<TapForReasonProps> = ({ reason, onReason, className, children }) => (
  <span
    className={`inline-flex ${className ?? ''}`}
    onClick={(e) => {
      // 按鈕可用時點擊會先觸發按鈕本身再冒泡到這裡，只在停用（點擊直接落在外層）時顯示原因
      if (reason && e.target === e.currentTarget) onReason(reason);
    }}
  >
    {children}
  </span>
);

/** 就地顯示的原因文字 */
export const DisabledReasonText: React.FC<{ message: string; className?: string }> = ({ message, className }) => (
  <p role="status" className={`text-[11px] font-medium text-warning-text bg-warning-subtle border border-warning-border rounded px-2 py-1 ${className ?? ''}`}>
    {message}
  </p>
);
