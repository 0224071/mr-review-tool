/**
 * 共用 fixture：攔截所有非本機伺服器的請求並 abort，確保 E2E 不會打到真的 AI / GitLab API。
 * 個別測試若要模擬外部 API，再用 page.route 註冊（後註冊的 route 先比對）。
 */
import {expect, test as base} from '@playwright/test';

type Fixtures = {
  /** 被擋下的外部請求網址；測試可斷言為空，確認流程沒有嘗試連外 */
  blockedRequests: string[];
};

export const test = base.extend<Fixtures>({
  blockedRequests: async ({}, use) => {
    await use([]);
  },
  page: async ({page, baseURL, blockedRequests}, use) => {
    const appOrigin = new URL(baseURL!).origin;
    await page.route(
      (url) => url.origin !== appOrigin,
      (route) => {
        blockedRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      }
    );
    await use(page);
  },
});

export {expect};
