import { describe, it, expect } from 'vitest';
import { formatReviewForCopy, hasSuggestion } from './review-text';

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
