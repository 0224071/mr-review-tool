/**
 * 共用 fixture：在 BrowserContext 層級攔截所有非本機伺服器的請求並 abort（新開分頁也擋得到），
 * 確保 E2E 不會打到真的 AI / GitLab API；每支測試結束時自動斷言沒有被擋下的請求。
 * 個別測試若要模擬外部 API，再用 page.route 註冊（page 層級的 route 優先於 context 層級）。
 * GitLab 只模擬 GET（用 mockGitLabGet）；打到 gitlab.com 的非 GET 請求不論是否被某個 route 處理，
 * 都會由 request 監聽記入 blockedRequests，確保測試不會真的寫入 MR。
 */
import {expect, test as base} from '@playwright/test';
import type {Page, Request, Route} from '@playwright/test';

type Fixtures = {
  /** 被擋下的外部請求網址；teardown 時自動斷言為空，確認流程沒有嘗試連外 */
  blockedRequests: string[];
};

const GITLAB_HOST = 'gitlab.com';

/** 打到 gitlab.com 的寫入請求（CORS preflight 由瀏覽器自動發出，不算應用程式送出的寫入） */
function isGitLabWrite(request: Request): boolean {
  const url = new URL(request.url());
  if (url.hostname !== GITLAB_HOST) return false;
  const method = request.method();
  if (method === 'GET') return false;
  const isPreflight = method === 'OPTIONS' && !!request.headers()['access-control-request-method'];
  return !isPreflight;
}

export const test = base.extend<Fixtures>({
  blockedRequests: async ({}, use) => {
    await use([]);
  },
  context: async ({context, baseURL, blockedRequests}, use) => {
    const appOrigin = new URL(baseURL!).origin;
    // 監聽所有請求：即使某個 page.route 誤把 GitLab 寫入請求 fulfill 掉，也會被記下
    context.on('request', (request) => {
      if (isGitLabWrite(request)) blockedRequests.push(`${request.method()} ${request.url()}`);
    });
    await context.route(
      (url) => url.origin !== appOrigin,
      (route) => {
        // GitLab 寫入請求已由上方監聽記錄，這裡只擋不重複記
        if (!isGitLabWrite(route.request())) blockedRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      }
    );
    await use(context);
    expect(blockedRequests, '測試期間不應有被擋下的外部請求').toEqual([]);
  },
});

/** 模擬 GitLab 回應的內容；回傳 undefined 代表沒有對應的模擬，交給 context 層級擋下 */
export type GitLabGetHandler = (url: URL) => {status?: number; json?: unknown; text?: string} | undefined;

/**
 * 在 page 層級模擬 https://gitlab.com 的 GET API；非 GET 一律 fallback 到 context 層級擋下並記錄。
 * 回應帶 CORS header，讓跨來源 fetch 讀得到內容。
 */
export async function mockGitLabGet(page: Page, handler: GitLabGetHandler) {
  await page.route(`https://${GITLAB_HOST}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.fallback();
    const response = handler(new URL(request.url()));
    if (!response) return route.fallback();
    const isJson = response.json !== undefined;
    await route.fulfill({
      status: response.status ?? 200,
      contentType: isJson ? 'application/json' : 'text/plain',
      headers: {'access-control-allow-origin': '*'},
      body: isJson ? JSON.stringify(response.json) : (response.text ?? ''),
    });
  });
}

export {expect};
