/**
 * 示範模式（?demo=1）的「全選」與「發布已選 N 則」（#40）：
 * 全選含行號未驗證的意見，內文是空的不勾；按鈕上的 N 與確認視窗的則數一致。只開確認視窗，不真的發布。
 */
import type {Page} from '@playwright/test';
import {expect, test} from './fixtures';

const RESULT_TITLE = 'feat(cart): 新增購物車折價券兌換與折抵計算功能';
const CONFIRM_TITLE = '模擬發布（示範，不會送到 GitLab）';

/** 每則意見前的勾選框（aria-label「勾選此意見：檔名:行號」） */
const checkboxes = (page: Page) => page.getByLabel(/^勾選此意見：/);
/** 已勾選的勾選框：只在勾選框裡找，不會算到其他 aria-pressed 的按鈕 */
const checked = (page: Page) => checkboxes(page).and(page.locator('[aria-pressed="true"]'));
const publishButton = (page: Page) => page.getByRole('button', {name: /^發布已選 \d+ 則$/});
const selectAllButton = (page: Page) => page.getByRole('button', {name: '全選', exact: true});

const publishCount = async (page: Page) => {
  const name = (await publishButton(page).textContent()) ?? '';
  const m = name.match(/發布已選\s*(\d+)\s*則/);
  if (!m) throw new Error(`讀不到發布按鈕的則數：「${name}」`);
  return Number(m[1]);
};

/** 打開確認視窗，核對「將送出的審查意見 (N 則)」與「行內 X · 一般留言 Y」，再取消 */
const expectDialogCount = async (page: Page, n: number) => {
  await publishButton(page).click();
  const dialog = page.getByRole('dialog', {name: CONFIRM_TITLE});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`將送出的審查意見 (${n} 則)：`)).toBeVisible();

  const split = dialog.getByText(/^行內 \d+ · 一般留言 \d+$/);
  const m = ((await split.textContent()) ?? '').match(/行內 (\d+) · 一般留言 (\d+)/);
  expect(m, '確認視窗應顯示行內／一般留言則數').not.toBeNull();
  const [inline, general] = [Number(m![1]), Number(m![2])];
  expect(inline + general).toBe(n);

  await dialog.getByRole('button', {name: '取消', exact: true}).click();
  await expect(dialog).toBeHidden();
  return {inline, general};
};

test.beforeEach(async ({page}) => {
  await page.goto('/?demo=1');
  await expect(page.getByText('示範模式：分析和發布都是模擬的，不會連到 AI 或 GitLab')).toBeVisible();
  await page.getByRole('button', {name: '分析', exact: true}).click();
  await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
});

test('全選勾到所有內文非空的意見（含行號未驗證），N 與確認視窗一致；清空一則後自動取消、N 少 1', async ({page}) => {
  const total = await checkboxes(page).count();
  expect(total).toBeGreaterThan(1);

  // 一開始全部未勾，發布按鈕為 0 則且停用
  await expect(checked(page)).toHaveCount(0);
  await expect(publishButton(page)).toHaveText('發布已選 0 則');
  await expect(publishButton(page)).toBeDisabled();

  // 示範資料的意見內文都不是空的：全選後全部勾到，包含行號未驗證那則
  await selectAllButton(page).click();
  await expect(checked(page)).toHaveCount(total);
  await expect(checkboxes(page).and(page.locator(':disabled'))).toHaveCount(0);
  await expect(publishButton(page)).toHaveText(`發布已選 ${total} 則`);
  await expect(publishButton(page)).toBeEnabled();
  expect(await publishCount(page)).toBe(await checked(page).count());

  const first = await expectDialogCount(page, total);
  expect(first.general, '行號未驗證的意見應以一般留言列入').toBeGreaterThanOrEqual(1);
  // 取消後勾選維持不變
  await expect(checked(page)).toHaveCount(total);

  // 清空第一則意見的內文
  const firstCheckbox = checkboxes(page).first();
  await page.getByRole('button', {name: '編輯草稿'}).first().click();
  const commentBox = page.getByLabel('意見評論內文 (Comment)：');
  await expect(commentBox).toHaveCount(1);
  expect((await commentBox.inputValue()).trim()).not.toBe('');
  await commentBox.fill('');
  await page.getByRole('button', {name: '完成編輯'}).click();

  // 清空時自動取消勾選那一則：勾選數立即變成 total − 1
  await expect(checked(page)).toHaveCount(total - 1);
  await expect(firstCheckbox).toBeDisabled();
  await expect(firstCheckbox).toHaveAttribute('aria-pressed', 'false');
  await expect(publishButton(page)).toHaveText(`發布已選 ${total - 1} 則`);

  // 「全選」本身也不勾空內文那則：取消全選後再全選
  await selectAllButton(page).click();
  await expect(checked(page)).toHaveCount(0);
  await expect(publishButton(page)).toHaveText('發布已選 0 則');
  await selectAllButton(page).click();
  await expect(checked(page)).toHaveCount(total - 1);
  await expect(firstCheckbox).toHaveAttribute('aria-pressed', 'false');
  await expect(publishButton(page)).toHaveText(`發布已選 ${total - 1} 則`);
  expect(await publishCount(page)).toBe(await checked(page).count());

  await expectDialogCount(page, total - 1);
});
