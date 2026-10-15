import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishConfirmationModal, describePublishMode } from './PublishConfirmationModal';
import { ReviewCommentsList } from './ReviewCommentsList';
import { ConfirmDialog } from './ConfirmDialog';
import { MRReviewItem } from '../types/review';
import { GitLabDiffRefs, ReviewPublishState } from '../types/gitlab';

const REFS: GitLabDiffRefs = { base_sha: 'b', start_sha: 's', head_sha: 'h' };

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

const renderModal = (items: Parameters<typeof PublishConfirmationModal>[0]['itemsToPublish'], diffRefs?: GitLabDiffRefs) =>
  renderToStaticMarkup(
    <PublishConfirmationModal
      isOpen
      onClose={() => {}}
      onConfirm={() => {}}
      mrInfo={null}
      mrUrl="https://gitlab.example.com/grp/proj/-/merge_requests/1"
      itemsToPublish={items}
      diffRefs={diffRefs}
      isPublishing={false}
    />
  );

describe('發布確認對話框', () => {
  it('逐則列出將發布的內容（草稿優先）、建議與發布方式', () => {
    const html = renderModal(
      [
        { review: review(), customComment: '改寫後的意見' },
        { review: review({ file: 'src/b.ts', lineVerified: false, comment: '未驗證的意見' }) },
      ],
      REFS
    );
    expect(html).toContain('將送出的審查意見 (2 則)');
    expect(html).toContain('改寫後的意見');
    expect(html).not.toContain('折扣金額未檢查負數');
    expect(html).toContain('建議：加上 Math.max(0, discount)');
    expect(html).toContain('行內留言 L10');
    expect(html).toContain('一般留言（行號未驗證）');
    expect(html).toContain('行內 1 · 一般留言 1');
    expect(html).toContain('包含 1 則行號未驗證的意見');
    expect(html).toContain('確認發送 (2 則意見)');
  });

  it('describePublishMode：缺 diff_refs 或沒有行號時說明原因', () => {
    expect(describePublishMode(review(), undefined)).toBe('一般留言（缺少 diff 版本資訊）');
    expect(describePublishMode(review({ line: null, newLine: null }), REFS)).toBe('一般留言（沒有行號）');
    expect(describePublishMode(review({ newLine: null, oldLine: 7 }), REFS)).toBe('行內留言 L7');
  });

  it('只使用 @theme 語意色彩', () => {
    const html = renderModal([{ review: review({ lineVerified: false }) }], REFS);
    expect(html).not.toMatch(/\b(?:bg|text|border)-(?:slate|indigo|amber|rose|sky|orange|emerald|white)\b/);
  });
});

const renderList = (publishStates: Record<number, ReviewPublishState>, isPublishing = false) =>
  renderToStaticMarkup(
    <ReviewCommentsList
      reviews={[review(), review({ file: 'src/b.ts', comment: '第二則意見內容', lineVerified: false })]}
      groups={[]}
      selectedGroupId={null}
      onPublishSingle={() => {}}
      publishStates={publishStates}
      isPublishing={isPublishing}
      selectedIndices={new Set()}
    />
  );

describe('清單上每則發布結果', () => {
  it('失敗：顯示錯誤訊息與「重試」按鈕', () => {
    const html = renderList({ 0: { status: 'error', errorMessage: '發布 Discussion 失敗 (403)：forbidden' } });
    expect(html).toContain('發布失敗：發布 Discussion 失敗 (403)：forbidden');
    expect(html).toMatch(/<button[^>]*>.*?重試<\/button>/);
  });

  it('發布進行中時停用重試按鈕', () => {
    const html = renderList({ 0: { status: 'error', errorMessage: 'x' } }, true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?重試<\/button>/);
  });

  it('成功：標示已發布；以一般留言發出的另外標示', () => {
    const html = renderList({
      0: { status: 'published', discussionId: 'd0', mode: 'inline' },
      1: { status: 'published', discussionId: 'd1', mode: 'general' },
    });
    expect(html.match(/已發布</g)).toHaveLength(2);
    expect(html.match(/以一般留言發布/g)).toHaveLength(1);
    expect(html).not.toContain('重試');
  });

  it('發布中：顯示狀態', () => {
    expect(renderList({ 1: { status: 'sending' } })).toContain('發布中...');
  });
});

describe('重複發布警告', () => {
  it('有未發布的項目時，主按鈕只發未發布的，另有「仍要全部發布」', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="有 1 則已發布過"
        confirmLabel="只發布未發布的 2 則"
        secondaryLabel="仍要全部發布"
        onSecondary={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(html).toContain('只發布未發布的 2 則');
    expect(html).toContain('仍要全部發布');
  });
});
