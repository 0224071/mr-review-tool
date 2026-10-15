/**
 * 重複發布判斷：比對本地已發布紀錄＋GitLab MR 現有 discussions/notes
 */
import { MRReviewItem } from '../types/review';
import { GitLabNote } from '../types/gitlab';
import { DraftEdits, PublishedRecord, reviewContentHash } from './history-store';

export interface PublishedMatch {
  source: 'local' | 'remote';
  /** epoch ms */
  publishedAt: number;
}

/** 太短的意見容易誤判，不拿來比對 MR 留言 */
const MIN_REMOTE_MATCH_LENGTH = 8;

const normalizeText = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

export function createPublishedRecord(
  review: MRReviewItem,
  publishedComment: string,
  publishedSuggestion: string,
  discussionId: string | number | undefined,
  now: number = Date.now()
): PublishedRecord {
  return {
    contentHash: reviewContentHash(publishedComment, publishedSuggestion),
    originalHash: reviewContentHash(review.comment, review.suggestion),
    file: review.file,
    line: review.line,
    publishedAt: now,
    discussionId,
  };
}

export function findLocalPublished(
  review: MRReviewItem,
  draft: { comment: string; suggestion: string } | undefined,
  records: PublishedRecord[]
): PublishedRecord | undefined {
  const originalHash = reviewContentHash(review.comment, review.suggestion);
  const currentHash = draft ? reviewContentHash(draft.comment, draft.suggestion) : originalHash;
  // 同一則可能被發布多次，取最近一次
  let latest: PublishedRecord | undefined;
  for (const r of records) {
    if (r.file !== review.file) continue;
    if (r.originalHash === originalHash || r.contentHash === currentHash || r.contentHash === originalHash) {
      if (!latest || r.publishedAt > latest.publishedAt) latest = r;
    }
  }
  return latest;
}

export function findRemotePublished(
  review: MRReviewItem,
  draft: { comment: string; suggestion: string } | undefined,
  notes: GitLabNote[]
): GitLabNote | undefined {
  const candidates = [review.comment, draft?.comment]
    .map((c) => normalizeText(c || ''))
    .filter((c) => c.length >= MIN_REMOTE_MATCH_LENGTH);
  if (candidates.length === 0) return undefined;

  return notes.find((note) => {
    if (note.system || !note.body) return false;
    const body = normalizeText(note.body);
    if (!candidates.some((c) => body.includes(c))) return false;
    const pos = note.position;
    if (pos && (pos.new_path || pos.old_path)) {
      return pos.new_path === review.file || pos.old_path === review.file;
    }
    // 一般留言（例如行號未驗證時發出的）以內文中的檔名判斷
    return body.includes(review.file);
  });
}

/**
 * 回傳每則意見（以原始 index 為 key）的已發布資訊；本地紀錄優先於 MR 留言。
 */
export function findPublishedMatches(
  reviews: MRReviewItem[],
  drafts: DraftEdits,
  localRecords: PublishedRecord[],
  remoteNotes: GitLabNote[]
): Record<number, PublishedMatch> {
  const matches: Record<number, PublishedMatch> = {};
  reviews.forEach((review, idx) => {
    const local = findLocalPublished(review, drafts[idx], localRecords);
    if (local) {
      matches[idx] = { source: 'local', publishedAt: local.publishedAt };
      return;
    }
    const remote = findRemotePublished(review, drafts[idx], remoteNotes);
    if (remote) {
      const t = Date.parse(remote.created_at);
      matches[idx] = { source: 'remote', publishedAt: Number.isNaN(t) ? 0 : t };
    }
  });
  return matches;
}

/** 預設勾選：一律不勾選，由使用者自行挑選要發布的意見（#18） */
export function defaultSelectedIndices(
  _reviews: MRReviewItem[],
  _published: Record<number, PublishedMatch>
): Set<number> {
  return new Set<number>();
}

/**
 * 發布前分流：已發布過（本地紀錄或 MR 留言）的歸到 duplicates；同一則重複出現只保留第一次。
 */
export function partitionDuplicates<T extends { index: number }>(
  items: T[],
  published: Record<number, PublishedMatch>
): { fresh: T[]; duplicates: T[] } {
  const seen = new Set<number>();
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const item of items) {
    if (seen.has(item.index)) continue;
    seen.add(item.index);
    (published[item.index] ? duplicates : fresh).push(item);
  }
  return { fresh, duplicates };
}
