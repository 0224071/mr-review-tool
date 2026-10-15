import type { GitLabAuthor } from '../types/gitlab';

/**
 * 作者顯示的共同規則：顯示名稱為主要文字，@username 為輔助；缺顯示名稱時以 username 為主要文字。
 * 不會出現「@顯示名稱」。
 */
export function authorParts(author: GitLabAuthor): { primary: string; handle: string | null } {
  const name = author.name.trim();
  const username = author.username.trim();
  return { primary: name || username, handle: name && username ? `@${username}` : null };
}

/** 純文字情境（例如系統提示）用的作者文字：「顯示名稱（@username）」 */
export function formatAuthorText(author: GitLabAuthor): string {
  const { primary, handle } = authorParts(author);
  return handle ? `${primary}（${handle}）` : primary;
}
