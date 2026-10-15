/**
 * 審查意見文字組裝（複製到剪貼簿、發布內文共用的空建議判斷）
 */

/** 建議為 undefined、空字串或只有空白時視為沒有建議 */
export const hasSuggestion = (suggestion: string | undefined): suggestion is string =>
  !!suggestion?.trim();

/** 「複製」按鈕的文字；沒有建議時不輸出「修改建議」段落 */
export const formatReviewForCopy = (
  severityLabel: string,
  categoryLabel: string,
  comment: string,
  suggestion: string | undefined
): string => {
  const head = `**[${severityLabel}] ${categoryLabel}**: ${comment}`;
  return hasSuggestion(suggestion) ? `${head}\n\n> 💡 **修改建議**：\n> ${suggestion}` : head;
};

/**
 * 實際要輸出的建議：有草稿（不是 undefined）就用草稿，即使使用者清空了也不退回 AI 原本的建議；
 * 沒有草稿才用原值。空建議回傳空字串，其餘回傳 trim 過的內容。
 */
export const resolveEffectiveSuggestion = (
  draft: string | undefined,
  original: string | undefined
): string => {
  const suggestion = draft !== undefined ? draft : original;
  return hasSuggestion(suggestion) ? suggestion.trim() : '';
};

/** 意見內文為 undefined、空字串或只有空白時視為空的，不能複製或發布 */
export const hasCommentText = (comment: string | undefined): comment is string => !!comment?.trim();

/**
 * 實際要輸出的意見內文：有草稿（不是 undefined）就用草稿，即使使用者清空了也不退回 AI 原本的內文；
 * 沒有草稿才用原值。空內文回傳空字串，其餘回傳 trim 過的內容。
 */
export const resolveEffectiveComment = (draft: string | undefined, original: string | undefined): string => {
  const comment = draft !== undefined ? draft : original;
  return hasCommentText(comment) ? comment.trim() : '';
};

/** 發布前過濾：實際內文（草稿優先、清空不退回 AI 原值）是空的意見不發布；範例／示範結果也一樣 */
export const filterPublishableItems = <T extends { review: { comment: string }; customComment?: string }>(
  items: T[]
): T[] => items.filter((item) => hasCommentText(resolveEffectiveComment(item.customComment, item.review.comment)));

/** 內文是空的提示文字（清單就地提示、發布被擋下時共用） */
export const EMPTY_COMMENT_MESSAGE = '內文是空的，不會發布';

/** 編輯內文後的勾選：清空（或只剩空白）時取消勾選；補上內文不自動勾回，原樣回傳 */
export const deselectIfCommentEmpty = (selected: Set<number>, index: number, comment: string): Set<number> => {
  if (hasCommentText(comment) || !selected.has(index)) return selected;
  const next = new Set(selected);
  next.delete(index);
  return next;
};
