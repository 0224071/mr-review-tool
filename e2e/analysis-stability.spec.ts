/**
 * #71 共享與分析流程穩定性：
 * - 共享標記帶不認得的 category 時不白畫面，顯示預設分類「其他」
 * - 有（模擬的）AI 金鑰時，連點「分析」只呼叫 AI 一次，且沒有任何寫入 GitLab 或其他非 GET 請求
 * - 過期共享報告卡片的「重新分析」先重新抓 MR 再分析
 * - 390 寬度下確認視窗副標題與過期卡片內文的句尾不會單字掉行；第一次共享的確認視窗維持藍框
 * GitLab 只以 mockGitLabGet 模擬 GET；AI 以 page.route 模擬 Gemini，金鑰與 Token 都是 FAKE- 假值。
 */
import type {Locator, Page, Request, Route} from '@playwright/test';
import {SAMPLE_GIT_DIFF} from '../src/services/diff-sources/sample-diffs';
import {SAMPLE_ANALYSIS_RESULT} from '../src/services/diff-sources/sample-analysis';
import {expect, mockGitLabGet, test} from './fixtures';

const PROJECT_PATH = 'e2e-group/analysis-stability';
const MR_IID = 71;
const MR_URL = `https://gitlab.com/${PROJECT_PATH}/-/merge_requests/${MR_IID}`;
const MR_API_PATH = `/api/v4/projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests/${MR_IID}`;
const MR_TITLE = 'E2E 分析流程穩定性';
const RESULT_TITLE = SAMPLE_ANALYSIS_RESULT.title;
const OLD_HEAD_SHA = 'a1'.repeat(20);
const NEW_HEAD_SHA = 'b2'.repeat(20);
const GEMINI_HOST = 'generativelanguage.googleapis.com';

function mrInfo(headSha: string) {
  return {
    id: 1071,
    iid: MR_IID,
    project_id: 42,
    title: MR_TITLE,
    description: '',
    state: 'opened',
    created_at: '2026-09-30T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    web_url: MR_URL,
    source_branch: 'feature/coupon',
    target_branch: 'main',
    author: {id: 9, name: 'Reviewer Bot', username: 'reviewer-bot'},
    diff_refs: {base_sha: 'c3'.repeat(20), start_sha: 'c3'.repeat(20), head_sha: headSha},
  };
}

/** 依產品的分享留言格式組出 note body */
function sharedNoteBody(extra: Record<string, unknown> = {}) {
  const json = JSON.stringify({...SAMPLE_ANALYSIS_RESULT, ...extra}, null, 2);
  return [
    '### 🤖 GitLab MR AI 講解與審查報告',
    '',
    '<!-- GITLAB_MR_REVIEWER_START v=1 -->',
    '```json',
    json,
    '```',
    '<!-- GITLAB_MR_REVIEWER_END -->',
  ].join('\n');
}

function note(body: string) {
  return {
    id: 501,
    body,
    author: {id: 9, name: 'Reviewer Bot', username: 'reviewer-bot'},
    created_at: '2026-10-01T08:00:00Z',
    system: false,
  };
}

/** 模擬此 MR 的 GET API，並記錄 MR 資訊被抓了幾次；回傳物件的 headSha 每次請求時讀取，可改值模擬 MR 有新 commit */
async function mockMr(page: Page, {headSha, notes}: {headSha: string; notes: unknown[]}) {
  const counts = {mr: 0, headSha};
  await mockGitLabGet(page, (url) => {
    if (url.pathname === MR_API_PATH) {
      counts.mr += 1;
      return {json: mrInfo(counts.headSha)};
    }
    if (url.pathname === `${MR_API_PATH}/raw_diffs`) return {text: SAMPLE_GIT_DIFF};
    if (url.pathname === `${MR_API_PATH}/notes`) return {json: notes};
    if (url.pathname === '/api/v4/user') return {json: {id: 9, username: 'reviewer-bot', name: 'Reviewer Bot'}};
    return undefined;
  });
  return counts;
}

/**
 * 模擬 Gemini generateContent：主要分析回傳範例結果、補查回傳空結果；回應前稍等，讓連點落在分析進行中。
 * 回傳的陣列記錄每次請求的種類（analysis／recheck）。
 */
async function mockGemini(page: Page) {
  const calls: {kind: 'analysis' | 'recheck'; method: string}[] = [];
  await page.route(`https://${GEMINI_HOST}/**`, async (route: Route) => {
    const request = route.request();
    if (!request.url().includes(':generateContent')) return route.fallback();
    const body = request.postDataJSON() as {generationConfig?: {responseSchema?: {required?: string[]}}};
    const isAnalysis = body.generationConfig?.responseSchema?.required?.includes('groups') ?? false;
    calls.push({kind: isAnalysis ? 'analysis' : 'recheck', method: request.method()});
    await new Promise((r) => setTimeout(r, 400));
    const output = isAnalysis ? SAMPLE_ANALYSIS_RESULT : {checklistCoverage: [], reviews: []};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {'access-control-allow-origin': '*'},
      body: JSON.stringify({candidates: [{content: {parts: [{text: JSON.stringify(output)}]}}]}),
    });
  });
  return calls;
}

/** 記錄所有非 GET 請求（不含瀏覽器自動送出的 CORS preflight） */
function trackNonGetRequests(page: Page): string[] {
  const nonGet: string[] = [];
  page.context().on('request', (request: Request) => {
    const method = request.method();
    if (method === 'GET') return;
    if (method === 'OPTIONS' && request.headers()['access-control-request-method']) return;
    nonGet.push(`${method} ${request.url()}`);
  });
  return nonGet;
}

/** 填入 FAKE- 假的 Gemini 金鑰與 GitLab Token */
async function saveFakeSettings(page: Page, {aiKey = true}: {aiKey?: boolean} = {}) {
  await page.getByRole('banner').getByRole('button', {name: '填寫金鑰'}).click();
  if (aiKey) await page.getByLabel(/Google Gemini API Key/).fill('FAKE-e2e-gemini-key');
  await page.getByLabel('Personal Access Token (PAT)').fill('FAKE-e2e-gitlab-token');
  await page.getByRole('button', {name: '儲存設定'}).click();
  await expect(page.getByRole('heading', {name: '偏好與整合設定'})).toBeHidden();
}

async function fetchMr(page: Page) {
  await page.getByPlaceholder('https://gitlab.com/owner/project/-/merge_requests/123').fill(MR_URL);
  await page.getByRole('button', {name: '抓取', exact: true}).click();
  await expect(page.getByText(`!${MR_IID} · ${MR_TITLE}`)).toBeVisible();
}

const staleSharedCard = (page: Page) => page.getByRole('status').filter({hasText: '共享分析報告已過期，未載入'});

/** 依實際排版把元素內文切成一行一行（以每個字元的位置分行） */
async function renderedLines(locator: Locator): Promise<string[]> {
  return locator.evaluate((el) => {
    const lines: {top: number; text: string}[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect || rect.width === 0) continue;
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.top - rect.top) < rect.height / 2) last.text += text[i];
        else lines.push({top: rect.top, text: text[i]});
      }
    }
    return lines.map((l) => l.text.trim());
  });
}

/** 過期卡片內各區塊的位置（標題、內文、commit hash、按鈕）與卡片內容寬度 */
async function staleCardLayout(card: Locator) {
  return card.evaluate((el) => {
    const rect = (node: Element | null | undefined) => {
      if (!node) throw new Error('找不到過期卡片的區塊');
      const r = node.getBoundingClientRect();
      return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width};
    };
    const children = Array.from(el.children);
    const byText = (text: string) => children.find((c) => (c.textContent ?? '').includes(text));
    const style = getComputedStyle(el);
    const cardRect = el.getBoundingClientRect();
    return {
      title: rect(byText('共享分析報告已過期')),
      body: rect(byText('這份報告分析完後')),
      hash: rect(byText('→ 目前')),
      button: rect(el.querySelector('button')),
      cardBottom: cardRect.bottom,
      cardContentWidth:
        cardRect.width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth),
    };
  });
}

const newCommitBar = (page: Page) => page.getByRole('status').filter({hasText: '此 MR 在分析後有新的 commit'});

/** 以模擬的 AI 分析出結果後，MR head 換成新的 commit 再抓取一次，回傳新 commit 提示列 */
async function showNewCommitBar(page: Page) {
  const mock = await mockMr(page, {headSha: OLD_HEAD_SHA, notes: []});
  await mockGemini(page);
  await page.goto('/');
  await saveFakeSettings(page);
  await fetchMr(page);
  await page.getByRole('button', {name: '分析', exact: true}).click();
  await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
  mock.headSha = NEW_HEAD_SHA;
  await page.getByRole('button', {name: '抓取', exact: true}).click();
  const bar = newCommitBar(page);
  await expect(bar).toBeVisible();
  return bar;
}

/** 新 commit 提示列內文字與按鈕的位置，以及提示列內容寬度 */
async function newCommitBarLayout(bar: Locator) {
  return bar.evaluate((el) => {
    const rect = (node: Element | null | undefined) => {
      if (!node) throw new Error('找不到新 commit 提示列的區塊');
      const r = node.getBoundingClientRect();
      return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width};
    };
    const text = Array.from(el.children).find((c) => (c.textContent ?? '').includes('此 MR 在分析後有新的 commit'));
    const style = getComputedStyle(el);
    return {
      text: rect(text),
      button: rect(el.querySelector('button')),
      contentWidth:
        el.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth),
    };
  });
}

// 留言時間 2026-10-01T08:00:00Z 在台北時區為 2026/10/1
test.use({timezoneId: 'Asia/Taipei'});

test.describe('共享標記帶不認得的 category', () => {
  test('不白畫面：載入共享結果並顯示預設分類「其他」', async ({page, blockedRequests}) => {
    const [first, ...rest] = SAMPLE_ANALYSIS_RESULT.reviews;
    await mockMr(page, {
      headSha: OLD_HEAD_SHA,
      notes: [
        note(sharedNoteBody({headSha: OLD_HEAD_SHA, reviews: [{...first, category: 'FAKE-unknown-category'}, ...rest]})),
      ],
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.goto('/');
    await saveFakeSettings(page);
    await fetchMr(page);

    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
    await expect(page.getByText(first.comment).first()).toBeVisible();
    const otherBadge = page.locator('span', {hasText: /^其他$/}).filter({has: page.locator('svg')});
    await expect(otherBadge.first()).toBeVisible();
    await expect(page.getByText('FAKE-unknown-category')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(blockedRequests).toEqual([]);
  });
});

test.describe('有模擬 AI 金鑰時分析', () => {
  test('連點「分析」只呼叫 AI 一次，沒有任何寫入 GitLab 或其他非 GET 請求', async ({page, blockedRequests}) => {
    await mockMr(page, {headSha: OLD_HEAD_SHA, notes: []});
    const aiCalls = await mockGemini(page);
    const nonGet = trackNonGetRequests(page);
    await page.goto('/');
    await saveFakeSettings(page);
    await fetchMr(page);

    await page.getByRole('button', {name: '分析', exact: true}).dblclick();
    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
    // 分析結束後再等一下，確認沒有延遲送出的第二次呼叫
    await page.waitForTimeout(800);

    expect(aiCalls.filter((c) => c.kind === 'analysis'), 'AI 分析只應呼叫一次').toHaveLength(1);
    expect(aiCalls, '不應有補查等其他 AI 呼叫').toHaveLength(1);
    // 唯一的非 GET 請求是那一次（模擬的）AI 呼叫；GitLab 與其他服務都沒有非 GET 請求
    expect(nonGet.filter((r) => !r.includes(GEMINI_HOST)), '除了 AI 呼叫之外不應有非 GET 請求').toEqual([]);
    expect(nonGet.filter((r) => r.includes('gitlab.com')), '不應寫入 GitLab').toEqual([]);
    expect(nonGet).toHaveLength(1);
    expect(blockedRequests).toEqual([]);
  });

  test('過期卡片的「抓最新內容重新分析」先重新抓 MR 再分析，AI 只呼叫一次', async ({page, blockedRequests}) => {
    const counts = await mockMr(page, {
      headSha: NEW_HEAD_SHA,
      notes: [note(sharedNoteBody({headSha: OLD_HEAD_SHA}))],
    });
    const aiCalls = await mockGemini(page);
    const nonGet = trackNonGetRequests(page);
    await page.goto('/');
    await saveFakeSettings(page);
    await fetchMr(page);

    const card = staleSharedCard(page);
    await expect(card).toBeVisible();
    const mrFetchesBefore = counts.mr;
    await card.getByRole('button', {name: '抓最新內容重新分析', exact: true}).dblclick();
    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
    await page.waitForTimeout(800);

    expect(counts.mr, '重新分析前應重新抓一次 MR').toBe(mrFetchesBefore + 1);
    expect(aiCalls).toHaveLength(1);
    await expect(card).toHaveCount(0);
    expect(nonGet.filter((r) => !r.includes(GEMINI_HOST))).toEqual([]);
    expect(blockedRequests).toEqual([]);
  });
});

test.describe('390 寬度的斷行', () => {
  test.use({viewport: {width: 390, height: 844}});

  test('覆寫確認視窗：副標題的「到」不單獨掉行；作者為名稱 + @username', async ({page, blockedRequests}) => {
    await mockMr(page, {headSha: OLD_HEAD_SHA, notes: [note(sharedNoteBody({headSha: OLD_HEAD_SHA}))]});
    await page.goto('/');
    await saveFakeSettings(page, {aiKey: false});
    await fetchMr(page);
    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();

    await page.getByRole('button', {name: /發布至 MR/}).click();
    await page.getByRole('button', {name: /共享分析（免 Key 共享）/}).first().click();
    const dialog = page.getByRole('dialog');
    const subtitle = dialog.getByText('會在 MR 上留下一則留言', {exact: false});
    await expect(subtitle).toBeVisible();
    const lines = await renderedLines(subtitle);
    expect(lines.join('').replace(/\s/g, '')).toBe('會在MR上留下一則留言，團隊成員都看得到');
    expect(lines[lines.length - 1].length, `最後一行：${JSON.stringify(lines)}`).toBeGreaterThanOrEqual(3);
    expect(lines[lines.length - 1]).not.toBe('到');

    await expect(dialog).toContainText('會覆寫 Reviewer Bot @reviewer-bot 於 2026/10/1');
    await expect(dialog).not.toContainText('@Reviewer Bot');
    await expect(dialog).not.toContainText('發布於');
    await dialog.getByRole('button', {name: '取消'}).click();
    expect(blockedRequests).toEqual([]);
  });

  test('過期卡片：內文的「準。」不單獨掉行；作者為名稱 + @username', async ({page, blockedRequests}) => {
    await mockMr(page, {headSha: NEW_HEAD_SHA, notes: [note(sharedNoteBody({headSha: OLD_HEAD_SHA}))]});
    await page.goto('/');
    await saveFakeSettings(page, {aiKey: false});
    await fetchMr(page);

    const card = staleSharedCard(page);
    const body = card.getByText('這份報告分析完後', {exact: false});
    await expect(body).toBeVisible();
    const lines = await renderedLines(body);
    // 每行頭尾的空白在分行時會被去掉，比對內容時忽略空白
    expect(lines.join('').replace(/\s/g, '')).toBe('這份報告分析完後，MR又有新的commit，內容可能已經不準。');
    expect(lines[lines.length - 1].length, `最後一行：${JSON.stringify(lines)}`).toBeGreaterThan(2);
    expect(lines[lines.length - 1]).not.toBe('準。');

    await expect(card).toContainText('由 Reviewer Bot @reviewer-bot 於 2026/10/1 發布');
    await expect(card).not.toContainText('@Reviewer Bot');
    expect(blockedRequests).toEqual([]);
  });

  test('過期卡片：按鈕在 commit hash 之下獨立一列、接近全寬；標題只有一行', async ({page, blockedRequests}) => {
    await mockMr(page, {headSha: NEW_HEAD_SHA, notes: [note(sharedNoteBody({headSha: OLD_HEAD_SHA}))]});
    await page.goto('/');
    await saveFakeSettings(page, {aiKey: false});
    await fetchMr(page);

    const card = staleSharedCard(page);
    const button = card.getByRole('button', {name: '抓最新內容重新分析', exact: true});
    await expect(button).toBeVisible();
    // 只有一顆按鈕：名稱唯一，無障礙樹不會出現重複的按鈕
    await expect(page.getByRole('button', {name: '抓最新內容重新分析', exact: true})).toHaveCount(1);
    const layout = await staleCardLayout(card);
    expect(layout.button.top, '按鈕在 commit hash 之下').toBeGreaterThanOrEqual(layout.hash.bottom);
    expect(layout.button.top, '按鈕在內文之下').toBeGreaterThanOrEqual(layout.body.bottom);
    expect(layout.button.width, '按鈕寬度接近卡片內容寬').toBeGreaterThanOrEqual(layout.cardContentWidth - 2);
    expect(layout.cardBottom - layout.button.bottom, '按鈕是卡片最後一列').toBeLessThanOrEqual(16);
    const titleLines = await renderedLines(card.getByText('MR 上的共享分析報告已過期，未載入'));
    expect(titleLines, `標題：${JSON.stringify(titleLines)}`).toEqual(['MR 上的共享分析報告已過期，未載入']);
    expect(blockedRequests).toEqual([]);
  });

  test('新 commit 提示列：按鈕在文字之下獨立一列、接近全寬', async ({page, blockedRequests}) => {
    const bar = await showNewCommitBar(page);
    const button = bar.getByRole('button', {name: '抓最新內容重新分析', exact: true});
    await expect(button).toBeVisible();
    // 只有一顆按鈕：提示列中同名按鈕唯一
    await expect(button).toHaveCount(1);
    const layout = await newCommitBarLayout(bar);
    expect(layout.button.top, '按鈕在文字之下').toBeGreaterThanOrEqual(layout.text.bottom);
    expect(layout.button.width, '按鈕寬度接近提示列內容寬').toBeGreaterThanOrEqual(layout.contentWidth - 2);
    expect(blockedRequests).toEqual([]);
  });

  test('第一次共享（MR 上沒有既有留言）：確認視窗維持藍框，沒有黃框', async ({page, blockedRequests}) => {
    await mockMr(page, {headSha: OLD_HEAD_SHA, notes: []});
    await mockGemini(page);
    await page.goto('/');
    await saveFakeSettings(page);
    await fetchMr(page);
    await page.getByRole('button', {name: '分析', exact: true}).click();
    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();

    await page.getByRole('button', {name: /發布至 MR/}).click();
    await page.getByRole('button', {name: /共享分析（免 Key 共享）/}).first().click();
    const dialog = page.getByRole('dialog');
    const blueBox = dialog.locator('.bg-primary-subtle', {hasText: '會在 MR 新增一則共享報告留言'});
    await expect(blueBox).toBeVisible();
    await expect(dialog.locator('.bg-warning-subtle')).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: '確認共享（新增 1 則留言）'})).toBeVisible();
    await dialog.getByRole('button', {name: '取消'}).click();
    expect(blockedRequests).toEqual([]);
  });
});

test.describe('1440 寬度的過期卡片', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('按鈕維持在標題列右側（與標題同一 y 範圍）', async ({page, blockedRequests}) => {
    await mockMr(page, {headSha: NEW_HEAD_SHA, notes: [note(sharedNoteBody({headSha: OLD_HEAD_SHA}))]});
    await page.goto('/');
    await saveFakeSettings(page, {aiKey: false});
    await fetchMr(page);

    const card = staleSharedCard(page);
    await expect(card.getByRole('button', {name: '抓最新內容重新分析', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '抓最新內容重新分析', exact: true})).toHaveCount(1);
    const layout = await staleCardLayout(card);
    const titleCenter = (layout.title.top + layout.title.bottom) / 2;
    expect(titleCenter, '標題中線落在按鈕的 y 範圍內').toBeGreaterThanOrEqual(layout.button.top);
    expect(titleCenter).toBeLessThanOrEqual(layout.button.bottom);
    expect(layout.button.left, '按鈕在標題右側').toBeGreaterThanOrEqual(layout.title.left);
    expect(layout.button.bottom, '按鈕在作者／內文之上').toBeLessThanOrEqual(layout.body.top);
    expect(layout.button.width, '桌機按鈕不是全寬').toBeLessThan(layout.cardContentWidth * 0.8);
    expect(blockedRequests).toEqual([]);
  });
});

test.describe('1440 寬度的新 commit 提示列', () => {
  test.use({viewport: {width: 1440, height: 900}});

  test('按鈕與文字同列（y 範圍重疊），不是全寬', async ({page, blockedRequests}) => {
    const bar = await showNewCommitBar(page);
    const button = bar.getByRole('button', {name: '抓最新內容重新分析', exact: true});
    await expect(button).toBeVisible();
    await expect(button).toHaveCount(1);
    const layout = await newCommitBarLayout(bar);
    expect(layout.button.top, '按鈕與文字的 y 範圍重疊').toBeLessThan(layout.text.bottom);
    expect(layout.text.top).toBeLessThan(layout.button.bottom);
    expect(layout.button.left, '按鈕在文字右側').toBeGreaterThanOrEqual(layout.text.right);
    expect(layout.button.width, '桌機按鈕不是全寬').toBeLessThan(layout.contentWidth * 0.8);
    expect(blockedRequests).toEqual([]);
  });
});
