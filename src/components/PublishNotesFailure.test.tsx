// @vitest-environment happy-dom
/**
 * 發布前讀不到 MR 留言（#78）：實際掛載 App、使用正式版 GitLab gateway，只模擬 fetch。
 * 三條發布路徑（單則／發布已選、發布摘要、共享報告）讀取失敗時都不送出任何非 GET 請求，
 * 顯示「沒有送出任何留言」與「重試」；重試會重新讀留言並從頭檢查（走到確認視窗）。
 * 讀留言期間所有發布相關按鈕停用並顯示「讀取留言中…」，連點只讀一次；失敗原因與唯一的「重試」顯示在發布列。
 * 重試依目前的勾選與草稿重新組出要發布的意見；切到另一個 MR 讀不到留言時不沿用前一個 MR 的留言。
 * 已發布意見的勾選框旁有「已發布」標籤。只使用 FAKE- 假值。
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
import { createMemoryStore, makeRecord, stubGitLabFetch } from '../hooks/test-utils';
import { buildMrHistoryKey, type HistoryRecord } from '../core/history-store';

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
/** 發布列上顯示「讀取留言中…」的按鈕 */
const readingButton = () => findButton(/^讀取留言中…$/, document.querySelector('[aria-label="發布列"]')!);
const reviews = SAMPLE_ANALYSIS_RESULT.reviews;
/** 寫入請求的 body 是 JSON：比對前先把文字做同樣的跳脫 */
const jsonText = (t: string) => JSON.stringify(t).slice(1, -1);
const sentBodies = () => gitlabFetch.writeBodies.join('\n');
const checkboxes = () => buttons().filter((b) => b.getAttribute('aria-label')?.startsWith('勾選此意見'));
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

/** 畫面上第 cardIndex 張卡片（依嚴重度排序，不一定是原始順序）對應的意見 */
const cardReview = (cardIndex: number) => {
  const card = checkboxes()[cardIndex].closest<HTMLElement>('div[tabindex="0"]')!;
  const found = reviews.find((r) => (card.textContent ?? '').includes(r.comment));
  if (!found) throw new Error(`找不到第 ${cardIndex} 張卡片的意見`);
  return found;
};

/**
 * 共享報告留言含每則意見的內容，載入後所有意見都顯示已發布（不能編輯草稿）。
 * 先走一次讀到空留言的發布（MR 上的留言已刪除）再取消，讓意見回到未發布。
 */
async function clearRemoteNotes() {
  notesResponse = () => [];
  await click(buttons().filter((b) => b.getAttribute('aria-label') === '發布單則')[0]);
  await waitFor(() => !!dialog(), '發布確認視窗');
  await click(findButton('取消', dialog()!));
  await waitFor(() => !dialog(), '關閉確認視窗');
}

/** 把第 cardIndex 張卡片的意見內文改成 next（編輯草稿 → 輸入 → 完成編輯） */
async function editDraft(cardIndex: number, next: string) {
  const edit = buttons().filter((b) => b.getAttribute('aria-label') === '編輯草稿')[cardIndex];
  const card = edit.closest<HTMLElement>('div[tabindex="0"]')!;
  await click(edit);
  const textarea = card.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, next);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(card.querySelector<HTMLButtonElement>('button[aria-label="完成編輯"]')!);
}
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
    await waitFor(() => readingButton().disabled, '發布已選停用並顯示讀取留言中');
    expect(document.querySelector('[aria-label="發布列"]')!.textContent).not.toMatch(/發布已選 \d+ 則/);

    expect(buttons().filter((b) => b.getAttribute('aria-label') === '發布單則').every((b) => b.disabled)).toBe(true);
    expect(buttons().filter((b) => b.getAttribute('aria-label')?.startsWith('勾選此意見')).every((b) => b.disabled)).toBe(true);
    expect(findButton(/^全選$/).disabled).toBe(true);
    expect(findButton('發布至 MR ▾').disabled).toBe(true);
    expect(findButton(/^更多 ▾$/).disabled).toBe(true);

    // 停用中再點（含直接觸發 click）也不會再讀
    await click(readingButton());
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="發布單則"]')!);
    expect(notesGets()).toBe(before + 1);

    await act(async () => release([]));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '發布確認視窗');
    expect(notesGets()).toBe(before + 1);
    expect(gitlabFetch.writes).toEqual([]);
  });
});

describe('重試用目前的勾選與草稿（#78）', () => {
  it('發布已選失敗後改勾選，重試送出的是目前勾選的意見，不是失敗當下的', async () => {
    await openLoadedMr();
    await selectTwo(); // 畫面上第 0、1 張卡片
    const [first, second, third] = [cardReview(0), cardReview(1), cardReview(2)];
    notesResponse = () => 500;
    await click(findButton('發布已選 2 則'));
    await expectAborted();

    // 取消第 0 則、改勾第 2 則
    await click(checkboxes()[0]);
    await click(checkboxes()[2]);
    notesResponse = () => [];
    await click(retryButton());
    await waitFor(() => !!dialog(), '發布確認視窗');
    expect(dialog()!.textContent).toContain('確認發送 (2 則意見)');
    await click(findButton(/^確認發送/, dialog()!));
    await waitFor(() => !dialog(), '發布完成');

    expect(sentBodies()).toContain(jsonText(second.comment));
    expect(sentBodies()).toContain(jsonText(third.comment));
    expect(sentBodies()).not.toContain(jsonText(first.comment));
  });

  it('發布已選失敗後改草稿，重試送出的是新內文', async () => {
    await openLoadedMr();
    await clearRemoteNotes();
    await selectTwo();
    const [first, second] = [cardReview(0), cardReview(1)];
    notesResponse = () => 500;
    await click(findButton('發布已選 2 則'));
    await expectAborted();

    const edited = 'FAKE 重試前改過的新內文';
    await editDraft(0, edited);
    notesResponse = () => [];
    await click(retryButton());
    await waitFor(() => !!dialog(), '發布確認視窗');
    await click(findButton(/^確認發送/, dialog()!));
    await waitFor(() => !dialog(), '發布完成');

    expect(sentBodies()).toContain(jsonText(edited));
    expect(sentBodies()).not.toContain(jsonText(first.comment));
    expect(sentBodies()).toContain(jsonText(second.comment));
  });

  it('單則發布失敗後改草稿，重試送出的是新內文', async () => {
    await openLoadedMr();
    await clearRemoteNotes();
    const target = cardReview(1);
    notesResponse = () => 500;
    await click(buttons().filter((b) => b.getAttribute('aria-label') === '發布單則')[1]);
    await expectAborted();

    const edited = 'FAKE 單則改過的新內文';
    await editDraft(1, edited);
    notesResponse = () => [];
    await click(retryButton());
    await waitFor(() => !!dialog(), '發布確認視窗');
    expect(dialog()!.textContent).toContain('確認發送 (1 則意見)');
    await click(findButton(/^確認發送/, dialog()!));
    await waitFor(() => !dialog(), '發布完成');

    expect(sentBodies()).toContain(jsonText(edited));
    expect(sentBodies()).not.toContain(jsonText(target.comment));
  });
});

describe('讀留言中與失敗的顯示位置（#78）', () => {
  it('發布已選：讀留言中按鈕停用、顯示「讀取留言中…」與 spinner；失敗後同一位置（發布列）顯示原因與唯一的「重試」', async () => {
    await openLoadedMr();
    await selectTwo();
    let fail!: () => void;
    notesResponse = () => new Promise((resolve) => (fail = () => resolve(500)));
    await click(findButton('發布已選 2 則'));
    await waitFor(() => readingButton().disabled, '讀取留言中');
    expect(readingButton().querySelector('.animate-spin')).not.toBeNull();
    // 「複製」不停用
    expect(buttons().filter((b) => b.getAttribute('aria-label') === '複製意見').every((b) => !b.disabled)).toBe(true);

    await act(async () => fail());
    await expectAborted();
    const bar = document.querySelector('[aria-label="發布列"]')!;
    expect(bar.contains(notesError())).toBe(true);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(buttons().filter((b) => (b.textContent ?? '').trim() === '重試')).toHaveLength(1);
    expect(findButton('發布已選 2 則', bar).disabled).toBe(false);
  });

  it('共享報告：讀留言中「發布至 MR ▾」與「更多 ▾」都顯示「讀取留言中…」與 spinner', async () => {
    await openLoadedMr();
    let release!: (notes: unknown[]) => void;
    notesResponse = () => new Promise((r) => (release = r));
    await click(findButton('發布至 MR ▾'));
    await click(findButton('共享分析（免 Key 共享）'));
    const bar = document.querySelector('[aria-label="發布列"]')!;
    await waitFor(() => !!bar.querySelector('button .animate-spin'), '更多 ▾ 顯示讀取中');
    const reading = buttons().filter((b) => (b.textContent ?? '').trim() === '讀取留言中…');
    expect(reading).toHaveLength(2);
    reading.forEach((b) => {
      expect(b.disabled).toBe(true);
      expect(b.querySelector('.animate-spin')).not.toBeNull();
    });
    await act(async () => release([SHARED_NOTE]));
    await waitFor(() => !!dialog(), '共享確認視窗');
  });

  it('發布摘要：確認後讀留言中，確認按鈕顯示「讀取留言中…」', async () => {
    await openLoadedMr();
    let release!: (notes: unknown[]) => void;
    notesResponse = () => new Promise((r) => (release = r));
    await click(findButton('發布至 MR ▾'));
    await click(findButton('發布摘要至 MR'));
    await click(findButton(/^確認發送/, dialog()!));
    await waitFor(() => (dialog()?.textContent ?? '').includes('讀取留言中…'), '確認按鈕顯示讀取中');
    await act(async () => release([SHARED_NOTE]));
    await waitFor(() => text().includes('分享報告已包含摘要'), '讀完留言');
    expect(gitlabFetch.writes).toEqual([]);
  });
});

describe('已發布意見的勾選框（#78）', () => {
  it('已發布的意見：勾選框旁有「已發布」標籤並以 aria-describedby 連結；發布作業中停用時變灰、禁止游標', async () => {
    // 共享報告留言含每則意見的內容：所有意見都比對為已發布
    await openLoadedMr();
    const box = checkboxes()[0];
    const label = box.parentElement!.nextElementSibling!;
    expect(label.textContent).toBe('已發布');
    expect(box.getAttribute('aria-describedby')).toBe(label.id);
    expect(document.getElementById(box.getAttribute('aria-describedby')!)!.textContent).toBe('已發布');
    expect(box.disabled).toBe(false);

    let release!: (notes: unknown[]) => void;
    notesResponse = () => new Promise((r) => (release = r));
    await click(buttons().filter((b) => b.getAttribute('aria-label') === '發布單則')[0]);
    await waitFor(() => checkboxes()[0].disabled, '勾選框停用');
    const disabledBox = checkboxes()[0];
    expect(disabledBox.className).toContain('disabled:opacity-40');
    expect(disabledBox.className).toContain('disabled:cursor-not-allowed');
    // 沒有原因可說明時不穿透點擊，滑鼠移上去看得到禁止游標
    expect(disabledBox.className).not.toContain('disabled:pointer-events-none');
    await act(async () => release([]));
  });

  it('未發布的意見沒有「已發布」標籤與 aria-describedby', async () => {
    await openLoadedMr();
    await clearRemoteNotes();
    const box = checkboxes()[0];
    expect(box.hasAttribute('aria-describedby')).toBe(false);
    expect(box.parentElement!.nextElementSibling!.textContent).not.toBe('已發布');
  });
});

describe('切換 MR 後讀不到新 MR 的留言（#78）', () => {
  const MR_B_URL = 'https://gitlab.com/FAKE-group/FAKE-project/-/merge_requests/8';
  const HEAD_B = 'e1'.repeat(20);
  const MR_B = { ...MR, id: 2, iid: 8, title: 'FAKE MR B', web_url: MR_B_URL, diff_refs: { ...MR.diff_refs, head_sha: HEAD_B } };
  const isMrB = (url: URL) => /\/merge_requests\/8(\/|$)/.test(url.pathname);
  /** 兩個 MR 都有本機快取（不需留言就能顯示結果）；B 預設勾選前兩則 */
  const recordFor = (mr: typeof MR, iid: number) =>
    makeRecord({
      id: buildMrHistoryKey('https://gitlab.com', 'FAKE-group/FAKE-project', iid),
      sourceType: 'gitlab',
      title: mr.title,
      mrUrl: mr.web_url,
      mr: mr as HistoryRecord['mr'],
      headSha: mr.diff_refs.head_sha,
      latestHeadSha: mr.diff_refs.head_sha,
      rawDiff: SAMPLE_GIT_DIFF,
      selectedIndices: [0, 1],
    });

  it('從 A 切到 B、B 的留言讀取失敗：發布中止，不用 A 的留言通過重複檢查', async () => {
    const records = [recordFor(MR, 7), recordFor(MR_B, 8)];
    const { store } = createMemoryStore();
    store.get.mockImplementation(async (key: string) => records.find((r) => key.startsWith(r.id)));
    // A 的留言裡沒有任何重複：若誤用 A 的留言比對，B 的發布會直接通過、開發布確認
    gitlabFetch = stubGitLabFetch({
      mr: (url: URL) => (isMrB(url) ? MR_B : MR),
      rawDiff: SAMPLE_GIT_DIFF,
      notes: (url) => (isMrB(url) ? 500 : []),
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App services={{ ...services, openHistoryStore: async () => store }} />);
    });
    const input = document.querySelector<HTMLInputElement>('input[placeholder="https://gitlab.com/owner/project/-/merge_requests/123"]')!;
    const fetchMr = async (url: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, url);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click(findButton(/^抓取$/));
    };

    await fetchMr(MR_URL);
    await waitFor(() => text().includes('MR !7') && !!document.querySelector('[aria-label="發布列"]'), 'A 載入');
    await fetchMr(MR_B_URL);
    await waitFor(() => text().includes('MR !8'), 'B 載入');
    // B 載入時讀留言就失敗了（畫面處理留給 #79），結果來自本機快取
    const bNotesGets = () =>
      gitlabFetch.fetchMock.mock.calls.filter(([u]) => isMrB(new URL(String(u))) && String(u).includes('/notes')).length;
    const before = bNotesGets();
    expect(before).toBeGreaterThan(0);

    await click(findButton('發布已選 2 則'));
    await expectAborted();
    expect(bNotesGets()).toBe(before + 1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
