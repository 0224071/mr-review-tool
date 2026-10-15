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
import { DEMO_BANNER_TEXT, DEMO_NOTICE } from './demo-mode';

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

    // 分析（假 provider 延遲後回傳範例結果）
    await click(findButton('分析'));
    expect(text()).toContain('分析中');
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

describe('進入示範', () => {
  it('空白首頁主要區域有「用範例試試看」，按下後進入示範並在網址加上 ?demo=1', async () => {
    await mount('/');
    expect(text()).not.toContain(DEMO_BANNER_TEXT);
    const main = container.querySelector('main')!;
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
