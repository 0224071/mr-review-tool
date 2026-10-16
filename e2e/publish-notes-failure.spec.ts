/**
 * 發布前讀不到 MR 留言（#78）：留言 GET 回 500 時，三條發布路徑（發布已選、發布摘要、共享報告）都中止，
 * 不送出任何寫入，顯示「沒有送出任何留言」與「重試」；留言恢復後按重試會重新讀留言並走到確認視窗。
 * GitLab 只以 mockGitLabGet 模擬 GET，寫入請求一律被 fixture 擋下並記錄（teardown 斷言為空）；只使用 FAKE- 假值。
 */
import type {Page} from '@playwright/test';
import {SAMPLE_GIT_DIFF} from '../src/services/diff-sources/sample-diffs';
import {SAMPLE_ANALYSIS_RESULT} from '../src/services/diff-sources/sample-analysis';
import {expect, mockGitLabGet, test} from './fixtures';

const PROJECT_PATH = 'FAKE-group/notes-failure';
const MR_IID = 78;
const MR_URL = `https://gitlab.com/${PROJECT_PATH}/-/merge_requests/${MR_IID}`;
const MR_API_PATH = `/api/v4/projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests/${MR_IID}`;
const HEAD_SHA = 'f0'.repeat(20);

const MR_INFO = {
  id: 1078,
  iid: MR_IID,
  project_id: 42,
  title: 'E2E 讀不到留言',
  description: '',
  state: 'opened',
  created_at: '2026-09-30T08:00:00Z',
  updated_at: '2026-10-01T08:00:00Z',
  web_url: MR_URL,
  source_branch: 'feature/FAKE',
  target_branch: 'main',
  author: {id: 9, name: 'FAKE Bot', username: 'fake-bot'},
  diff_refs: {base_sha: 'c3'.repeat(20), start_sha: 'c3'.repeat(20), head_sha: HEAD_SHA},
};

/** 與 MR 目前版本相同的共享報告：抓取 MR 後自動載入結果，不呼叫 AI */
const SHARED_NOTE = {
  id: 501,
  body: [
    '<!-- GITLAB_MR_REVIEWER_START v=1 -->',
    '```json',
    JSON.stringify({...SAMPLE_ANALYSIS_RESULT, headSha: HEAD_SHA}),
    '```',
    '<!-- GITLAB_MR_REVIEWER_END -->',
  ].join('\n'),
  author: {id: 9, name: 'FAKE Bot', username: 'fake-bot'},
  created_at: '2026-10-01T08:00:00Z',
  system: false,
};

type NotesMock = {status: number} | {json: unknown[]};

/** 模擬此 MR 的 GET API；留言回應由 notes.current 決定，測試中途可改；記錄留言 GET 次數 */
async function mockMr(page: Page) {
  const notes: {current: NotesMock; gets: number} = {current: {json: [SHARED_NOTE]}, gets: 0};
  await mockGitLabGet(page, (url) => {
    if (url.pathname === MR_API_PATH) return {json: MR_INFO};
    if (url.pathname === `${MR_API_PATH}/raw_diffs`) return {text: SAMPLE_GIT_DIFF};
    if (url.pathname === `${MR_API_PATH}/notes`) {
      notes.gets++;
      return 'status' in notes.current ? {status: notes.current.status, json: {message: 'FAKE error'}} : notes.current;
    }
    return undefined;
  });
  return notes;
}

async function openLoadedResult(page: Page) {
  const notes = await mockMr(page);
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', {name: '填寫金鑰'}).click();
  await page.getByLabel(/Google Gemini API Key/).fill('FAKE-gemini-key');
  await page.getByLabel('Personal Access Token (PAT)').fill('FAKE-gitlab-token');
  await page.getByRole('button', {name: '儲存設定'}).click();
  await expect(page.getByRole('heading', {name: '偏好與整合設定'})).toBeHidden();

  await page.getByPlaceholder('https://gitlab.com/owner/project/-/merge_requests/123').fill(MR_URL);
  await page.getByRole('button', {name: '抓取', exact: true}).click();
  await expect(page.getByText(SAMPLE_ANALYSIS_RESULT.title).first()).toBeVisible();
  return notes;
}

const notesError = (page: Page) => page.getByRole('alert').filter({hasText: '沒有送出任何留言'});

async function expectAborted(page: Page, blockedRequests: string[]) {
  await expect(notesError(page)).toBeVisible();
  await expect(notesError(page).getByRole('button', {name: '重試'})).toBeEnabled();
  // 原因與重試顯示在發布列（發布按鈕旁）；整頁只有一個「重試」入口
  await expect(page.getByRole('region', {name: '發布列'}).getByRole('alert')).toContainText('沒有送出任何留言');
  await expect(page.getByRole('button', {name: '重試', exact: true})).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(blockedRequests, '讀不到留言時不應送出任何非 GET 請求').toEqual([]);
}

test('發布已選：留言 GET 回 500 時不送出，重試成功後走到發布確認', async ({page, blockedRequests}) => {
  const notes = await openLoadedResult(page);
  await page.getByRole('button', {name: /^勾選此意見：/}).first().click();

  notes.current = {status: 500};
  await page.getByRole('button', {name: '發布已選 1 則'}).click();
  await expectAborted(page, blockedRequests);

  notes.current = {json: []};
  const before = notes.gets;
  await notesError(page).getByRole('button', {name: '重試'}).click();
  const dialog = page.getByRole('dialog', {name: '確認發布審查意見至 GitLab'});
  await expect(dialog).toBeVisible();
  expect(notes.gets).toBe(before + 1);
  await expect(notesError(page)).toHaveCount(0);
  await dialog.getByRole('button', {name: '取消'}).click();
  expect(blockedRequests).toEqual([]);
});

test('發布摘要：確認後讀留言失敗時不送出，重試後重新出現確認視窗', async ({page, blockedRequests}) => {
  const notes = await openLoadedResult(page);
  notes.current = {status: 500};
  await page.getByRole('button', {name: '發布至 MR ▾'}).click();
  await page.getByRole('button', {name: /發布摘要至 MR/}).first().click();
  await page.getByRole('dialog', {name: '確認發布整體摘要留言'}).getByRole('button', {name: /確認發送/}).click();
  await expectAborted(page, blockedRequests);

  notes.current = {json: []};
  await notesError(page).getByRole('button', {name: '重試'}).click();
  const dialog = page.getByRole('dialog', {name: '確認發布整體摘要留言'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: '取消'}).click();
  expect(blockedRequests).toEqual([]);
});

test('共享報告：讀留言失敗時不開確認、不送出，重試成功後出現確認視窗', async ({page, blockedRequests}) => {
  const notes = await openLoadedResult(page);
  notes.current = {status: 500};
  await page.getByRole('button', {name: '發布至 MR ▾'}).click();
  await page.getByRole('button', {name: /共享分析（免 Key 共享）/}).first().click();
  await expectAborted(page, blockedRequests);

  notes.current = {json: [SHARED_NOTE]};
  const before = notes.gets;
  await notesError(page).getByRole('button', {name: '重試'}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', {name: /確認共享（覆寫 1 則留言）/})).toBeVisible();
  expect(notes.gets).toBe(before + 1);
  await dialog.getByRole('button', {name: '取消'}).click();
  expect(blockedRequests).toEqual([]);
});

test('發布已選：失敗後改勾選再重試，確認視窗是目前勾選的意見', async ({page, blockedRequests}) => {
  const notes = await openLoadedResult(page);
  const boxes = page.getByRole('button', {name: /^勾選此意見：/});
  await boxes.nth(0).click();

  notes.current = {status: 500};
  await page.getByRole('button', {name: '發布已選 1 則'}).click();
  await expectAborted(page, blockedRequests);

  // 改勾第 2 則（取消第 1 則）
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  const secondFile = ((await boxes.nth(1).getAttribute('aria-label')) ?? '').replace('勾選此意見：', '').split(':')[0];
  const firstFile = ((await boxes.nth(0).getAttribute('aria-label')) ?? '').replace('勾選此意見：', '').split(':')[0];
  notes.current = {json: []};
  await notesError(page).getByRole('button', {name: '重試'}).click();
  const dialog = page.getByRole('dialog', {name: '確認發布審查意見至 GitLab'});
  await expect(dialog.getByRole('button', {name: /確認發送 \(1 則意見\)/})).toBeVisible();
  await expect(dialog).toContainText(secondFile);
  if (firstFile !== secondFile) await expect(dialog).not.toContainText(firstFile);
  await dialog.getByRole('button', {name: '取消'}).click();
  expect(blockedRequests).toEqual([]);
});
