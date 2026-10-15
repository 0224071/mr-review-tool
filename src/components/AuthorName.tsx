import React from 'react';
import type { GitLabAuthor } from '../types/gitlab';
import { authorParts } from '../core/author-format';

/** 作者顯示：顯示名稱為主要文字，旁邊灰色小字 @username */
export const AuthorName: React.FC<{ author: GitLabAuthor }> = ({ author }) => {
  const { primary, handle } = authorParts(author);
  return (
    <span className="font-semibold">
      {primary}
      {handle && (
        <>
          {' '}
          <span className="text-[0.85em] font-normal text-muted">{handle}</span>
        </>
      )}
    </span>
  );
};
