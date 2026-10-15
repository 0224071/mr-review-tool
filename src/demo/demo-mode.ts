/**
 * 示範模式的網址判斷與切換：?demo=1 進入；離開時以 history.replaceState 移除參數（不新增瀏覽紀錄）。
 */
export const DEMO_QUERY_PARAM = 'demo';
/** 示範模式下所有「發布」結果與確認視窗上的標註 */
export const DEMO_NOTICE = '示範，未實際發布';
export const DEMO_BANNER_TEXT = '示範模式：分析和發布都是模擬的，不會連到 AI 或 GitLab';
/** 手機窄螢幕的橫幅短版，只留一行 */
export const DEMO_BANNER_SHORT_TEXT = '示範模式：分析和發布都是模擬的';
/** 示範模式空白首頁的說明（不提 diff 在哪一側：手機版輸入區在上方） */
export const DEMO_HOME_HINT = '已載入購物車範例 diff，按「分析」看範例結果。';
/** 示範模式發布確認視窗的標題 */
export const DEMO_PUBLISH_CONFIRM_TITLE = '模擬發布（示範，不會送到 GitLab）';

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
