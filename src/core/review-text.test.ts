import { describe, it, expect } from 'vitest';
import { formatReviewForCopy, hasSuggestion, resolveEffectiveSuggestion } from './review-text';

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
