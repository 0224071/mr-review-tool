import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishConfirmationModal, describePublishMode } from './PublishConfirmationModal';
import { ReviewCommentsList, runUnlessPublishing } from './ReviewCommentsList';
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

  it('建議為空（或只有空白）時不顯示「建議：」整行', () => {
    const html = renderModal([{ review: review({ suggestion: '' }) }, { review: review({ file: 'src/b.ts', suggestion: '  \n ' }) }], REFS);
    expect(html).not.toContain('建議：');
    expect(renderModal([{ review: review() }], REFS)).toContain('建議：');
  });

  it('草稿把建議清空時不顯示 AI 原本的建議', () => {
    const html = renderModal([{ review: review(), customSuggestion: '' }, { review: review({ file: 'src/b.ts' }), customSuggestion: '  ' }], REFS);
    expect(html).not.toContain('建議：');
    expect(html).not.toContain('加上 Math.max(0, discount)');
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

const renderList = (
  publishStates: Record<number, ReviewPublishState>,
  isPublishing = false,
  reviews: MRReviewItem[] = [review(), review({ file: 'src/b.ts', comment: '第二則意見內容', lineVerified: false })]
) =>
  renderToStaticMarkup(
    <ReviewCommentsList
      reviews={reviews}
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

  it('發布進行中時停用單則發布按鈕', () => {
    const html = renderList({}, true);
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="發布單則"/g)).toHaveLength(2);
    const idle = renderList({}, false);
    expect(idle).toMatch(/aria-label="發布單則"/);
    expect(idle).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="發布單則"/);
  });

  it('runUnlessPublishing：發布進行中時忽略單則發布／重試的點擊', () => {
    const calls: string[] = [];
    runUnlessPublishing(true, () => calls.push('blocked'));
    runUnlessPublishing(false, () => calls.push('ok'));
    expect(calls).toEqual(['ok']);
  });

  it('建議為空時卡片不顯示「修改建議」區塊', () => {
    expect(renderList({}, false, [review({ suggestion: '' })])).not.toContain('修改建議：');
    expect(renderList({}, false, [review()])).toContain('修改建議：');
  });

  it('發布中：顯示狀態', () => {
    expect(renderList({ 1: { status: 'sending' } })).toContain('發布中...');
  });
});

describe('內文清空的意見（一般模式）', () => {
  const renderEmpty = (blockEmptyComment: boolean) =>
    renderToStaticMarkup(
      <ReviewCommentsList
        reviews={[review(), review({ file: 'src/b.ts', comment: '第二則意見內容' })]}
        groups={[]}
        selectedGroupId={null}
        onPublishSingle={() => {}}
        selectedIndices={new Set()}
        draftEdits={{ 0: { comment: '  \n ', suggestion: '' } }}
        blockEmptyComment={blockEmptyComment}
      />
    );

  it('就地顯示「內文是空的，不會發布」，勾選框、複製與單則發布都停用；只用 @theme 語意色彩', () => {
    const html = renderEmpty(true);
    expect(html.match(/內文是空的，不會發布<\/span>/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-pressed="false"/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="複製意見"/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="發布單則"/g)).toHaveLength(1);
    const hint = html.match(/<span role="status"[^>]*>.*?<\/span>/)?.[0] ?? '';
    expect(hint).toContain('text-danger-text');
    expect(hint).not.toMatch(/\b(?:bg|text|border)-(?:slate|indigo|amber|rose|sky|orange|emerald|white)\b/);
  });

  it('內文清空且發布失敗時，重試按鈕也停用', () => {
    const html = renderToStaticMarkup(
      <ReviewCommentsList
        reviews={[review()]}
        groups={[]}
        selectedGroupId={null}
        onPublishSingle={() => {}}
        publishStates={{ 0: { status: 'error', errorMessage: 'x' } }}
        selectedIndices={new Set()}
        draftEdits={{ 0: { comment: '', suggestion: '' } }}
        blockEmptyComment
      />
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?重試<\/button>/);
  });

  it('未開啟（示範模式）時維持原本行為', () => {
    const html = renderEmpty(false);
    expect(html).not.toContain('內文是空的，不會發布');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="複製意見"/);
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

  it('cancelIsPrimary：預設 focus 在「取消」，發布類按鈕不搶 focus', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        cancelIsPrimary
        title="有 1 則已發布過"
        confirmLabel="只發布未發布的 2 則"
        secondaryLabel="仍要全部發布"
        onSecondary={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
    const focused = buttons.filter((b) => b.includes('autofocus'));
    expect(focused).toHaveLength(1);
    expect(focused[0]).toContain('>取消<');
    expect(focused[0]).toContain('bg-gitlab');
    expect(buttons.find((b) => b.includes('只發布未發布的 2 則'))).not.toContain('bg-gitlab');
  });

  it('未設定 cancelIsPrimary（刪除紀錄）時維持 focus 在確認按鈕', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open danger title="刪除這筆紀錄？" confirmLabel="刪除" onConfirm={() => {}} onCancel={() => {}} />
    );
    const focused = (html.match(/<button[^>]*>[^<]*<\/button>/g) ?? []).filter((b) => b.includes('autofocus'));
    expect(focused).toHaveLength(1);
    expect(focused[0]).toContain('>刪除<');
  });
});
