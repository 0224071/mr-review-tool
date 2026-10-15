/**
 * 隱藏標記分享（#51）：MR 留言內含 GITLAB_MR_REVIEWER 隱藏標記與分析 JSON 時，開啟同一 MR 可直接載入，
 * 不呼叫 AI；標記版本不符或 MR 已有新 commit 時不載入舊結果；分享到 MR 前要先確認。
 * GitLab 只以 mockGitLabGet 模擬 GET，寫入請求一律被 fixture 擋下並記錄（teardown 斷言為空）。
 */
import type {Page} from '@playwright/test';
import {SAMPLE_GIT_DIFF} from '../src/services/diff-sources/sample-diffs';
import {SAMPLE_ANALYSIS_RESULT} from '../src/services/diff-sources/sample-analysis';
import {expect, mockGitLabGet, test} from './fixtures';

const PROJECT_PATH = 'e2e-group/shared-marker';
const MR_IID = 7;
const MR_URL = `https://gitlab.com/${PROJECT_PATH}/-/merge_requests/${MR_IID}`;
const MR_API_PATH = `/api/v4/projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests/${MR_IID}`;
const RESULT_TITLE = SAMPLE_ANALYSIS_RESULT.title;
const OLD_HEAD_SHA = 'a1'.repeat(20);
const NEW_HEAD_SHA = 'b2'.repeat(20);

function mrInfo(headSha: string) {
  return {
    id: 1007,
    iid: MR_IID,
    project_id: 42,
    title: 'E2E 隱藏標記分享',
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

/** 依產品的分享留言格式組出 note body；version / extra 用來製造過期的標記 */
function sharedNoteBody({version = 1, extra = {}}: {version?: number; extra?: Record<string, unknown>} = {}) {
  const json = JSON.stringify({...SAMPLE_ANALYSIS_RESULT, ...extra}, null, 2);
  return [
    '### 🤖 GitLab MR AI 講解與審查報告',
    '',
    `**標題**：${RESULT_TITLE}`,
    '',
    `<!-- GITLAB_MR_REVIEWER_START v=${version} -->`,
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

/** 模擬此 MR 的 GET API：MR 資訊、raw diff、留言 */
async function mockSharedMr(page: Page, {headSha, notes}: {headSha: string; notes: unknown[]}) {
  await mockGitLabGet(page, (url) => {
    if (url.pathname === MR_API_PATH) return {json: mrInfo(headSha)};
    if (url.pathname === `${MR_API_PATH}/raw_diffs`) return {text: SAMPLE_GIT_DIFF};
    if (url.pathname === `${MR_API_PATH}/notes`) return {json: notes};
    if (url.pathname === '/api/v4/user') return {json: {id: 9, username: 'reviewer-bot', name: 'Reviewer Bot'}};
    return undefined;
  });
}

/** 記錄送往 AI 供應商（非本機、非 GitLab）的請求 */
function trackAiRequests(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1', 'gitlab.com'].includes(url.hostname)) calls.push(request.url());
  });
  return calls;
}

/** 填入假的 Gemini 金鑰與 GitLab Token：確保「沒送出 AI 請求」不是因為沒有金鑰 */
async function saveFakeSettings(page: Page) {
  await page.getByRole('banner').getByRole('button', {name: '填寫金鑰'}).click();
  await page.getByLabel(/Google Gemini API Key/).fill('e2e-fake-gemini-key');
  await page.getByLabel('Personal Access Token (PAT)').fill('glpat-e2e-fake-token');
  await page.getByRole('button', {name: '儲存設定'}).click();
  await expect(page.getByRole('banner').getByRole('button', {name: '偏好設定'})).toBeVisible();
}

async function fetchMr(page: Page) {
  await page.getByPlaceholder('https://gitlab.com/owner/project/-/merge_requests/123').fill(MR_URL);
  await page.getByRole('button', {name: '抓取', exact: true}).click();
  // MR 資訊卡出現代表 MR、diff、留言都已讀完
  await expect(page.getByText(`!${MR_IID} · E2E 隱藏標記分享`)).toBeVisible();
}

const sharedCard = (page: Page) => page.getByText('已偵測到共享分析報告');
const loadSharedButton = (page: Page) => page.getByRole('button', {name: '載入此共享報告'});

test.describe('有效的隱藏標記', () => {
  test('開啟同一 MR 可載入共享結果，不送出 AI 請求', async ({page}) => {
    await mockSharedMr(page, {headSha: OLD_HEAD_SHA, notes: [note(sharedNoteBody())]});
    await page.goto('/');
    const aiCalls = trackAiRequests(page);
    await saveFakeSettings(page);

    await fetchMr(page);
    await expect(sharedCard(page)).toBeVisible();
    await expect(page.getByText('由 @Reviewer Bot 於')).toBeVisible();

    await loadSharedButton(page).click();
    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
    await expect(page.getByText(SAMPLE_ANALYSIS_RESULT.reviews[0].comment).first()).toBeVisible();
    await expect(sharedCard(page)).toBeHidden();
    await expect(page.getByRole('button', {name: /歷史紀錄\s*1/})).toBeVisible();
    expect(aiCalls, '載入共享結果不應呼叫 AI').toEqual([]);
  });

  // 產品行為不符：偵測到標記後只顯示「載入此共享報告」卡片，要使用者再點一次才載入，
  // 並非情境要求（以及分享留言本身寫的「將自動載入此報告」）的自動載入。修正後拿掉 fixme。
  test.fixme('偵測到有效標記時自動載入結果，不需再點按鈕', async ({page}) => {
    await mockSharedMr(page, {headSha: OLD_HEAD_SHA, notes: [note(sharedNoteBody())]});
    await page.goto('/');
    const aiCalls = trackAiRequests(page);
    await saveFakeSettings(page);

    await fetchMr(page);
    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
    expect(aiCalls).toEqual([]);
  });
});

test.describe('過期的隱藏標記', () => {
  test('標記版本不符時不載入舊結果', async ({page}) => {
    await mockSharedMr(page, {
      headSha: OLD_HEAD_SHA,
      notes: [note(sharedNoteBody({version: 2})), note(sharedNoteBody({extra: {schemaVersion: 2}}))],
    });
    await page.goto('/');
    const aiCalls = trackAiRequests(page);
    await saveFakeSettings(page);

    await fetchMr(page);
    await expect(page.getByRole('button', {name: '分析', exact: true})).toBeEnabled();
    await expect(sharedCard(page)).toBeHidden();
    await expect(loadSharedButton(page)).toHaveCount(0);
    await expect(page.getByText(RESULT_TITLE)).toHaveCount(0);
    expect(aiCalls).toEqual([]);
  });

  // 產品行為不符：分享留言的隱藏標記只有 v=1 與分析 JSON，沒有記錄分析時的 head sha，
  // findSharedAnalysisInNotes 也不比對 MR 目前的 diff_refs.head_sha，MR 有新 commit 時仍會提供載入舊結果。
  // 標記目前沒有 head sha 欄位，這裡假設以 JSON 的 headSha 記錄；實作時依實際格式調整後拿掉 fixme。
  test.fixme('MR 有新 commit（head sha 不同）時不載入舊結果', async ({page}) => {
    await mockSharedMr(page, {
      headSha: NEW_HEAD_SHA,
      notes: [note(sharedNoteBody({extra: {headSha: OLD_HEAD_SHA}}))],
    });
    await page.goto('/');
    await saveFakeSettings(page);

    await fetchMr(page);
    await expect(sharedCard(page)).toBeHidden();
    await expect(loadSharedButton(page)).toHaveCount(0);
    await expect(page.getByText(RESULT_TITLE)).toHaveCount(0);
  });
});

test.describe('發布到 MR 前的確認', () => {
  /** 從共享標記載入結果，取得可發布的分析畫面（不經 AI） */
  async function openLoadedResult(page: Page) {
    await mockSharedMr(page, {headSha: OLD_HEAD_SHA, notes: [note(sharedNoteBody())]});
    await page.goto('/');
    await saveFakeSettings(page);
    await fetchMr(page);
    await loadSharedButton(page).click();
    await expect(page.getByText(RESULT_TITLE).first()).toBeVisible();
  }

  // 產品行為不符：「共享分析（免 Key 共享）」按下後直接讀留言並 POST/PUT 分享留言，沒有確認視窗。
  // 不能在沒有確認的情況下點它（會送出寫入請求），因此 fixme；加上確認視窗後拿掉 fixme。
  test.fixme('分享到 MR 前出現確認視窗，取消後不送出任何寫入請求', async ({page, blockedRequests}) => {
    await openLoadedResult(page);
    await page.getByRole('button', {name: '發布至 MR ▾'}).click();
    await page.getByRole('button', {name: /共享分析（免 Key 共享）/}).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', {name: '取消'}).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('已共享分析報告。')).toHaveCount(0);
    expect(blockedRequests).toEqual([]);
  });

  test('發布摘要到 MR 前出現確認視窗，取消後不送出任何寫入請求', async ({page, blockedRequests}) => {
    await openLoadedResult(page);
    await page.getByRole('button', {name: '發布至 MR ▾'}).click();
    await page.getByRole('button', {name: /發布摘要至 MR/}).first().click();

    const dialog = page.getByRole('dialog', {name: '確認發布整體摘要留言'});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', {name: /確認發送/})).toBeVisible();
    await dialog.getByRole('button', {name: '取消'}).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('已發布整體摘要。')).toHaveCount(0);
    expect(blockedRequests, '取消後不應有送往 gitlab.com 的非 GET 請求').toEqual([]);
  });
});
