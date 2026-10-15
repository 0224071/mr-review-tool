import { MRReviewItem, WritingCheckViolation } from '../types/review';

/**
 * Common vague terms in code reviews (Traditional & Simplified Chinese + English)
 */
export const VAGUE_KEYWORDS: string[] = [
  '可能需要考慮',
  '可能要考慮',
  '可能需要',
  '可能可以',
  '或者可以考慮',
  '或許可以考慮',
  '不妨考慮',
  '或許可以',
  '應該可以',
  '似乎需要',
  '說不定',
  '感覺好像',
  '似乎',
  '好像',
  '也許',
  '可能',
  '或许',
  '应该可以',
  '好像可以',
  'maybe',
  'perhaps',
  'might want to consider',
  'could possibly',
  'should probably',
  'feels like',
];

/**
 * Checks review comments against engineering writing guidelines:
 * 1. Length constraint (concise, <= 80 characters recommended)
 * 2. Avoid vague phrasing (advise direct actionable instructions)
 */
export function checkReviewComment(review: MRReviewItem): WritingCheckViolation[] {
  const violations: WritingCheckViolation[] = [];
  const text = (review.comment || '').trim();

  // Length check: > 80 chars
  if (text.length > 80) {
    violations.push({
      type: 'too_long',
      message: `評論長度為 ${text.length} 字（建議保持在 80 字以內，句子簡短且一事一議）。`,
      detail: '將長文拆成多個獨立重點，或簡化為直截了當的說明。',
    });
  }

  // Vague wording check
  const matchedTerms = VAGUE_KEYWORDS.filter((term) => text.includes(term));
  if (matchedTerms.length > 0) {
    const uniqueTerms = Array.from(new Set(matchedTerms));
    violations.push({
      type: 'vague_wording',
      message: `包含模糊用語「${uniqueTerms.slice(0, 3).join('、')}」`,
      detail: '建議寫成具體可執行的動作（例如改用「請在組件卸載時調用 removeEventListener」），避免不確定的語氣。',
    });
  }

  return violations;
}
