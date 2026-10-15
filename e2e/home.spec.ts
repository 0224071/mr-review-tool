import {expect, test} from './fixtures';

test.describe('首頁', () => {
  test('顯示標題、輸入區與「用範例試試看」', async ({page}) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
    await expect(page.getByRole('heading', {name: 'GitLab MR 講解與審查工具'})).toBeVisible();
    await expect(page.getByRole('button', {name: '範例 Diff'})).toBeVisible();
    await expect(page.getByRole('button', {name: '分析', exact: true})).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', {name: '用範例試試看'})).toBeVisible();
    // 尚未設定金鑰時頁首顯示「填寫金鑰」
    await expect(page.getByRole('banner').getByRole('button', {name: '填寫金鑰'})).toBeVisible();
  });

  test('載入範例 diff 會填入輸入區', async ({page}) => {
    await page.goto('/');
    const diffInput = page.getByRole('textbox', {name: /diff 將呈現於此/});
    await expect(diffInput).toHaveValue('');
    await page.getByRole('button', {name: '範例 Diff'}).click();
    await expect(diffInput).toHaveValue(/^diff --git a\/src\/api\/couponApi\.ts/);
    await expect(diffInput).toHaveValue(/calculateFinalTotal/);
  });

  test('首頁「用範例試試看」進入示範模式並在網址加上 ?demo=1', async ({page}) => {
    await page.goto('/');
    await page.getByRole('main').getByRole('button', {name: '用範例試試看'}).click();
    await expect(page).toHaveURL(/[?&]demo=1/);
    await expect(page.getByRole('status').filter({hasText: '示範模式：分析和發布都是模擬的，不會連到 AI 或 GitLab'})).toBeVisible();
  });
});
