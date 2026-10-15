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
