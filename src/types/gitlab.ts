/**
 * GitLab REST API v4 Types
 */

export interface GitLabDiffRefs {
  base_sha: string;
  head_sha: string;
  start_sha: string;
}

export interface GitLabMergeRequestInfo {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  target_branch: string;
  source_branch: string;
  author: {
    id: number;
    name: string;
    username: string;
    avatar_url?: string;
  };
  diff_refs?: GitLabDiffRefs;
}

export interface GitLabDiscussionPosition {
  base_sha: string;
  start_sha: string;
  head_sha: string;
  position_type: 'text';
  new_path: string;
  old_path: string;
  new_line?: number | null;
  old_line?: number | null;
}

export interface GitLabCreateDiscussionPayload {
  body: string;
  position?: GitLabDiscussionPosition;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: {
    id: number;
    name: string;
    username: string;
  };
  created_at: string;
  system: boolean;
  /** 行內 discussion 的位置（一般留言沒有） */
  position?: {
    new_path?: string | null;
    old_path?: string | null;
    new_line?: number | null;
    old_line?: number | null;
  } | null;
}

export interface ParsedGitLabUrl {
  baseUrl: string;
  projectPath: string;
  mrIid: number;
}

export type PublishStatus = 'draft' | 'sending' | 'published' | 'error';

export interface ReviewPublishState {
  status: PublishStatus;
  errorMessage?: string;
  discussionId?: string | number;
  /** 實際發布方式：行內留言、一般留言、行內失敗改發一般留言 */
  mode?: 'inline' | 'general' | 'stale-fallback';
  /** 行內留言失敗、改發一般留言的原因（取代原始錯誤訊息顯示） */
  fallbackReason?: string;
  editedComment?: string;
  editedSuggestion?: string;
}
