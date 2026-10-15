/**
 * 示範模式（?demo=1）的版面（#41、#43）：浮動發布列不蓋住意見、hover 時操作按鈕不壓到空內文提示、
 * 手機 MR 標題與桌機意見內文欄的寬度。示範與正式模式共用同一套元件。
 */
import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures';

const RESULT_TITLE = 'feat(cart): 新增購物車折價券兌換與折抵計算功能';
const EMPTY_COMMENT_MESSAGE = '內文是空的，不會發布';
const RESTORED_COMMENT = '補回的內文：這一行需要補上錯誤處理，避免例外未被捕捉';

const DESKTOP = {width: 1440, height: 900};
const MOBILE = {width: 390, height: 844};

/** 每則意見前的勾選框（aria-label「勾選此意見：檔名:行號」） */
const checkboxes = (page: Page) => page.getByLabel(/^勾選此意見：/);
const publishBar = (page: Page) => page.getByRole('region', {name: '發布列'});
/** 勾選框所在的意見卡片 */
const cardOf = (el: Locator) => el.locator('xpath=ancestor::*[@tabindex="0"][1]');
const actionButtons = (card: Locator) => card.getByRole('button', {name: /^(編輯草稿|還原原始意見|複製意見|發布單則)$/});

type Box = {x: number; y: number; width: number; height: number};
const box = async (el: Locator): Promise<Box> => {
  const b = await el.boundingBox();
  expect(b, '元素應有 bounding box').not.toBeNull();
  return b!;
};
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const openDemoResult = async (page: Page) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', {name: '分析', exact: true}).click();
  await expect(page.getByRole('heading', {name: RESULT_TITLE})).toBeVisible();
  await expect(publishBar(page)).toBeVisible();
};

/** 編輯第 index 則意見並把內文改成 text（空字串即清空） */
const setComment = async (page: Page, index: number, text: string) => {
  const card = cardOf(checkboxes(page).nth(index));
  await card.getByRole('button', {name: '編輯草稿'}).click();
  await card.getByLabel('意見評論內文 (Comment)：').fill(text);
  await card.getByRole('button', {name: '完成編輯'}).click();
  return card;
};

for (const [label, viewport] of [['桌機 1440', DESKTOP], ['手機 390', MOBILE]] as const) {
  test.describe(label, () => {
    test.use({viewport});

    test('鍵盤逐一聚焦每則意見時，勾選框都不會被浮動發布列蓋住', async ({page}) => {
      await openDemoResult(page);
      const n = await checkboxes(page).count();
      expect(n).toBeGreaterThan(1);
      for (let i = 0; i < n; i++) {
        const checkbox = checkboxes(page).nth(i);
        await checkbox.focus();
        await expect(checkbox).toBeInViewport({ratio: 1});
        expect(overlaps(await box(checkbox), await box(publishBar(page))), `第 ${i + 1} 則勾選框被發布列蓋住`).toBe(false);
      }
    });

    test('捲到最後一則可以完整看到，不和發布列重疊', async ({page}) => {
      await openDemoResult(page);
      const last = cardOf(checkboxes(page).last());
      await checkboxes(page).last().focus();
      // 在清單上往下捲到底（先捲清單本身，再捲頁面）
      const b = await box(last);
      await page.mouse.move(b.x + b.width / 2, Math.min(b.y + 10, viewport.height / 2));
      for (let i = 0; i < 15; i++) await page.mouse.wheel(0, 400);
      await expect(last).toBeInViewport({ratio: 1});
      expect(overlaps(await box(last), await box(publishBar(page))), '最後一則被發布列蓋住').toBe(false);
    });
  });
}

test.describe('桌機 1440', () => {
  test.use({viewport: DESKTOP});

  test('hover 內文空了的卡片時，右側操作按鈕不壓到「內文是空的，不會發布」', async ({page}) => {
    await openDemoResult(page);
    const n = await checkboxes(page).count();
    for (let i = 0; i < n; i++) {
      const card = await setComment(page, i, '');
      const hint = card.getByText(EMPTY_COMMENT_MESSAGE, {exact: true});
      await card.hover();
      await expect(hint).toBeVisible();
      const hintBox = await box(hint);
      const cardBox = await box(card);
      expect(hintBox.x + hintBox.width, '提示超出卡片').toBeLessThanOrEqual(cardBox.x + cardBox.width);
      const buttons = actionButtons(card);
      await expect(buttons.first()).toBeVisible();
      for (let j = 0; j < (await buttons.count()); j++) {
        expect(overlaps(await box(buttons.nth(j)), hintBox), `第 ${i + 1} 則的操作按鈕壓到提示`).toBe(false);
      }
      await card.getByRole('button', {name: '還原原始意見'}).click();
      await expect(hint).toBeHidden();
    }
  });

  test('意見內文欄佔滿卡片寬度（補回內文後也不會被擠窄）', async ({page}) => {
    await openDemoResult(page);
    await setComment(page, 0, '');
    await setComment(page, 0, RESTORED_COMMENT);
    const body = page.getByText(RESTORED_COMMENT, {exact: true});
    await expect(body).toBeVisible();
    // 修正前約 106px（夾在檔名標籤與操作按鈕之間）
    expect((await box(body)).width).toBeGreaterThanOrEqual(400);
    // 標題在桌機維持同一行顯示（修正前後皆約 337px）
    expect((await box(page.getByRole('heading', {name: RESULT_TITLE}))).height).toBeLessThan(30);
  });
});

test.describe('手機 390', () => {
  test.use({viewport: MOBILE});

  test('MR 標題不被分析時間與示範標籤擠窄', async ({page}) => {
    await openDemoResult(page);
    const title = await box(page.getByRole('heading', {name: RESULT_TITLE}));
    // 修正前約 68px（一行 3–4 字）
    expect(title.width).toBeGreaterThanOrEqual(200);
    // 示範標籤換到標題下一行
    const tag = await box(page.getByText('示範 · 範例分析', {exact: true}));
    expect(tag.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  });

  test('空內文提示在檔名下方獨立一行，完整顯示', async ({page}) => {
    await openDemoResult(page);
    const card = await setComment(page, 0, '');
    const hint = card.getByText(EMPTY_COMMENT_MESSAGE, {exact: true});
    await expect(hint).toBeVisible();
    const fileChip = await box(card.getByRole('button', {name: /\.tsx? :L\d+/}));
    const hintBox = await box(hint);
    expect(hintBox.y).toBeGreaterThanOrEqual(fileChip.y + fileChip.height - 1);
    expect(await hint.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(hintBox.x + hintBox.width).toBeLessThanOrEqual((await box(card)).x + (await box(card)).width);
  });
});
