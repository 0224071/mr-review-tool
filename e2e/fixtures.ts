/**
 * 共用 fixture：在 BrowserContext 層級攔截所有非本機伺服器的請求並 abort（新開分頁也擋得到），
 * 確保 E2E 不會打到真的 AI / GitLab API；每支測試結束時自動斷言沒有被擋下的請求。
 * 個別測試若要模擬外部 API，再用 page.route 註冊（page 層級的 route 優先於 context 層級）。
 */
import {expect, test as base} from '@playwright/test';

type Fixtures = {
  /** 被擋下的外部請求網址；teardown 時自動斷言為空，確認流程沒有嘗試連外 */
  blockedRequests: string[];
};

export const test = base.extend<Fixtures>({
  blockedRequests: async ({}, use) => {
    await use([]);
  },
  context: async ({context, baseURL, blockedRequests}, use) => {
    const appOrigin = new URL(baseURL!).origin;
    await context.route(
      (url) => url.origin !== appOrigin,
      (route) => {
        blockedRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      }
    );
    await use(context);
    expect(blockedRequests, '測試期間不應有被擋下的外部請求').toEqual([]);
  },
});

export {expect};
