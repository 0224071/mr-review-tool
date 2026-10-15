import { describe, it, expect } from 'vitest';
import {
  deselectIfCommentEmpty,
  filterPublishableItems,
  formatReviewForCopy,
  hasCommentText,
  hasSuggestion,
  resolveEffectiveComment,
  resolveEffectiveSuggestion,
} from './review-text';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';

describe('formatReviewForCopy', () => {
  it('有建議時保留原格式', () => {
    expect(formatReviewForCopy('高', '安全性', '有問題', '改成 X')).toBe(
      '**[高] 安全性**: 有問題\n\n> 💡 **修改建議**：\n> 改成 X'
    );
  });

  it.each([
    ['undefined', undefined],
    ['空字串', ''],
    ['只有空白', '  \n\t '],
  ])('建議為%s時不含修改建議段落', (_label, suggestion) => {
    const text = formatReviewForCopy('高', '安全性', '有問題', suggestion);
    expect(text).toBe('**[高] 安全性**: 有問題');
    expect(text).not.toContain('修改建議');
  });
});

describe('hasSuggestion', () => {
  it('只在有非空白內容時為 true', () => {
    expect(hasSuggestion('x')).toBe(true);
    expect(hasSuggestion(undefined)).toBe(false);
    expect(hasSuggestion('')).toBe(false);
    expect(hasSuggestion('   ')).toBe(false);
  });
});

describe('resolveEffectiveSuggestion', () => {
  const AI = 'AI 原本的建議';

  it('草稿清空（空字串）：不退回 AI 原本的建議', () => {
    expect(resolveEffectiveSuggestion('', AI)).toBe('');
  });

  it('草稿只有空白：視為沒有建議', () => {
    expect(resolveEffectiveSuggestion('  \n\t ', AI)).toBe('');
  });

  it('沒有草稿：用原值（trim 過）', () => {
    expect(resolveEffectiveSuggestion(undefined, AI)).toBe(AI);
    expect(resolveEffectiveSuggestion(undefined, `  ${AI}\n`)).toBe(AI);
    expect(resolveEffectiveSuggestion(undefined, undefined)).toBe('');
    expect(resolveEffectiveSuggestion(undefined, '  ')).toBe('');
  });

  it('草稿有內容：用草稿並 trim', () => {
    expect(resolveEffectiveSuggestion('  改成 Y \n', AI)).toBe('改成 Y');
  });

  it('複製路徑：草稿清空後複製文字不含修改建議段落，也不含 AI 原建議', () => {
    const text = formatReviewForCopy('高', '安全性', '有問題', resolveEffectiveSuggestion('', AI));
    expect(text).toBe('**[高] 安全性**: 有問題');
    expect(text).not.toContain(AI);
    expect(formatReviewForCopy('高', '安全性', '有問題', resolveEffectiveSuggestion(' 改成 Y ', AI))).toBe(
      '**[高] 安全性**: 有問題\n\n> 💡 **修改建議**：\n> 改成 Y'
    );
  });
});

describe('hasCommentText', () => {
  it('只在有非空白內容時為 true', () => {
    expect(hasCommentText('x')).toBe(true);
    expect(hasCommentText(undefined)).toBe(false);
    expect(hasCommentText('')).toBe(false);
    expect(hasCommentText(' \n\t ')).toBe(false);
  });
});

describe('resolveEffectiveComment', () => {
  const AI = 'AI 原本的意見';

  it('草稿清空或只有空白：視為空的，不退回 AI 原值', () => {
    expect(resolveEffectiveComment('', AI)).toBe('');
    expect(resolveEffectiveComment('  \n ', AI)).toBe('');
  });

  it('沒有草稿用原值；有草稿用草稿；都 trim', () => {
    expect(resolveEffectiveComment(undefined, ` ${AI}\n`)).toBe(AI);
    expect(resolveEffectiveComment(undefined, undefined)).toBe('');
    expect(resolveEffectiveComment('  改寫的意見 ', AI)).toBe('改寫的意見');
  });
});

describe('deselectIfCommentEmpty', () => {
  it('已勾選的意見內文清空（或只剩空白）時取消勾選', () => {
    expect(deselectIfCommentEmpty(new Set([1, 2]), 1, '')).toEqual(new Set([2]));
    expect(deselectIfCommentEmpty(new Set([1, 2]), 2, '  \n')).toEqual(new Set([1]));
  });

  it('補上內文後不自動勾回；沒有變動時回傳原本的 Set', () => {
    const afterClear = deselectIfCommentEmpty(new Set([1]), 1, '');
    const afterRefill = deselectIfCommentEmpty(afterClear, 1, '補上的內文');
    expect(afterRefill.has(1)).toBe(false);
    expect(afterRefill).toBe(afterClear);
    const untouched = new Set([3]);
    expect(deselectIfCommentEmpty(untouched, 1, '')).toBe(untouched);
  });
});

describe('filterPublishableItems', () => {
  it('範例資料（sample diff / demo 結果）內文清空也不發布，不退回 AI 原本的內文', () => {
    const [first, second, third] = SAMPLE_ANALYSIS_RESULT.reviews;
    const items = [
      { review: first, customComment: '', index: 0 },
      { review: second, customComment: '  \n\t ', index: 1 },
      { review: third, index: 2 },
    ];
    expect(filterPublishableItems(items).map((item) => item.index)).toEqual([2]);
  });

  it('有內文（草稿或原值）的意見保留', () => {
    const review = SAMPLE_ANALYSIS_RESULT.reviews[0];
    expect(filterPublishableItems([{ review, customComment: '改過的內文', index: 0 }, { review, index: 1 }])).toHaveLength(2);
  });
});
