export const MIXED_CONTENT_MESSAGE =
  'https 網頁無法連線 http 的 GitLab（瀏覽器會擋下混合內容），請改用本機 localhost 執行';

/**
 * 頁面為 https、目標 GitLab 為 http 時回傳提示訊息，否則回傳 null。
 * 只依協定判斷，不推測網路位置。
 */
export function getMixedContentWarning(
  targetUrl: string,
  pageProtocol: string | undefined = globalThis.location?.protocol
): string | null {
  if (pageProtocol !== 'https:') return null;
  return /^\s*http:\/\//i.test(targetUrl || '') ? MIXED_CONTENT_MESSAGE : null;
}
