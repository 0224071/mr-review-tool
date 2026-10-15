/**
 * 示範模式（?demo=1）的分析結果：分組、審查意見、Diff 彈窗。假 provider 不發任何網路請求。
 */
import {expect, test} from './fixtures';

const RESULT_TITLE = 'feat(cart): 新增購物車折價券兌換與折抵計算功能';
const GROUPS = ['功能核心邏輯', 'API 服務層', 'UI 元件', '測試與驗證'];

test.beforeEach(async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.getByText('示範模式：分析和發布都是模擬的，不會連到 AI 或 GitLab')).toBeVisible();
  // 示範模式左欄已預先載入範例 diff
  await expect(page.getByRole('textbox', {name: /diff 將呈現於此/})).toHaveValue(/^diff --git /);
  await page.getByRole('button', {name: '分析', exact: true}).click();
  await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
});

test('顯示分析標題、模型標記與意圖分組', async ({page}) => {
  await expect(page.getByText('示範 · 範例分析')).toBeVisible();
  await expect(page.getByText('依意圖分組篩選')).toBeVisible();
  await expect(page.getByRole('button', {name: /^全部/})).toBeVisible();
  for (const name of GROUPS) {
    await expect(page.getByRole('button', {name: new RegExp(`^${name}`)})).toBeVisible();
  }
});

test('依分組篩選審查意見', async ({page}) => {
  const apiComment = page.getByText(/response\.json\(\) 將拋出解析異常/);
  const uiComment = page.getByText('輸入框缺少 aria-label 與關聯的 label 標籤。');
  await expect(apiComment).toBeVisible();
  await expect(uiComment).toBeVisible();

  await page.getByRole('button', {name: /^API 服務層/}).click();
  await expect(apiComment).toBeVisible();
  await expect(uiComment).toBeHidden();

  await page.getByRole('button', {name: /^全部/}).click();
  await expect(uiComment).toBeVisible();
});

test('審查意見顯示檔案、行號與操作按鈕', async ({page}) => {
  await expect(page.getByText('避免在非同步請求未完成前組件卸載造成狀態更新報錯。')).toBeVisible();
  await expect(page.getByRole('button', {name: /src\/hooks\/useCouponRedemption\.ts\s*:L19\s*（AI 標 L21）/})).toBeVisible();
  // 行號依程式碼片段修正；對不上 diff 的那則標示行號未驗證
  await expect(page.getByRole('button', {name: /^src\/tests\/discountCalculator\.test\.ts\s*:行號未驗證/})).toBeVisible();
  await expect(page.getByText('行號未驗證', {exact: true}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: '編輯草稿'}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: '複製意見'}).first()).toBeVisible();
});

test('展開程式碼片段後開啟完整檔案的 Diff 彈窗並關閉', async ({page}) => {
  await page.getByRole('button', {name: /^src\/api\/couponApi\.ts\s*:L17/}).click();
  await expect(page.getByText('問題行前後各 5 行變更')).toBeVisible();
  await page.getByRole('button', {name: '查看完整檔案'}).click();

  await expect(page.getByText('審查重點行: L17')).toBeVisible();
  await expect(page.getByText(/共 \d+ 行程式碼變更/)).toBeVisible();
  await expect(page.getByText('export async function validateCouponCode', {exact: false}).last()).toBeVisible();

  await page.getByRole('button', {name: '關閉', exact: true}).click();
  await expect(page.getByText('審查重點行: L17')).toBeHidden();
});

test('檔案分頁可開啟 Diff 彈窗', async ({page}) => {
  await page.getByRole('button', {name: '檔案', exact: true}).click();
  await page.getByRole('button', {name: '查看完整檔案'}).first().click();
  await expect(page.getByText(/共 \d+ 行程式碼變更/)).toBeVisible();
  await page.getByRole('button', {name: '關閉', exact: true}).click();
  await expect(page.getByText(/共 \d+ 行程式碼變更/)).toBeHidden();
});

test('示範中的設定對話框不顯示金鑰欄位', async ({page}) => {
  await page.getByRole('button', {name: '偏好設定'}).click();
  const dialog = page.getByRole('dialog', {name: '示範模式不使用金鑰'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/API Key/)).toHaveCount(0);
  await dialog.getByRole('button', {name: '繼續示範'}).click();
  await expect(dialog).toBeHidden();
});
