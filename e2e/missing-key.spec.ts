/**
 * 正式模式沒有金鑰就按「分析」：顯示引導，不發出任何請求。
 */
import {expect, test} from './fixtures';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name: '範例 Diff'}).click();
  await page.getByRole('button', {name: '分析', exact: true}).click();
});

test('顯示尚未設定金鑰的提示且不連外', async ({page}) => {
  const guide = page.getByRole('alert', {name: '尚未設定金鑰'});
  await expect(guide).toBeVisible();
  await expect(guide.getByText('尚未設定 Google Gemini API Key，還不能分析')).toBeVisible();
  await expect(guide.getByRole('button', {name: '用範例試試看'})).toBeVisible();
  await expect(guide.getByRole('button', {name: '填寫金鑰'})).toBeVisible();

  await guide.getByRole('button', {name: '關閉引導'}).click();
  await expect(guide).toBeHidden();
});

test('引導的「填寫金鑰」開啟設定', async ({page}) => {
  const guide = page.getByRole('alert', {name: '尚未設定金鑰'});
  await guide.getByRole('button', {name: '填寫金鑰'}).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole('heading', {name: '偏好與整合設定'})).toBeVisible();
  await expect(page.getByLabel(/Google Gemini API Key/)).toBeVisible();
});

test('引導的「用範例試試看」進入示範', async ({page}) => {
  await page.getByRole('alert', {name: '尚未設定金鑰'}).getByRole('button', {name: '用範例試試看'}).click();
  await expect(page).toHaveURL(/[?&]demo=1/);
  await expect(page.getByText('這是示範結果，不會連到 AI 或 GitLab')).toBeVisible();
});
