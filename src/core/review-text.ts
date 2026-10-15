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
