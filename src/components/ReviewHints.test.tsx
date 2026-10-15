// @vitest-environment happy-dom
/**
 * #45：全選旁的提示、編輯框與勾選框的 label、內文清空的卡片淡化、點停用按鈕時說明原因、
 * 確認視窗預覽與實際送出一致（resolveEffectiveComment）、手機頁首只留圖示但保留名稱。
 */
import { act, useState } from 'react';
import { createRoot, Root as ReactRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisResultView, PUBLISH_NONE_SELECTED_REASON } from './AnalysisResultView';
import { EMPTY_COMMENT_REASON } from './ReviewCommentsList';
import { PublishConfirmationModal } from './PublishConfirmationModal';
import { Header } from './Header';
import { DISABLED_REASON_TIMEOUT_MS } from './DisabledReason';
import { MRAnalysisResult, MRReviewItem } from '../types/review';
import { DraftEdits } from '../core/history-store';

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
  reviews: [review(), review({ file: 'src/b.ts', line: null, newLine: null, lineVerified: false, comment: '第二則' })],
};

let container: HTMLDivElement;
let root: ReactRoot;

function Harness({ initialDrafts = {} }: { initialDrafts?: DraftEdits }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<DraftEdits>(initialDrafts);
  return (
    <AnalysisResultView
      result={RESULT}
      mrUrl="https://gitlab.example.com/g/p/-/merge_requests/1"
      isGitLabConfigured
      onPublishSingleReview={() => {}}
      selectedIndices={selected}
      onSelectedIndicesChange={setSelected}
      draftEdits={drafts}
      onDraftEditsChange={setDrafts}
      onPublishBatchReviews={() => {}}
    />
  );
}

const render = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
};

const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const byLabel = <T extends Element = HTMLElement>(label: string) => {
  const el = container.querySelector<T>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`找不到 aria-label「${label}」`);
  return el;
};

const cards = () => Array.from(container.querySelectorAll<HTMLElement>('div[tabindex="0"]'));
/** 卡片第一列裡勾選框、嚴重度、檔名那一組（淡化套在這裡） */
const headerGroupOf = (card: HTMLElement) => card.firstElementChild!.firstElementChild as HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('意見清單的提示與 label', () => {
  it('「全選」旁有灰字「勾選要發布的意見」', async () => {
    await render(<Harness />);
    const selectAll = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '全選')!;
    const hint = selectAll.nextElementSibling!;
    expect(hint.textContent).toBe('勾選要發布的意見');
    expect(hint.className).toContain('text-muted-light');
  });

  it('勾選框有 aria-label（含檔名與行號），編輯框有 aria-label「編輯審查意見內文」', async () => {
    await render(<Harness />);
    expect(byLabel('勾選此意見：src/cart.ts:L10').getAttribute('aria-pressed')).toBe('false');
    expect(byLabel('勾選此意見：src/b.ts').getAttribute('aria-pressed')).toBe('false');

    await click(cards()[0].querySelector('button[aria-label="編輯草稿"]')!);
    const textarea = byLabel<HTMLTextAreaElement>('編輯審查意見內文');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('折扣金額未檢查負數');
  });

  it('內文清空的卡片淡化；編輯中不淡化，內文非空的卡片也不淡化', async () => {
    await render(<Harness initialDrafts={{ 0: { comment: '  ', suggestion: '' } }} />);
    expect(headerGroupOf(cards()[0]).className).toContain('opacity-50');
    expect(headerGroupOf(cards()[1]).className).not.toContain('opacity-50');

    await click(cards()[0].querySelector('button[aria-label="編輯草稿"]')!);
    expect(headerGroupOf(cards()[0]).className).not.toContain('opacity-50');
  });
});

describe('點停用的按鈕時說明原因（手機看不到 title）', () => {
  it('內文清空那則的勾選、複製、單則發布：點擊落在外層時在卡片內顯示原因，數秒後消失', async () => {
    vi.useFakeTimers();
    await render(<Harness initialDrafts={{ 0: { comment: '', suggestion: '' } }} />);
    const card = cards()[0];
    for (const label of ['勾選此意見：src/cart.ts:L10', '複製意見', '發布單則']) {
      const button = card.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
      expect(button.disabled).toBe(true);
      // 停用按鈕有 pointer-events: none，實際點擊會落在外層
      expect(button.className).toContain('disabled:pointer-events-none');
      await click(button.parentElement!);
      expect(card.textContent).toContain(EMPTY_COMMENT_REASON);
      await act(async () => vi.advanceTimersByTime(DISABLED_REASON_TIMEOUT_MS));
      expect(card.textContent).not.toContain(EMPTY_COMMENT_REASON);
    }
    // 其他卡片不顯示
    expect(cards()[1].textContent).not.toContain(EMPTY_COMMENT_REASON);
  });

  it('可用的按鈕點了照常動作，不顯示原因', async () => {
    await render(<Harness />);
    const checkbox = byLabel<HTMLButtonElement>('勾選此意見：src/cart.ts:L10');
    await click(checkbox);
    expect(checkbox.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain(EMPTY_COMMENT_REASON);
  });

  it('「發布已選 0 則」停用時點擊，發布列上方說明要先勾選；勾選後按鈕可用', async () => {
    await render(<Harness />);
    const publish = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('發布已選'))!;
    expect(publish.disabled).toBe(true);
    await click(publish.parentElement!);
    const bar = byLabel('發布列');
    expect(bar.querySelector('[role="status"]')?.textContent).toBe(PUBLISH_NONE_SELECTED_REASON);

    await click(byLabel('勾選此意見：src/cart.ts:L10'));
    const enabled = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('發布已選 1 則'))!;
    expect(enabled.disabled).toBe(false);
  });
});

describe('發布確認視窗', () => {
  const baseProps = {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
    mrInfo: null,
    mrUrl: '',
    isPublishing: false,
  };

  it('預覽用 resolveEffectiveComment：顯示 trim 過的草稿；草稿清空不退回 AI 原文', async () => {
    await render(
      <PublishConfirmationModal
        {...baseProps}
        itemsToPublish={[
          { review: review({ comment: 'AI 原文' }), customComment: '  修改後的內文  \n' },
          { review: review({ comment: '第二則 AI 原文' }), customComment: '' },
        ]}
      />
    );
    const previews = Array.from(container.querySelectorAll('li > p.text-ink')).map((p) => p.textContent);
    expect(previews).toEqual(['修改後的內文', '']);
  });

  it('有傳 title 時用它當標題與對話框名稱，否則用預設標題', async () => {
    await render(<PublishConfirmationModal {...baseProps} itemsToPublish={[{ review: review() }]} title="自訂標題" />);
    expect(container.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('自訂標題');
    expect(container.querySelector('h2')!.textContent).toBe('自訂標題');

    await render(<PublishConfirmationModal {...baseProps} itemsToPublish={[{ review: review() }]} />);
    expect(container.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('確認發布審查意見至 GitLab');
  });
});

describe('頁首（手機一行）', () => {
  it('手機只顯示短名稱「MR 審查」；歷史紀錄、偏好設定在手機只顯示圖示，名稱由 aria-label 提供', async () => {
    await render(<Header onOpenSettings={() => {}} hasApiKey onOpenHistory={() => {}} historyCount={3} />);
    const h1 = container.querySelector('h1')!;
    const [short, full] = Array.from(h1.querySelectorAll('span'));
    expect(short.textContent).toBe('MR 審查');
    expect(short.className).toContain('sm:hidden');
    expect(full.textContent).toBe('GitLab MR 講解與審查工具');
    expect(full.className).toContain('hidden sm:inline');

    const history = byLabel('歷史紀錄 3');
    expect(Array.from(history.querySelectorAll('span')).find((s) => s.textContent === '歷史紀錄')!.className).toContain(
      'hidden sm:inline'
    );
    const settings = byLabel('偏好設定');
    expect(settings.querySelector('span')!.className).toContain('hidden sm:inline');
  });

  it('沒有金鑰時設定按鈕的名稱是「填寫金鑰」', async () => {
    await render(<Header onOpenSettings={() => {}} hasApiKey={false} />);
    expect(byLabel('填寫金鑰').tagName).toBe('BUTTON');
  });
});
