/**
 * 示範用發布器：函式簽章與 services/review-publisher.ts 相同，但不連 GitLab。
 * 每則結果都帶「示範，未實際發布」標註，discussionId 為 demo-*，不產生任何 MR 連結。
 */
import type { PublishOutcome, PublishedResult, GitLabGateway } from '../app/app-services';
import { PublishBatchItem, plannedPublishMode, PublishTarget } from '../services/review-publisher';
import { SAMPLE_DIFF_REFS } from '../services/diff-sources/sample-diffs';
import { GitLabDiffRefs } from '../types/gitlab';
import { MRReviewItem } from '../types/review';
import { DEMO_NOTICE } from './demo-mode';

export const DEMO_PUBLISH_DELAY_MS = 300;

/** 示範用的發布目標（不是真的 GitLab 位址，不會被連線） */
export const DEMO_PUBLISH_TARGET: PublishTarget = {
  baseUrl: '',
  token: '',
  projectPath: 'demo/sample-cart',
  mrIid: 0,
};

const DEMO_GITLAB_ERROR = '示範模式不會連到 GitLab；要抓取真的 MR，請先「離開示範」並填寫金鑰。';

const wait = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export function createFakePublisher(options: { delayMs?: number } = {}) {
  const { delayMs = DEMO_PUBLISH_DELAY_MS } = options;
  let seq = 0;

  async function publishReviewItem(
    _target: PublishTarget,
    review: MRReviewItem,
    _comment: string,
    _suggestion: string | undefined,
    diffRefs: GitLabDiffRefs | undefined
  ): Promise<PublishedResult> {
    await wait(delayMs);
    seq += 1;
    return { discussionId: `demo-${seq}`, mode: plannedPublishMode(review, diffRefs), notice: DEMO_NOTICE };
  }

  async function publishReviewBatch(
    target: PublishTarget,
    items: PublishBatchItem[],
    diffRefs: GitLabDiffRefs | undefined,
    hooks: { onStart?: (index: number) => void; onDone?: (outcome: PublishOutcome) => void } = {}
  ): Promise<PublishOutcome[]> {
    const outcomes: PublishOutcome[] = [];
    for (const item of items) {
      hooks.onStart?.(item.index);
      const result = await publishReviewItem(target, item.review, item.comment, item.suggestion, diffRefs);
      const outcome: PublishOutcome = { index: item.index, ok: true, result };
      outcomes.push(outcome);
      hooks.onDone?.(outcome);
    }
    return outcomes;
  }

  return { publishReviewItem, publishReviewBatch };
}

/** 示範用 GitLab：讀取類操作一律拒絕（不發請求），發布類操作只模擬成功 */
export function createDemoGitLabGateway(options: { delayMs?: number } = {}): GitLabGateway {
  const publisher = createFakePublisher(options);
  const reject = async (): Promise<never> => {
    throw new Error(DEMO_GITLAB_ERROR);
  };
  let noteSeq = 0;
  return {
    notice: DEMO_NOTICE,
    targetLabel: '示範 MR',
    // 範例 diff 的假版本資訊，讓行號已驗證的意見和正式版一樣以行內留言發布
    fallbackDiffRefs: SAMPLE_DIFF_REFS,
    isConfigured: () => true,
    resolveTarget: () => DEMO_PUBLISH_TARGET,
    fetchMergeRequest: reject,
    fetchRawDiff: reject,
    fetchNotes: async () => [],
    createNote: async () => ({ id: ++noteSeq }),
    updateNote: async (_t, noteId) => ({ id: noteId }),
    shareAnalysis: async () => ({ id: ++noteSeq, updated: false }),
    publishBatch: publisher.publishReviewBatch,
  };
}
