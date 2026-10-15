// @vitest-environment happy-dom
/**
 * 發布前讀不到 MR 留言（#78）：實際掛載 App、使用正式版 GitLab gateway，只模擬 fetch。
 * 三條發布路徑（單則／發布已選、發布摘要、共享報告）讀取失敗時都不送出任何非 GET 請求，
 * 顯示「沒有送出任何留言」與「重試」；重試會重新讀留言並從頭檢查（走到確認視窗）。
 * 讀留言期間所有發布相關按鈕停用，連點只讀一次。只使用 FAKE- 假值。
 */
import { act } from 'react';
import { createRoot, Root as ReactRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { liveGitLabGateway } from '../app/live-services';
import type { AppServices } from '../app/app-services';
import { DEFAULT_SETTINGS } from '../types/settings';
import { SHARED_TAG_END, SHARED_TAG_START } from '../services/gitlab-api';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { stubGitLabFetch } from '../hooks/test-utils';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MR_URL = 'https://gitlab.com/FAKE-group/FAKE-project/-/merge_requests/7';
const HEAD_SHA = 'f0'.repeat(20);
const MR = {
  id: 1,
  iid: 7,
  project_id: 1,
  title: 'FAKE MR',
  web_url: MR_URL,
  diff_refs: { base_sha: 'b'.repeat(40), start_sha: 'b'.repeat(40), head_sha: HEAD_SHA },
};
/** MR 上與目前版本相同的共享報告：抓取 MR 後自動載入結果，不呼叫 AI */
const SHARED_NOTE = {
  id: 501,
  body: `${SHARED_TAG_START}\n\`\`\`json\n${JSON.stringify({ ...SAMPLE_ANALYSIS_RESULT, headSha: HEAD_SHA })}\n\`\`\`\n${SHARED_TAG_END}`,
  author: { id: 9, name: 'FAKE Bot', username: 'fake-bot' },
  created_at: '2026-10-01T08:00:00Z',
  system: false,
};

let container: HTMLDivElement;
let root: ReactRoot;
/** 留言 GET 的回應；測試中途可改 */
let notesResponse: () => unknown[] | number | Promise<unknown[] | number>;
let gitlabFetch: ReturnType<typeof stubGitLabFetch>;

const services: AppServices = {
  settings: {
    load: () => ({ ...DEFAULT_SETTINGS, gitlabToken: 'FAKE-token' }),
    save: () => {},
    clearKey: (settings) => settings,
    Dialog: () => null,
  },
  ai: {
    setupNotice: () => null,
    createProvider: () => {
      throw new Error('測試中不應呼叫 AI');
    },
  },
  gitlab: liveGitLabGateway,
  openHistoryStore: async () => null,
  initialRawDiff: '',
  homeHint: '',
  banner: null,
};

const text = () => document.body.textContent ?? '';
const buttons = () => Array.from(document.querySelectorAll('button'));
const findButton = (label: string | RegExp, scope: ParentNode = document) => {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => {
    const t = (b.textContent ?? '').trim();
    return typeof label === 'string' ? t.includes(label) : label.test(t);
  });
  if (!btn) throw new Error(`找不到按鈕「${label}」`);
  return btn as HTMLButtonElement;
};
const notesGets = () =>
  gitlabFetch.fetchMock.mock.calls.filter(([u, init]) => String(u).includes('/notes') && (init?.method ?? 'GET') === 'GET')
    .length;

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

async function waitFor(check: () => boolean, label: string, timeoutMs = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`等待逾時：${label}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

/** 掛載 App、填入 MR 網址並抓取；共享報告自動載入後回傳 */
async function openLoadedMr() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<App services={services} />);
  });
  const input = document.querySelector<HTMLInputElement>('input[placeholder="https://gitlab.com/owner/project/-/merge_requests/123"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, MR_URL);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(findButton(/^抓取$/));
  await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title) && !!document.querySelector('[aria-label="發布列"]'), '共享報告載入');
}

/** 勾選前兩則意見（預設不勾選），讓「發布已選」可按 */
async function selectTwo() {
  const boxes = buttons().filter((b) => b.getAttribute('aria-label')?.startsWith('勾選此意見'));
  await click(boxes[0]);
  await click(boxes[1]);
  expect(findButton('發布已選 2 則').disabled).toBe(false);
}

const notesError = () => document.querySelector('[role="alert"]');
const retryButton = () => findButton('重試', notesError()!);

async function expectAborted() {
  await waitFor(() => !!notesError(), '讀取失敗錯誤');
  expect(notesError()!.textContent).toContain('沒有送出任何留言');
  expect(retryButton().disabled).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(gitlabFetch.writes).toEqual([]);
}

beforeEach(() => {
  notesResponse = () => [SHARED_NOTE];
  gitlabFetch = stubGitLabFetch({ mr: MR, rawDiff: SAMPLE_GIT_DIFF, notes: () => notesResponse() });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('發布前讀不到 MR 留言時中止（#78）', () => {
  it('發布已選：留言 GET 回 500 時不送出寫入；重試成功後走到發布確認', async () => {
    await openLoadedMr();
    await selectTwo();
    notesResponse = () => 500;
    await click(findButton('發布已選 2 則'));
    await expectAborted();

    notesResponse = () => [];
    const before = notesGets();
    await click(retryButton());
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '發布確認視窗');
    expect(notesGets()).toBe(before + 1);
    expect(notesError()).toBeNull();
    expect(text()).toContain('確認發送');
    expect(gitlabFetch.writes).toEqual([]);
  });

  it('發布已選（回歸）：讀取成功時，MR 上已有的意見仍跳重複警告', async () => {
    await openLoadedMr();
    await selectTwo();
    // 共享報告留言內含每則意見的檔名與內文，比對為已發布
    await click(findButton('發布已選 2 則'));
    await waitFor(() => !!document.querySelector('[role="alertdialog"]'), '重複發布警告');
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('有 2 則已發布過');
    expect(notesError()).toBeNull();
    expect(gitlabFetch.writes).toEqual([]);
  });

  it('單則發布：留言 GET 回 500 時不送出寫入', async () => {
    await openLoadedMr();
    notesResponse = () => 500;
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="發布單則"]')!);
    await expectAborted();
  });

  it('發布摘要：確認後讀留言失敗時不送出寫入；重試重新開確認，確認後重新讀留言', async () => {
    await openLoadedMr();
    notesResponse = () => 500;
    await click(findButton('發布至 MR ▾'));
    await click(findButton('發布摘要至 MR'));
    await click(findButton(/^確認發送/, document.querySelector('[role="dialog"]')!));
    await expectAborted();

    // 重試：重新開確認視窗；確認後讀到分享報告 → 不另外發摘要（不寫入）
    notesResponse = () => [SHARED_NOTE];
    await click(retryButton());
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '摘要確認視窗');
    const before = notesGets();
    await click(findButton(/^確認發送/, document.querySelector('[role="dialog"]')!));
    await waitFor(() => text().includes('分享報告已包含摘要'), '重新讀留言後的檢查結果');
    expect(notesGets()).toBe(before + 1);
    expect(gitlabFetch.writes).toEqual([]);
  });

  it('共享報告：讀留言失敗時不開確認、不送出寫入；重試成功後出現確認視窗', async () => {
    await openLoadedMr();
    notesResponse = () => 500;
    await click(findButton('發布至 MR ▾'));
    await click(findButton('共享分析（免 Key 共享）'));
    await expectAborted();

    notesResponse = () => [SHARED_NOTE];
    await click(retryButton());
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '共享確認視窗');
    expect(text()).toContain('確認共享（覆寫 1 則留言）');
    expect(gitlabFetch.writes).toEqual([]);
  });
});

describe('防連點：讀留言期間所有發布相關按鈕停用（#78）', () => {
  it('發布已選後讀留言中：發布、單則、勾選、全選、發布至 MR、更多都停用，連點只讀一次', async () => {
    await openLoadedMr();
    await selectTwo();
    let release!: (notes: unknown[]) => void;
    notesResponse = () => new Promise((r) => (release = r));
    const before = notesGets();
    const publishSelected = findButton(/^發布已選 \d+ 則$/);
    await click(publishSelected);
    await click(publishSelected);
    await waitFor(() => findButton(/^發布已選 \d+ 則$/).disabled, '發布已選停用');

    expect(buttons().filter((b) => b.getAttribute('aria-label') === '發布單則').every((b) => b.disabled)).toBe(true);
    expect(buttons().filter((b) => b.getAttribute('aria-label')?.startsWith('勾選此意見')).every((b) => b.disabled)).toBe(true);
    expect(findButton(/^全選$/).disabled).toBe(true);
    expect(findButton('發布至 MR ▾').disabled).toBe(true);
    expect(findButton(/^更多 ▾$/).disabled).toBe(true);

    // 停用中再點（含直接觸發 click）也不會再讀
    await click(findButton(/^發布已選 \d+ 則$/));
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="發布單則"]')!);
    expect(notesGets()).toBe(before + 1);

    await act(async () => release([]));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '發布確認視窗');
    expect(notesGets()).toBe(before + 1);
    expect(gitlabFetch.writes).toEqual([]);
  });
});
