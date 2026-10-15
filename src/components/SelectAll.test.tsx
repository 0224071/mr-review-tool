// @vitest-environment happy-dom
/**
 * 「全選」與「發布已選 N 則」（#40）：全選含行號未驗證的意見，內文是空的不勾；N 等於實際送出則數。
 * 這裡不經過示範模式，直接掛載正式畫面使用的元件。
 */
import { act, useState, type ComponentProps } from 'react';
import { createRoot, Root as ReactRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisResultView } from './AnalysisResultView';
import { MRAnalysisResult, MRReviewItem } from '../types/review';
import { DraftEdits } from '../core/history-store';
import { filterPublishableItems } from '../core/review-text';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const review = (over: Partial<MRReviewItem> = {}): MRReviewItem => ({
  groupId: 'g1',
  category: 'bug',
  severity: 'high',
  file: 'src/cart.ts',
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
  groups: [{ id: 'g1', name: '購物車', summary: '', files: ['src/cart.ts'], additions: 1, deletions: 0 }],
  graph: { nodes: [], edges: [] },
  reviews: [
    review(),
    review({ file: 'src/b.ts', lineVerified: false, comment: '行號對不上，改以一般留言發出' }),
    review({ severity: 'low', comment: '   ' }),
    review({ severity: 'medium', comment: '第四則意見' }),
  ],
};

type PublishItems = Parameters<NonNullable<ComponentProps<typeof AnalysisResultView>['onPublishBatchReviews']>>[0];

let container: HTMLDivElement;
let root: ReactRoot;
let onPublish: ReturnType<typeof vi.fn<(items: PublishItems) => void>>;

function Harness({ initialDrafts = {} }: { initialDrafts?: DraftEdits }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<DraftEdits>(initialDrafts);
  return (
    <AnalysisResultView
      result={RESULT}
      mrUrl="https://gitlab.example.com/g/p/-/merge_requests/1"
      isGitLabConfigured
      selectedIndices={selected}
      onSelectedIndicesChange={setSelected}
      draftEdits={drafts}
      onDraftEditsChange={setDrafts}
      onPublishBatchReviews={onPublish}
    />
  );
}

const mount = async (drafts?: DraftEdits) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness initialDrafts={drafts} />));
};

const findButton = (label: string) => {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim().includes(label));
  if (!btn) throw new Error(`找不到按鈕「${label}」`);
  return btn as HTMLButtonElement;
};

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** 依卡片內文找到該則的勾選框 */
const checkboxFor = (comment: string) => {
  const boxes = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
  const box = boxes.find((b) => (b.closest('div[tabindex="0"]')?.textContent ?? '').includes(comment));
  if (!box) throw new Error(`找不到「${comment}」的勾選框`);
  return box;
};

const pressed = () =>
  Array.from(container.querySelectorAll('button[aria-pressed="true"]')).length;

beforeEach(() => {
  onPublish = vi.fn<(items: PublishItems) => void>();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('全選（#40）', () => {
  it('勾到所有可發布的意見，包含行號未驗證、會以一般留言發出的那則', async () => {
    await mount();
    expect(pressed()).toBe(0);

    await click(findButton('全選'));

    expect(checkboxFor('行號對不上，改以一般留言發出').getAttribute('aria-pressed')).toBe('true');
    expect(checkboxFor('折扣金額未檢查負數').getAttribute('aria-pressed')).toBe('true');
    expect(checkboxFor('第四則意見').getAttribute('aria-pressed')).toBe('true');
    expect(pressed()).toBe(3);
  });

  it('內文是空的（原值或草稿清空）不勾', async () => {
    await mount({ 3: { comment: '', suggestion: '' } });
    await click(findButton('全選'));

    const disabled = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).filter((b) => b.disabled);
    expect(disabled).toHaveLength(2);
    expect(disabled.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(pressed()).toBe(2);
  });

  it('全部勾選後再按一次全選會全部取消', async () => {
    await mount();
    await click(findButton('全選'));
    expect(pressed()).toBe(3);
    await click(findButton('全選'));
    expect(pressed()).toBe(0);
  });

  it('「發布已選 N 則」的 N 等於實際送出（filterPublishableItems 後）的則數', async () => {
    await mount();
    await click(findButton('全選'));
    await click(findButton('發布已選 3 則'));

    expect(onPublish).toHaveBeenCalledTimes(1);
    const sent = onPublish.mock.calls[0][0];
    expect(sent).toHaveLength(3);
    expect(filterPublishableItems(sent)).toHaveLength(3);
    expect(sent.map((item) => item.index).sort()).toEqual([0, 1, 3]);
    expect(sent.some((item) => item.review.lineVerified === false)).toBe(true);
  });
});
