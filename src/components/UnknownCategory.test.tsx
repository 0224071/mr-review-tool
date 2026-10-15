// @vitest-environment happy-dom
/**
 * #71：意見帶不認得的 category／severity（例如歷史紀錄裡的舊資料，或未經正規化的外部結果）時不會整頁白掉，
 * 改顯示預設分類「其他」的圖示與名稱、中等嚴重程度的樣式。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewCommentsList } from './ReviewCommentsList';
import { MRReviewItem } from '../types/review';

const review = (over: Partial<Record<keyof MRReviewItem, unknown>> = {}): MRReviewItem =>
  ({
    groupId: 'g1',
    category: 'bug',
    severity: 'high',
    file: 'src/FAKE-cart.ts',
    line: 10,
    codeSnippet: 'x',
    comment: 'FAKE 意見內文',
    suggestion: '',
    ...over,
  }) as MRReviewItem;

const render = (reviews: MRReviewItem[]) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <ReviewCommentsList
      reviews={reviews}
      groups={[{ id: 'g1', name: 'FAKE 群組', summary: '', files: [], additions: 0, deletions: 0 }]}
      selectedGroupId={null}
    />
  );
  return container;
};

/** 卡片底部的分類標籤（含圖示與名稱） */
const categoryBadges = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('span.bg-slate-100')).filter((el) => el.querySelector('svg'));

describe('不認得的分類', () => {
  it.each(['FAKE-unknown-category', 'toString', '__proto__', ''])('category「%s」顯示預設分類「其他」與圖示', (category) => {
    const container = render([review({ category })]);
    const badge = categoryBadges(container).find((el) => el.textContent === '其他');
    expect(badge).toBeDefined();
    expect(badge?.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('FAKE 意見內文');
  });

  it('不認得的 severity 以「中等」顯示，不會白掉', () => {
    const container = render([review({ severity: 'FAKE-critical' })]);
    expect(container.textContent).toContain('中等');
    expect(container.textContent).toContain('FAKE 意見內文');
  });

  it('認得的分類照常顯示自己的名稱', () => {
    const container = render([review({ category: 'performance' })]);
    expect(categoryBadges(container).map((el) => el.textContent)).toContain('效能優化');
  });
});
