/**
 * 示範模式的網址判斷與切換：?demo=1 進入；離開時以 history.replaceState 移除參數（不新增瀏覽紀錄）。
 */
export const DEMO_QUERY_PARAM = 'demo';
/** 示範模式下所有「發布」結果與確認視窗上的標註 */
export const DEMO_NOTICE = '示範，未實際發布';
export const DEMO_BANNER_TEXT = '這是示範結果，不會連到 AI 或 GitLab';

type HistoryLike = Pick<History, 'replaceState' | 'state'>;

export function isDemoSearch(search: string): boolean {
  return new URLSearchParams(search).get(DEMO_QUERY_PARAM) === '1';
}

/** 回傳加上或移除 demo 參數後的網址（保留其他參數與 hash） */
export function demoUrl(href: string, enabled: boolean): string {
  const url = new URL(href);
  if (enabled) url.searchParams.set(DEMO_QUERY_PARAM, '1');
  else url.searchParams.delete(DEMO_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 進入示範：網址補上 ?demo=1，重新整理時從頭開始示範 */
export function markDemoInUrl(history: HistoryLike = window.history, href: string = window.location.href): void {
  history.replaceState(history.state, '', demoUrl(href, true));
}

/** 離開示範：移除 ?demo=1 */
export function clearDemoFromUrl(history: HistoryLike = window.history, href: string = window.location.href): void {
  history.replaceState(history.state, '', demoUrl(href, false));
}
