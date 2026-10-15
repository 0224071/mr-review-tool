/**
 * 示範模式文案與提示（#45）：橫幅、空白狀態、手機頁首一行、全選旁提示、內文清空的卡片淡化、
 * 手機點停用按鈕時說明原因、確認視窗標題與預覽。桌機 1440、手機 390 都跑。
 */
import type {Locator, Page} from '@playwright/test';
import {expect, test} from './fixtures';

const RESULT_TITLE = 'feat(cart): 新增購物車折價券兌換與折抵計算功能';
const BANNER_TEXT = '示範模式：分析和發布都是模擬的，不會連到 AI 或 GitLab';
const BANNER_SHORT_TEXT = '示範模式：分析和發布都是模擬的';
const HOME_HINT = '已載入購物車範例 diff，按「分析」看範例結果。';
const CONFIRM_TITLE = '模擬發布（示範，不會送到 GitLab）';
const EMPTY_REASON = /內文是空的，所以不能勾選、複製或發布/;
/** 編輯框以 aria-labelledby 連到畫面上看得到的 label */
const COMMENT_BOX_LABEL = '意見評論內文 (Comment)：';

const DESKTOP = {width: 1440, height: 900};
const MOBILE = {width: 390, height: 844};

const checkboxes = (page: Page) => page.getByLabel(/^勾選此意見：/);
const cardOf = (el: Locator) => el.locator('xpath=ancestor::*[@tabindex="0"][1]');

/** 元素實際看到的不透明度（自己與所有祖先的 opacity 相乘） */
const effectiveOpacity = (el: Locator) =>
  el.evaluate((node) => {
    let opacity = 1;
    for (let n: Element | null = node; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return opacity;
  });

/** 等淡化的 transition 跑完再量 */
const expectOpacity = async (el: Locator, check: (opacity: number) => void) => {
  await expect.poll(async () => {
    try {
      check(await effectiveOpacity(el));
      return true;
    } catch {
      return false;
    }
  }).toBe(true);
};

/** 用滑鼠／觸控點元素中心（停用的按鈕不能用 locator.click，點擊會落到外層的 TapForReason） */
const tapCenter = async (page: Page, el: Locator, touch: boolean) => {
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

const analyze = async (page: Page) => {
  await page.getByRole('button', {name: '分析', exact: true}).click();
  await expect(page.getByRole('heading', {name: RESULT_TITLE})).toBeVisible();
};

const clearComment = async (page: Page, index: number) => {
  const card = cardOf(checkboxes(page).nth(index));
  await card.getByRole('button', {name: '編輯草稿'}).click();
  await card.getByLabel(COMMENT_BOX_LABEL).fill('');
  await card.getByRole('button', {name: '完成編輯'}).click();
  return card;
};

test.describe('桌機 1440', () => {
  test.use({viewport: DESKTOP});

  test('橫幅完整文案；頁首完整名稱與按鈕文字；空白狀態沒有「用範例試試看」', async ({page}) => {
    await page.goto('/?demo=1');
    await expect(page.getByText(BANNER_TEXT, {exact: true})).toBeVisible();
    await expect(page.getByText(BANNER_SHORT_TEXT, {exact: true})).toBeHidden();
    const header = page.getByRole('banner');
    await expect(header.getByRole('heading', {name: 'GitLab MR 講解與審查工具'})).toBeVisible();
    await expect(header.getByText('歷史紀錄', {exact: true})).toBeVisible();
    await expect(header.getByText('偏好設定', {exact: true})).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.getByText(HOME_HINT)).toBeVisible();
    await expect(main.getByText(/左側|右側/)).toHaveCount(0);
    await expect(main.getByRole('button', {name: '用範例試試看'})).toHaveCount(0);
  });

  test('全選旁有「勾選要發布的意見」；清空內文的卡片淡化；確認視窗標題與 trim 過的預覽', async ({page}) => {
    await page.goto('/?demo=1');
    await analyze(page);
    await expect(page.getByText('勾選要發布的意見', {exact: true})).toBeVisible();

    const card = await clearComment(page, 0);
    // 整張卡片的內容淡化（量元素與所有祖先 computed opacity 的乘積，不只看 class）
    for (const block of [
      card.getByText('修改建議：', {exact: true}),
      card.getByText('Bug 風險', {exact: true}),
      card.getByText('重大', {exact: true}),
      card.getByTitle(/程式碼片段$/),
    ]) {
      await expectOpacity(block, (o) => expect(o).toBeLessThanOrEqual(0.5));
    }
    // 提示、勾選框、編輯按鈕不淡化
    expect(await effectiveOpacity(card.getByText('內文是空的，不會發布', {exact: true}))).toBe(1);
    await expectOpacity(checkboxes(page).first(), (o) => expect(o).toBe(1));
    await card.hover();
    await expectOpacity(card.getByRole('button', {name: '編輯草稿'}), (o) => expect(o).toBe(1));
    expect(await effectiveOpacity(checkboxes(page).nth(1))).toBe(1);
    expect(await effectiveOpacity(cardOf(checkboxes(page).nth(1)).getByText('修改建議：', {exact: true}))).toBe(1);

    // 勾選框仍可點（停用中，點了說明原因）；編輯按鈕仍可點（進入編輯、淡化解除）
    await tapCenter(page, checkboxes(page).first(), false);
    await expect(card.getByText(EMPTY_REASON)).toBeVisible();
    await card.getByRole('button', {name: '編輯草稿'}).click();
    await expect(card.getByLabel(COMMENT_BOX_LABEL)).toBeVisible();
    await expectOpacity(card.getByTitle(/程式碼片段$/), (o) => expect(o).toBe(1));
    await card.getByRole('button', {name: '完成編輯'}).click();

    // 第二則改成前後有空白的內文：預覽顯示 trim 後的內文
    const second = cardOf(checkboxes(page).nth(1));
    await second.getByRole('button', {name: '編輯草稿'}).click();
    await second.getByLabel(COMMENT_BOX_LABEL).fill('   前後有空白的內文   ');
    await second.getByRole('button', {name: '完成編輯'}).click();
    await checkboxes(page).nth(1).click();
    await page.getByRole('button', {name: '發布已選 1 則'}).click();

    const dialog = page.getByRole('dialog', {name: CONFIRM_TITLE});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', {name: CONFIRM_TITLE})).toBeVisible();
    const preview = dialog.getByRole('listitem').getByText('前後有空白的內文');
    await expect(preview).toBeVisible();
    expect(await preview.textContent()).toBe('前後有空白的內文');
  });

  test('勾選框 aria-label 的檔名與行號，和畫面上檔名按鈕顯示的一致（不含 AI 原始行號）', async ({page}) => {
    await page.goto('/?demo=1');
    await analyze(page);
    const count = await checkboxes(page).count();
    expect(count).toBeGreaterThan(1);
    // 範例裡有 AI 行號被修正的意見（畫面顯示「（AI 標 Lx）」），確保有測到這種情況
    await expect(page.getByText(/^（AI 標 L\d+）$/).first()).toBeVisible();
    for (let i = 0; i < count; i++) {
      const checkbox = checkboxes(page).nth(i);
      // 畫面上看到的「檔名:行號」：檔名按鈕的文字去掉「（AI 標 Lx）」
      const shown = await cardOf(checkbox)
        .getByTitle(/程式碼片段$/)
        .evaluate((btn) =>
          Array.from(btn.querySelectorAll(':scope > span'))
            .filter((span) => !span.getAttribute('title')?.startsWith('AI 原本標示'))
            .map((span) => span.textContent)
            .join('')
        );
      expect(shown).toMatch(/:(L\d+|行號未驗證)$/);
      await expect(checkbox).toHaveAttribute('aria-label', `勾選此意見：${shown}`);
    }
  });
});

test.describe('手機 390', () => {
  test.use({viewport: MOBILE, hasTouch: true});

  test('頁首一行：只放 logo 與「MR 審查」，按鈕只有圖示但保有名稱；橫幅改短文案、一行', async ({page}) => {
    await page.goto('/?demo=1');
    const header = page.getByRole('banner');
    const title = header.getByRole('heading', {name: 'MR 審查'});
    await expect(title).toBeVisible();
    expect((await title.boundingBox())!.height).toBeLessThan(30);
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(65);

    const history = header.getByRole('button', {name: /^歷史紀錄/});
    const settings = header.getByRole('button', {name: /^(偏好設定|填寫金鑰)$/});
    await expect(history).toBeVisible();
    await expect(settings).toBeVisible();
    await expect(header.getByText('歷史紀錄', {exact: true})).toBeHidden();
    await expect(header.getByText(/^(偏好設定|填寫金鑰)$/)).toBeHidden();
    for (const button of [history, settings]) expect((await button.boundingBox())!.height).toBeLessThan(40);

    const banner = page.getByRole('status').filter({hasText: BANNER_SHORT_TEXT});
    await expect(page.getByText(BANNER_SHORT_TEXT, {exact: true})).toBeVisible();
    await expect(page.getByText(BANNER_TEXT, {exact: true})).toBeHidden();
    expect((await banner.boundingBox())!.height).toBeLessThan(40);

    await expect(page.getByRole('main').getByText(HOME_HINT)).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', {name: '用範例試試看'})).toHaveCount(0);
  });

  test('只點停用的「複製」：卡片內出現它自己的原因提示', async ({page}) => {
    await page.goto('/?demo=1');
    await analyze(page);
    const card = await clearComment(page, 0);
    const copy = card.getByRole('button', {name: '複製意見'});
    await expect(copy).toBeDisabled();
    await expect(card.getByText(EMPTY_REASON)).toHaveCount(0);

    await tapCenter(page, copy, true);
    await expect(card.getByText(EMPTY_REASON)).toBeVisible();
    // 只有這張卡片出現提示，發布列沒有
    await expect(page.getByText(EMPTY_REASON)).toHaveCount(1);
    await expect(page.getByRole('region', {name: '發布列'}).getByRole('status')).toHaveCount(0);
  });

  test('整張淡化卡片：修改建議與標籤淡化，勾選框與編輯按鈕不淡化', async ({page}) => {
    await page.goto('/?demo=1');
    await analyze(page);
    const card = await clearComment(page, 0);
    for (const block of [card.getByText('修改建議：', {exact: true}), card.getByText('Bug 風險', {exact: true})]) {
      await expectOpacity(block, (o) => expect(o).toBeLessThanOrEqual(0.5));
    }
    await expectOpacity(checkboxes(page).first(), (o) => expect(o).toBe(1));
    await expectOpacity(card.getByRole('button', {name: '編輯草稿'}), (o) => expect(o).toBe(1));
  });

  test('點停用的勾選框、「發布已選 0 則」時，就地說明原因', async ({page}) => {
    await page.goto('/?demo=1');
    await analyze(page);

    const publish = page.getByRole('button', {name: '發布已選 0 則'});
    await expect(publish).toBeDisabled();
    await publish.scrollIntoViewIfNeeded();
    const pb = (await publish.boundingBox())!;
    await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await expect(page.getByRole('region', {name: '發布列'}).getByText('先在清單勾選要發布的意見')).toBeVisible();

    const card = await clearComment(page, 0);
    const checkbox = checkboxes(page).first();
    await expect(checkbox).toBeDisabled();
    await checkbox.scrollIntoViewIfNeeded();
    const cb = (await checkbox.boundingBox())!;
    await page.touchscreen.tap(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await expect(card.getByText(EMPTY_REASON)).toBeVisible();
    // 數秒後自動消失
    await expect(card.getByText(EMPTY_REASON)).toBeHidden({timeout: 6000});
  });
});
