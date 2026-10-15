/**
 * 示範模式（?demo=1）的「全選」與「發布已選 N 則」（#40）：
 * 全選含行號未驗證的意見，內文是空的不勾；按鈕上的 N 與確認視窗的則數一致。只開確認視窗，不真的發布。
 */
import type {Page} from '@playwright/test';
import {expect, test} from './fixtures';

const RESULT_TITLE = 'feat(cart): 新增購物車折價券兌換與折抵計算功能';
const EMPTY_COMMENT_TITLE = '內文是空的，不會發布';

/** 每則意見前的勾選框（aria-pressed 的按鈕，名稱取自依狀態變化的 title） */
const checkboxes = (page: Page) =>
  page.getByRole('button', {name: /^(勾選此意見|內文是空的，不會發布|已發布過，勾選將重複發布)$/});
const checked = (page: Page) => page.getByRole('button', {pressed: true});
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
  const dialog = page.getByRole('dialog', {name: '確認發布審查意見至 GitLab'});
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
  await expect(page.getByText('這是示範結果，不會連到 AI 或 GitLab')).toBeVisible();
  await page.getByRole('button', {name: '分析', exact: true}).click();
  await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
});

test('全選勾到所有內文非空的意見（含行號未驗證），N 與確認視窗一致；清空一則後不勾、N 少 1', async ({page}) => {
  const total = await checkboxes(page).count();
  expect(total).toBeGreaterThan(1);

  // 一開始全部未勾，發布按鈕為 0 則且停用
  await expect(checked(page)).toHaveCount(0);
  await expect(publishButton(page)).toHaveText('發布已選 0 則');
  await expect(publishButton(page)).toBeDisabled();

  // 示範資料的意見內文都不是空的：全選後全部勾到，包含行號未驗證那則
  await selectAllButton(page).click();
  await expect(checked(page)).toHaveCount(total);
  await expect(page.getByRole('button', {name: EMPTY_COMMENT_TITLE})).toHaveCount(0);
  await expect(publishButton(page)).toHaveText(`發布已選 ${total} 則`);
  await expect(publishButton(page)).toBeEnabled();
  expect(await publishCount(page)).toBe(await checked(page).count());

  const first = await expectDialogCount(page, total);
  expect(first.general, '行號未驗證的意見應以一般留言列入').toBeGreaterThanOrEqual(1);
  // 取消後勾選維持不變
  await expect(checked(page)).toHaveCount(total);

  // 清空第一則意見的內文
  const textboxesBefore = await page.getByRole('textbox').count();
  await page.getByRole('button', {name: '編輯草稿'}).first().click();
  await expect(page.getByRole('textbox')).toHaveCount(textboxesBefore + 2);
  const commentBox = page.getByRole('textbox').nth(await commentTextboxIndex(page));
  const originalComment = await commentBox.inputValue();
  expect(originalComment.trim()).not.toBe('');
  await commentBox.fill('');
  await page.getByRole('button', {name: '完成編輯'}).click();

  const emptyBox = page.getByRole('button', {name: EMPTY_COMMENT_TITLE});
  await expect(emptyBox).toHaveCount(1);
  await expect(emptyBox).toBeDisabled();

  // 清空時已自動取消該則；為了驗證「全選」本身，先取消全選再全選
  if ((await checked(page).count()) > 0) {
    await selectAllButton(page).click();
    await expect(checked(page)).toHaveCount(0);
    await expect(publishButton(page)).toHaveText('發布已選 0 則');
  }
  await selectAllButton(page).click();
  await expect(checked(page)).toHaveCount(total - 1);
  await expect(emptyBox).toHaveAttribute('aria-pressed', 'false');
  await expect(publishButton(page)).toHaveText(`發布已選 ${total - 1} 則`);
  expect(await publishCount(page)).toBe(await checked(page).count());

  await expectDialogCount(page, total - 1);
});

/** 編輯模式出現的兩個輸入框依序是內文、建議；找出新增輸入框中的第一個（內文） */
async function commentTextboxIndex(page: Page) {
  const boxes = page.getByRole('textbox');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const value = await boxes.nth(i).inputValue();
    // 左欄 diff 輸入框以 diff --git 開頭；其餘非空的就是剛展開的內文
    if (value.trim() !== '' && !value.startsWith('diff --git ')) return i;
  }
  throw new Error('找不到意見內文輸入框');
}
