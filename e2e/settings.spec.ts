/**
 * 正式模式的設定對話框：開關與儲存（存在本機 localStorage）。金鑰使用假值，外部請求一律被擋。
 */
import {expect, test} from './fixtures';

const FAKE_KEY = 'e2e-fake-gemini-key';

test('開啟、關閉與取消設定不會保存變更', async ({page}) => {
  await page.goto('/');
  const heading = page.getByRole('heading', {name: '偏好與整合設定'});
  const openButton = page.getByRole('banner').getByRole('button', {name: '填寫金鑰'});

  await openButton.click();
  await expect(heading).toBeVisible();
  await expect(page.getByRole('radio', {name: 'Google Gemini'})).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', {name: '關閉', exact: true}).click();
  await expect(heading).toBeHidden();

  await openButton.click();
  await page.getByLabel(/Google Gemini API Key/).fill(FAKE_KEY);
  await page.getByRole('button', {name: '取消'}).click();
  await expect(heading).toBeHidden();
  await expect(openButton).toBeVisible();

  await openButton.click();
  await expect(page.getByLabel(/Google Gemini API Key/)).toHaveValue('');
});

test('儲存設定後頁首改為偏好設定，重新整理仍保留', async ({page}) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', {name: '填寫金鑰'}).click();

  await page.getByLabel(/Google Gemini API Key/).fill(FAKE_KEY);
  await page.getByLabel('GitLab Base URL').fill('https://gitlab.example.com');
  await page.getByRole('button', {name: '儲存設定'}).click();

  await expect(page.getByRole('heading', {name: '偏好與整合設定'})).toBeHidden();
  const prefButton = page.getByRole('banner').getByRole('button', {name: '偏好設定'});
  await expect(prefButton).toBeVisible();

  await page.reload();
  await expect(prefButton).toBeVisible();
  await prefButton.click();
  await expect(page.getByLabel(/Google Gemini API Key/)).toHaveValue(FAKE_KEY);
  await expect(page.getByLabel('GitLab Base URL')).toHaveValue('https://gitlab.example.com');

  // 切換供應商只影響草稿，取消後不保存
  await page.getByRole('radio', {name: 'OpenAI', exact: true}).click();
  await expect(page.getByRole('radio', {name: 'OpenAI', exact: true})).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel(/OpenAI API Key/)).toHaveValue('');
  await page.getByRole('button', {name: '取消'}).click();
  await prefButton.click();
  await expect(page.getByRole('radio', {name: 'Google Gemini'})).toHaveAttribute('aria-checked', 'true');

});
