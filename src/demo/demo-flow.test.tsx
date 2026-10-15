// @vitest-environment happy-dom
/**
 * 實際掛載 Root／App，以點擊走完示範流程：載入範例 → 分析 → 看結果 → 模擬發布 → 離開示範。
 */
import { act } from 'react';
import { createRoot, Root as ReactRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Root from '../Root';
import { SETTINGS_STORAGE_KEY } from '../core/settings-store';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { EMPTY_COMMENT_MESSAGE } from '../core/review-text';
import type { PublishBatchFn } from '../app/app-services';
import {
  DEMO_BANNER_SHORT_TEXT,
  DEMO_BANNER_TEXT,
  DEMO_HOME_HINT,
  DEMO_NOTICE,
  DEMO_PUBLISH_CONFIRM_TITLE,
} from './demo-mode';

/** 攔下示範 GitLab 交給假發布器的每一批，確認實際收到哪些意見（行為不變） */
const fakePublishBatchSpy = vi.hoisted(() => vi.fn());
vi.mock('./fake-publisher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fake-publisher')>();
  return {
    ...actual,
    createDemoGitLabGateway: (...args: Parameters<typeof actual.createDemoGitLabGateway>) => {
      const gateway = actual.createDemoGitLabGateway(...args);
      const publishBatch: PublishBatchFn = (...batchArgs) => {
        fakePublishBatchSpy(...batchArgs);
        return gateway.publishBatch(...batchArgs);
      };
      return { ...gateway, publishBatch };
    },
  };
});

/**
 * 「分析中」只在假 provider 等待期間出現；只靠 20ms 真實計時器時，負載高（整套平行跑）下
 * click 的 act 收尾可能超過 20ms，結果先渲染完，「分析中」就已消失（#65）。
 * 需要觀察中間狀態的測試設 analysisGate.hold，provider 會等它放行才開始回傳。
 */
const analysisGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('./fake-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fake-provider')>();
  return {
    ...actual,
    createDemoProvider: (...args: Parameters<typeof actual.createDemoProvider>) => {
      const provider = actual.createDemoProvider(...args);
      const review: typeof provider.review = async (request) => {
        if (analysisGate.hold) await analysisGate.hold;
        return provider.review(request);
      };
      return { ...provider, review };
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEMO_TIMING = { analysisDelayMs: 20, publishDelayMs: 0 };

let container: HTMLDivElement;
let root: ReactRoot;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
let idbOpen: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

const text = () => document.body.textContent ?? '';

const findButton = (label: string, scope: ParentNode = document) => {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim().includes(label));
  if (!btn) throw new Error(`找不到按鈕「${label}」`);
  return btn as HTMLButtonElement;
};

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

async function mount(url: string) {
  window.history.replaceState(null, '', url);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Root demoTiming={DEMO_TIMING} />);
  });
}

const settingsKeyTouched = () =>
  [...storage.getItem.mock.calls, ...storage.setItem.mock.calls, ...storage.removeItem.mock.calls].some(
    ([key]) => key === SETTINGS_STORAGE_KEY
  );

beforeEach(() => {
  fakePublishBatchSpy.mockClear();
  analysisGate.hold = null;
  fetchSpy = vi.fn(async () => {
    throw new Error('測試中不應發出網路請求');
  });
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(globalThis, 'fetch');
  storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  idbOpen = vi.fn(() => {
    throw new Error('IndexedDB unavailable in test');
  });
  vi.stubGlobal('indexedDB', { open: idbOpen });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('示範模式完整流程（?demo=1）', () => {
  it('免金鑰走完分析與模擬發布：不呼叫 fetch、不碰設定 localStorage、不寫歷史紀錄', async () => {
    await mount('/?demo=1');

    // 進入即顯示固定橫幅，左欄已載入範例 diff
    expect(text()).toContain(DEMO_BANNER_TEXT);
    const textarea = container.querySelector('textarea')!;
    expect(textarea.value).toBe(SAMPLE_GIT_DIFF);

    // 分析（假 provider 延遲後回傳範例結果）；先擋住 provider，確定看得到「分析中」再放行
    let release!: () => void;
    analysisGate.hold = new Promise<void>((resolve) => (release = resolve));
    await click(findButton('分析'));
    expect(text()).toContain('分析中');
    expect(text()).not.toContain(SAMPLE_ANALYSIS_RESULT.title);
    release();
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');
    expect(text()).toContain(DEMO_BANNER_TEXT);
    expect(text()).toContain('示範 · 範例分析');

    // 審查意見預設全部不勾
    const checkboxes = Array.from(container.querySelectorAll('button[aria-pressed]'));
    expect(checkboxes.length).toBe(SAMPLE_ANALYSIS_RESULT.reviews.length);
    expect(checkboxes.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);

    // 勾兩則 → 發布 → 正式的確認視窗（標示示範）
    await click(checkboxes[0] as HTMLElement);
    await click(checkboxes[1] as HTMLElement);
    await click(findButton('發布已選 2 則'));
    const dialog = await (async () => {
      await waitFor(() => !!document.querySelector('[role="dialog"]'), '確認視窗');
      return document.querySelector('[role="dialog"]')!;
    })();
    expect(dialog.textContent).toContain(DEMO_NOTICE);
    expect(dialog.textContent).toContain('示範 MR');
    expect(dialog.querySelector('a[href]')).toBeNull();

    await click(findButton('確認發送', dialog));
    await waitFor(() => !document.querySelector('[role="dialog"]'), '發布完成');
    expect(text()).toContain(`已發布 2 則審查意見。（${DEMO_NOTICE}）`);
    const cardNotices = Array.from(container.querySelectorAll('span')).filter((s) => s.textContent === DEMO_NOTICE);
    expect(cardNotices).toHaveLength(2);

    // 模擬發布摘要也標示示範
    await click(findButton('發布至 MR ▾'));
    await click(findButton('發布摘要至 MR'));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '摘要確認視窗');
    await click(findButton('確認發送', document.querySelector('[role="dialog"]')!));
    await waitFor(() => text().includes(`已發布整體摘要。（${DEMO_NOTICE}）`), '摘要發布');

    // 畫面上沒有任何 GitLab／MR 連結
    const links = Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') ?? '');
    expect(links.filter((h) => /gitlab|merge_requests/i.test(h))).toEqual([]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(settingsKeyTouched()).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(idbOpen).not.toHaveBeenCalled();
  });

  it('確認視窗與正式模式一樣：行號已驗證走行內留言，對不上 diff 的那則走一般留言', async () => {
    await mount('/?demo=1');
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');

    const total = SAMPLE_ANALYSIS_RESULT.reviews.length;
    for (const checkbox of Array.from(container.querySelectorAll('button[aria-pressed]'))) {
      await click(checkbox as HTMLElement);
    }
    await click(findButton(`發布已選 ${total} 則`));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '確認視窗');
    const dialog = document.querySelector('[role="dialog"]')!;

    expect(dialog.textContent).toContain(DEMO_NOTICE);
    expect(dialog.textContent).toContain(`行內 ${total - 1} · 一般留言 1`);
    const items = Array.from(dialog.querySelectorAll('ol > li'));
    expect(items).toHaveLength(total);
    const inline = items.filter((li) => /行內留言 L\d+/.test(li.textContent ?? ''));
    const general = items.filter((li) => (li.textContent ?? '').includes('一般留言（行號未驗證）'));
    expect(inline).toHaveLength(total - 1);
    expect(general).toHaveLength(1);
    expect(general[0].textContent).toContain('src/tests/discountCalculator.test.ts');
    expect(dialog.textContent).toContain('包含 1 則行號未驗證的意見');
    expect(dialog.textContent).not.toContain('缺少 diff 版本資訊');
    expect(dialog.querySelector('a[href]')).toBeNull();

    await click(findButton('確認發送', dialog));
    await waitFor(() => !document.querySelector('[role="dialog"]'), '發布完成');
    expect(text()).toContain(`已發布 ${total} 則審查意見。（${DEMO_NOTICE}）`);
    const cardNotices = Array.from(container.querySelectorAll('span')).filter((s) => s.textContent === DEMO_NOTICE);
    expect(cardNotices).toHaveLength(total);
    const generalBadges = Array.from(container.querySelectorAll('span')).filter((s) => s.textContent === '以一般留言發布');
    expect(generalBadges).toHaveLength(1);

    const links = Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') ?? '');
    expect(links.filter((h) => /gitlab|merge_requests/i.test(h))).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('按「全選」：連行號未驗證的那則也勾到，確認視窗「行內 5 · 一般留言 1」，送出則數等於 N', async () => {
    await mount('/?demo=1');
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');

    const total = SAMPLE_ANALYSIS_RESULT.reviews.length;
    await click(findButton('全選'));
    const checkboxes = Array.from(container.querySelectorAll('button[aria-pressed]'));
    expect(checkboxes.every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);

    await click(findButton(`發布已選 ${total} 則`));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '確認視窗');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('行內 5 · 一般留言 1');
    expect(dialog.querySelectorAll('ol > li')).toHaveLength(total);

    await click(findButton('確認發送', dialog));
    await waitFor(() => !document.querySelector('[role="dialog"]'), '發布完成');
    expect(fakePublishBatchSpy).toHaveBeenCalledTimes(1);
    expect(fakePublishBatchSpy.mock.calls[0][1]).toHaveLength(total);
    expect(text()).toContain(`已發布 ${total} 則審查意見。（${DEMO_NOTICE}）`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('內文清空的那則按「全選」也不勾，N 與假發布器收到的則數一致', async () => {
    await mount('/?demo=1');
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');

    const total = SAMPLE_ANALYSIS_RESULT.reviews.length;
    const checkboxes = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
    const card = checkboxes[0].closest<HTMLElement>('div[tabindex="0"]')!;
    await click(card.querySelector<HTMLButtonElement>('button[aria-label="編輯草稿"]')!);
    const commentInput = card.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(commentInput, '  ');
      commentInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await click(findButton('全選'));
    expect(checkboxes[0].getAttribute('aria-pressed')).toBe('false');
    expect(checkboxes.slice(1).every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);

    await click(findButton(`發布已選 ${total - 1} 則`));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '確認視窗');
    await click(findButton('確認發送', document.querySelector('[role="dialog"]')!));
    await waitFor(() => !document.querySelector('[role="dialog"]'), '發布完成');
    expect(fakePublishBatchSpy).toHaveBeenCalledTimes(1);
    expect(fakePublishBatchSpy.mock.calls[0][1]).toHaveLength(total - 1);
  });

  it('把某則意見內文清空：不能勾、不能複製或單則發布，就地提示，發布已選時假發布器收不到那則', async () => {
    await mount('/?demo=1');
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');

    const total = SAMPLE_ANALYSIS_RESULT.reviews.length;
    const checkboxes = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
    for (const checkbox of checkboxes) await click(checkbox);
    expect(findButton(`發布已選 ${total} 則`)).toBeTruthy();

    // 編輯第一則，把內文清空
    const card = checkboxes[0].closest<HTMLElement>('div[tabindex="0"]')!;
    await click(card.querySelector<HTMLButtonElement>('button[aria-label="編輯草稿"]')!);
    const commentInput = card.querySelector('textarea')!;
    const clearedComment = commentInput.value;
    expect(clearedComment.trim()).not.toBe('');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(commentInput, '');
      commentInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // 自動取消勾選並鎖住；就地提示；複製與單則發布也鎖住
    const emptyCheckbox = card.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    expect(emptyCheckbox.getAttribute('aria-pressed')).toBe('false');
    expect(emptyCheckbox.disabled).toBe(true);
    await click(emptyCheckbox);
    expect(emptyCheckbox.getAttribute('aria-pressed')).toBe('false');
    expect(card.querySelector('[role="status"]')?.textContent).toContain(EMPTY_COMMENT_MESSAGE);
    expect(card.querySelector<HTMLButtonElement>('button[aria-label="複製意見"]')!.disabled).toBe(true);
    expect(card.querySelector<HTMLButtonElement>('button[aria-label="發布單則"]')!.disabled).toBe(true);

    await click(findButton(`發布已選 ${total - 1} 則`));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '確認視窗');
    await click(findButton('確認發送', document.querySelector('[role="dialog"]')!));
    await waitFor(() => !document.querySelector('[role="dialog"]'), '發布完成');
    expect(text()).toContain(`已發布 ${total - 1} 則審查意見。（${DEMO_NOTICE}）`);

    expect(fakePublishBatchSpy).toHaveBeenCalledTimes(1);
    const sent = fakePublishBatchSpy.mock.calls[0][1] as Parameters<PublishBatchFn>[1];
    expect(sent).toHaveLength(total - 1);
    expect(sent.every((item) => item.comment.trim() !== '')).toBe(true);
    expect(sent.map((item) => item.comment)).not.toContain(clearedComment);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('示範中開啟設定不顯示金鑰欄位，也不讀寫 localStorage', async () => {
    await mount('/?demo=1');
    await click(findButton('偏好設定'));
    expect(text()).toContain('示範模式不使用金鑰');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('示範中輸入 MR 網址抓取：直接提示，不發請求', async () => {
    await mount('/?demo=1');
    const urlInput = container.querySelector('input[placeholder*="merge_requests"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(urlInput, 'https://gitlab.com/g/p/-/merge_requests/1');
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const fetchBtn = findButton('抓取');
    expect(fetchBtn.disabled).toBe(false);
    await click(fetchBtn);
    await waitFor(() => text().includes('示範模式不會連到 GitLab'), 'GitLab 提示');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('離開示範：replaceState 移除 ?demo=1、清掉範例資料回到乾淨首頁', async () => {
    await mount('/?demo=1&debug=1');
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');

    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    await click(findButton('離開示範'));

    expect(replaceSpy).toHaveBeenCalled();
    const lastUrl = String(replaceSpy.mock.calls.at(-1)![2]);
    expect(lastUrl).not.toContain('demo');
    expect(lastUrl).toContain('debug=1');
    expect(window.location.search).not.toContain('demo');
    expect(text()).not.toContain(DEMO_BANNER_TEXT);
    expect(text()).not.toContain(SAMPLE_ANALYSIS_RESULT.title);
    expect(container.querySelector('textarea')!.value).toBe('');
    expect(text()).toContain('用範例試試看');
  });
});

describe('預設勾選：正式與示範模式初始都不勾', () => {
  const expectNoneChecked = () => {
    const checkboxes = Array.from(container.querySelectorAll('button[aria-pressed]'));
    expect(checkboxes).toHaveLength(SAMPLE_ANALYSIS_RESULT.reviews.length);
    expect(checkboxes.filter((b) => b.getAttribute('aria-pressed') === 'true')).toEqual([]);
  };

  it('示範模式分析後全部不勾', async () => {
    await mount('/?demo=1');
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');
    expectNoneChecked();
  });

  it('正式模式（Gemini 回傳同一份結果）分析後全部不勾', async () => {
    storage.getItem.mockImplementation((key: string) =>
      key === SETTINGS_STORAGE_KEY ? JSON.stringify({ geminiApiKey: 'test-key' }) : null
    );
    fetchSpy.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(SAMPLE_ANALYSIS_RESULT) }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    await mount('/');
    await click(findButton('範例 Diff'));
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');

    expect(text()).not.toContain(DEMO_BANNER_TEXT);
    expect(fetchSpy).toHaveBeenCalled();
    expectNoneChecked();
  });
});

describe('示範模式文案（#45）', () => {
  it('橫幅：桌機完整文案、手機短文案各一行', async () => {
    await mount('/?demo=1');
    expect(DEMO_BANNER_TEXT).toBe('示範模式：分析和發布都是模擬的，不會連到 AI 或 GitLab');
    const banner = container.querySelector('[data-testid="demo-banner"]')!;
    const full = Array.from(banner.querySelectorAll('span')).find((s) => s.textContent === DEMO_BANNER_TEXT)!;
    const short = Array.from(banner.querySelectorAll('span')).find((s) => s.textContent === DEMO_BANNER_SHORT_TEXT)!;
    expect(full.className).toContain('hidden sm:inline');
    expect(short.className).toContain('sm:hidden');
    expect(short.className).toContain('truncate');
    expect(DEMO_BANNER_SHORT_TEXT.length).toBeLessThan(DEMO_BANNER_TEXT.length);
  });

  it('空白狀態：說明「已載入…按「分析」看範例結果」，不提 diff 在哪一側，也沒有「用範例試試看」按鈕', async () => {
    await mount('/?demo=1');
    const main = container.querySelector('main')!;
    expect(main.textContent).toContain(DEMO_HOME_HINT);
    expect(DEMO_HOME_HINT).toMatch(/^已載入/);
    expect(DEMO_HOME_HINT).toContain('按「分析」看範例結果');
    expect(main.textContent).not.toMatch(/左側|右側|左欄|右欄/);
    expect(main.textContent).not.toContain('用範例試試看');
  });

  it('確認視窗標題為「模擬發布（示範，不會送到 GitLab）」', async () => {
    await mount('/?demo=1');
    await click(findButton('分析'));
    await waitFor(() => text().includes(SAMPLE_ANALYSIS_RESULT.title), '分析結果');
    await click(container.querySelector<HTMLButtonElement>('button[aria-pressed]')!);
    await click(findButton('發布已選 1 則'));
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '確認視窗');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('模擬發布（示範，不會送到 GitLab）');
    expect(dialog.querySelector('h2')!.textContent).toBe(DEMO_PUBLISH_CONFIRM_TITLE);
  });
});

describe('進入示範', () => {
  it('空白首頁主要區域有「用範例試試看」，按下後進入示範並在網址加上 ?demo=1', async () => {
    await mount('/');
    expect(text()).not.toContain(DEMO_BANNER_TEXT);
    const main = container.querySelector('main')!;
    // 正式模式的空白首頁仍是原本的說明與按鈕
    expect(main.textContent).not.toContain(DEMO_HOME_HINT);
    await click(findButton('用範例試試看', main));
    expect(window.location.search).toContain('demo=1');
    expect(text()).toContain(DEMO_BANNER_TEXT);
    expect(container.querySelector('textarea')!.value).toBe(SAMPLE_GIT_DIFF);
  });
});

describe('非示範模式沒有金鑰時按「分析」', () => {
  it('顯示引導（用範例試試看／填寫金鑰），不發請求', async () => {
    await mount('/');
    await click(findButton('範例 Diff'));
    await click(findButton('分析'));

    const guide = container.querySelector('[role="alert"][aria-label="尚未設定金鑰"]');
    expect(guide).not.toBeNull();
    expect(guide!.textContent).toContain('尚未設定 Google Gemini API Key');
    findButton('用範例試試看', guide!);
    findButton('填寫金鑰', guide!);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 填寫金鑰 → 開啟正式設定
    await click(findButton('填寫金鑰', guide!));
    expect(container.querySelector('[role="alert"][aria-label="尚未設定金鑰"]')).toBeNull();
    expect(text()).toContain('API Key');
  });

  it('引導中的「用範例試試看」進入示範', async () => {
    await mount('/');
    await click(findButton('範例 Diff'));
    await click(findButton('分析'));
    const guide = container.querySelector('[role="alert"][aria-label="尚未設定金鑰"]')!;
    await click(findButton('用範例試試看', guide));
    expect(window.location.search).toContain('demo=1');
    expect(text()).toContain(DEMO_BANNER_TEXT);
  });
});
