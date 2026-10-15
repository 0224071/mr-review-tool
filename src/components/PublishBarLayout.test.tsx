// @vitest-environment happy-dom
/**
 * 浮動發布列與意見卡片版面（#41、#43）：發布列高度寫進 --publish-bar-space 供頁面與清單避開；
 * 意見內文和「內文是空的」提示獨立一行，不和檔名、操作按鈕擠在同一列。實際寬度與重疊由 e2e/demo-layout.spec.ts 量測。
 */
import { act } from 'react';
import { createRoot, Root as ReactRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisResultView } from './AnalysisResultView';
import { MROverviewCard } from './MROverviewCard';
import { EMPTY_COMMENT_MESSAGE } from '../core/review-text';
import { MRAnalysisResult, MRReviewItem } from '../types/review';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const review = (over: Partial<MRReviewItem> = {}): MRReviewItem => ({
  groupId: 'g1',
  category: 'bug',
  severity: 'high',
  file: 'src/hooks/useCouponRedemption.ts',
  line: 10,
  newLine: 10,
  oldLine: null,
  lineVerified: true,
  codeSnippet: 'x',
  comment: '折扣金額未檢查負數',
  suggestion: '加上 Math.max(0, discount)',
  ...over,
});

const RESULT: MRAnalysisResult = {
  schemaVersion: 1,
  title: '測試 MR',
  description: '',
  summary: ['摘要'],
  testSuggestions: [],
  groups: [{ id: 'g1', name: '購物車', summary: '', files: ['src/hooks/useCouponRedemption.ts'], additions: 1, deletions: 0 }],
  graph: { nodes: [], edges: [] },
  reviews: [review(), review({ comment: '  ' })],
};

let container: HTMLDivElement;
let root: ReactRoot;

const render = async (mrUrl?: string) => {
  await act(async () => {
    root.render(
      <AnalysisResultView
        result={RESULT}
        mrUrl={mrUrl}
        onPublishSingleReview={() => {}}
        selectedIndices={new Set()}
        onSelectedIndicesChange={() => {}}
        draftEdits={{}}
        onDraftEditsChange={() => {}}
      />
    );
  });
};

const barSpace = () => document.documentElement.style.getPropertyValue('--publish-bar-space');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** 模擬瀏覽器量到的發布列高度與 sticky 的 bottom（happy-dom 不套 CSS，兩者都量不到） */
const stubBarMetrics = (offsetHeight: number, bottom: string) => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(offsetHeight);
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = original(el, pseudo);
    if (el instanceof HTMLElement && el.getAttribute('aria-label') === '發布列') {
      return new Proxy(style, { get: (target, key) => (key === 'bottom' ? bottom : Reflect.get(target, key)) });
    }
    return style;
  });
};

describe('浮動發布列留出的空間（#41）', () => {
  it('連結 MR 顯示發布列時設定 --publish-bar-space = 高度 + getComputedStyle(bar).bottom，卸載後移除', async () => {
    stubBarMetrics(60, '24px');
    await render('https://gitlab.example.com/g/p/-/merge_requests/1');
    expect(container.textContent).toContain('發布已選 0 則');
    // 用實際的 bottom（24px），不是寫死的 16px
    expect(barSpace()).toBe('84px');

    act(() => root.unmount());
    expect(barSpace()).toBe('');
    root = createRoot(container);
  });

  it('bottom 讀不到數值（auto）時只算發布列高度', async () => {
    stubBarMetrics(60, 'auto');
    await render('https://gitlab.example.com/g/p/-/merge_requests/1');
    expect(barSpace()).toBe('60px');
  });

  it('沒有發布列（未連結 MR）時不留空間', async () => {
    await render(undefined);
    expect(container.textContent).not.toContain('發布已選');
    expect(barSpace()).toBe('');
  });

  it('意見清單底部與捲動留白都使用 --publish-bar-space', async () => {
    await render('https://gitlab.example.com/g/p/-/merge_requests/1');
    const card = container.querySelector('div[tabindex="0"]')!;
    const list = card.parentElement!;
    expect(list.className).toContain('pb-[var(--publish-bar-space,0px)]');
    expect(list.className).toContain('scroll-pb-[var(--publish-bar-space,0px)]');
  });
});

describe('意見卡片版面（#41 hover 按鈕、#43 內文欄寬）', () => {
  it('內文與空內文提示不在檔名／操作按鈕那一列，而是卡片內獨立的一行', async () => {
    await render('https://gitlab.example.com/g/p/-/merge_requests/1');
    const cards = Array.from(container.querySelectorAll<HTMLElement>('div[tabindex="0"]'));
    expect(cards).toHaveLength(2);

    // 卡片第一列：勾選框、檔名與操作按鈕
    const headerRow = (card: HTMLElement) => card.firstElementChild!;
    expect(headerRow(cards[0]).contains(cards[0].querySelector('button[aria-label="發布單則"]'))).toBe(true);

    const body = Array.from(cards[0].querySelectorAll('p')).find((p) => p.textContent === '折扣金額未檢查負數')!;
    expect(body).toBeTruthy();
    expect(headerRow(cards[0]).contains(body)).toBe(false);
    expect(headerRow(cards[0]).contains(cards[0].querySelector('button[aria-pressed]'))).toBe(true);

    const hint = cards[1].querySelector('[role="status"]')!;
    expect(hint.textContent).toContain(EMPTY_COMMENT_MESSAGE);
    expect(headerRow(cards[1]).contains(hint)).toBe(false);
  });
});

describe('MR 標題列（#43）', () => {
  it('分析時間與模型標記包在同一組，手機寬度時整組換到標題下一行，sm 以上維持同一行', async () => {
    await act(async () => {
      root.render(
        <MROverviewCard result={RESULT} hasGitLabMr analyzedAtLabel="2026/10/15 12:00" generatedByLabel="示範 · 範例分析" />
      );
    });
    const title = container.querySelector('h2')!;
    expect(title.textContent).toBe('測試 MR');
    expect(title.className).toContain('min-w-0');
    const meta = Array.from(container.querySelectorAll('div')).find(
      (d) => d.textContent === '分析於 2026/10/15 12:00示範 · 範例分析'
    )!;
    expect(meta).toBeTruthy();
    expect(meta.className).toContain('basis-full');
    expect(meta.className).toContain('sm:basis-auto');
    expect(meta.parentElement).toBe(title.parentElement);
    expect(title.parentElement!.className).toContain('flex-wrap');
    expect(title.parentElement!.className).toContain('sm:flex-nowrap');
  });
});
