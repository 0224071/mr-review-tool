/**
 * 歷史抽屜（正式模式，IndexedDB）：以 page.route 模擬 Gemini 回應完成一次分析，
 * 紀錄寫入後可在抽屜看到、重新整理後仍在、可開啟與刪除。
 */
import type {Page, Route} from '@playwright/test';
import {SAMPLE_ANALYSIS_RESULT} from '../src/services/diff-sources/sample-analysis';
import {expect, test} from './fixtures';

const RESULT_TITLE = SAMPLE_ANALYSIS_RESULT.title;

/** 模擬 Gemini generateContent：主要分析回傳範例結果，補查（schema 沒有 groups）回傳空結果 */
async function mockGemini(page: Page, calls: string[]) {
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    const request = route.request();
    calls.push(new URL(request.url()).pathname);
    if (!request.url().includes(':generateContent')) return route.abort('blockedbyclient');
    const body = request.postDataJSON() as {generationConfig?: {responseSchema?: {required?: string[]}}};
    const isAnalysis = body.generationConfig?.responseSchema?.required?.includes('groups') ?? false;
    const output = isAnalysis ? SAMPLE_ANALYSIS_RESULT : {checklistCoverage: [], reviews: []};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify(output)}]}}]}),
    });
  });
}

async function saveFakeKey(page: Page) {
  await page.getByRole('banner').getByRole('button', {name: '填寫金鑰'}).click();
  await page.getByLabel(/Google Gemini API Key/).fill('e2e-fake-gemini-key');
  await page.getByRole('button', {name: '儲存設定'}).click();
  await expect(page.getByRole('banner').getByRole('button', {name: '偏好設定'})).toBeVisible();
}

test('一開始沒有紀錄，開關抽屜', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: /歷史紀錄/}).click();
  const drawer = page.getByRole('complementary', {name: '歷史紀錄'});
  await expect(drawer.getByText('還沒有任何紀錄')).toBeVisible();
  await drawer.getByRole('button', {name: '關閉'}).click();
  await expect(page.getByText('還沒有任何紀錄')).toBeHidden();
});

test('分析後寫入歷史紀錄，重新整理後可從抽屜開啟並刪除', async ({page}) => {
  const geminiCalls: string[] = [];
  await mockGemini(page, geminiCalls);
  await page.goto('/');
  await saveFakeKey(page);

  await page.getByRole('button', {name: '範例 Diff'}).click();
  await page.getByRole('button', {name: '分析', exact: true}).click();
  await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
  expect(geminiCalls.length).toBeGreaterThan(0);
  expect(geminiCalls.every((p) => p.endsWith(':generateContent'))).toBe(true);

  const historyButton = page.getByRole('button', {name: /歷史紀錄\s*1/});
  await expect(historyButton).toBeVisible();

  // 重新整理後紀錄仍在（IndexedDB）
  await page.reload();
  await historyButton.click();
  const drawer = page.getByRole('complementary', {name: '歷史紀錄'});
  await expect(drawer.getByRole('heading', {name: /歷史紀錄\s*（1）/})).toBeVisible();
  await expect(drawer.getByText('範例 Diff')).toBeVisible();
  await expect(drawer.getByText(`${SAMPLE_ANALYSIS_RESULT.reviews.length} 則`)).toBeVisible();

  await drawer.getByRole('button', {name: /範例 Diff/}).click();
  await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();

  await historyButton.click();
  await drawer.getByRole('button', {name: '刪除', exact: true}).click();
  await page.getByRole('alertdialog', {name: '刪除這筆紀錄？'}).getByRole('button', {name: '刪除'}).click();
  await expect(drawer.getByText('還沒有任何紀錄')).toBeVisible();
  await expect(page.getByRole('button', {name: /歷史紀錄\s*0/})).toBeVisible();
});
