/**
 * 單則審查意見發布至 GitLab：行內留言（帶 position）或一般留言（不帶 position），一律走 /discussions
 */
import { GitLabDiffRefs, GitLabDiscussionPosition } from '../types/gitlab';
import { MRReviewItem } from '../types/review';
import {
  createGitLabDiscussion,
  createGitLabGeneralDiscussion,
  fetchGitLabMergeRequest,
  GitLabApiError,
} from './gitlab-api';

export interface PublishTarget {
  baseUrl: string;
  token: string;
  projectPath: string;
  mrIid: number;
}

export type PublishMode = 'inline' | 'general' | 'stale-fallback';

export interface PublishReviewResult {
  discussionId: string | number;
  mode: PublishMode;
  /** 行內留言失敗改發一般留言時的原因，顯示在卡片上 */
  fallbackReason?: string;
}

/** 行內留言失敗時，這些 status 可能是 position 對不到目前版本造成的 */
const POSITION_FAILURE_STATUSES = new Set([400, 500]);

const reviewBody = (review: MRReviewItem, comment: string, suggestion: string) =>
  `**[${review.severity.toUpperCase()}] ${review.category.toUpperCase()}**: ${comment}\n\n> 💡 **修改建議**：\n> ${suggestion}\n\n*— 來自 GitLab MR 審查工具*`;

const anchorLine = (review: MRReviewItem): number | null => review.newLine ?? review.oldLine ?? review.line ?? null;

/** 一般留言開頭的「檔案:行號（註記）」；沒有可信行號時只寫檔案 */
export function buildGeneralNoteBody(
  review: MRReviewItem,
  comment: string,
  suggestion: string,
  note: '行號未驗證' | '版本已更新'
): string {
  const line = anchorLine(review);
  const location = line !== null ? `${review.file}:${line}` : review.file;
  return `${location}（${note}）\n\n${reviewBody(review, comment, suggestion)}`;
}

/**
 * 依對齊結果建立 position：新增行只帶 new_line；刪除行只帶 old_line；未變更行同時帶兩者。
 * 沒有任何行號時回傳 undefined。
 */
export function buildDiscussionPosition(
  review: MRReviewItem,
  diffRefs: GitLabDiffRefs
): GitLabDiscussionPosition | undefined {
  const pos: GitLabDiscussionPosition = {
    base_sha: diffRefs.base_sha,
    start_sha: diffRefs.start_sha,
    head_sha: diffRefs.head_sha,
    position_type: 'text',
    new_path: review.file,
    old_path: review.file,
  };
  if (review.newLine != null) pos.new_line = review.newLine;
  if (review.oldLine != null) pos.old_line = review.oldLine;
  if (pos.new_line == null && pos.old_line == null) {
    // 退回使用 review.line
    if (review.line == null) return undefined;
    pos.new_line = review.line;
  }
  return pos;
}

/** 讀取 MR 目前的 head_sha；讀取失敗回傳 undefined（無法判斷版本是否更新） */
async function fetchCurrentHeadSha(target: PublishTarget): Promise<string | undefined> {
  try {
    const mr = await fetchGitLabMergeRequest(target.baseUrl, target.token, target.projectPath, target.mrIid);
    return mr.diff_refs?.head_sha;
  } catch {
    return undefined;
  }
}

/**
 * 發布單則審查意見。
 * - lineVerified === false：不帶 position，以一般留言發出，開頭標「行號未驗證」。
 * - 其餘以行內留言發出；若失敗（400/500）且分析時的 head_sha 與 MR 目前 head_sha 不同，
 *   改發一般留言，開頭標「版本已更新」，並回傳改發原因。其他失敗照常拋錯。
 */
export async function publishReviewItem(
  target: PublishTarget,
  review: MRReviewItem,
  comment: string,
  suggestion: string,
  diffRefs: GitLabDiffRefs | undefined
): Promise<PublishReviewResult> {
  const { baseUrl, token, projectPath, mrIid } = target;

  if (review.lineVerified === false) {
    const res = await createGitLabGeneralDiscussion(
      baseUrl,
      token,
      projectPath,
      mrIid,
      buildGeneralNoteBody(review, comment, suggestion, '行號未驗證')
    );
    return { discussionId: res.id, mode: 'general' };
  }

  const position = diffRefs ? buildDiscussionPosition(review, diffRefs) : undefined;
  try {
    const res = await createGitLabDiscussion(baseUrl, token, projectPath, mrIid, {
      body: reviewBody(review, comment, suggestion),
      ...(position ? { position } : {}),
    });
    return { discussionId: res.id, mode: position ? 'inline' : 'general' };
  } catch (err) {
    if (!position || !(err instanceof GitLabApiError) || !POSITION_FAILURE_STATUSES.has(err.status)) throw err;

    const currentHeadSha = await fetchCurrentHeadSha(target);
    if (!currentHeadSha || currentHeadSha === position.head_sha) throw err;

    const res = await createGitLabGeneralDiscussion(
      baseUrl,
      token,
      projectPath,
      mrIid,
      buildGeneralNoteBody(review, comment, suggestion, '版本已更新')
    );
    return {
      discussionId: res.id,
      mode: 'stale-fallback',
      fallbackReason: `MR 已有新的 commit（分析版本 ${position.head_sha.slice(0, 8)} → 目前 ${currentHeadSha.slice(0, 8)}），行內留言無法對齊，已改發一般留言`,
    };
  }
}
