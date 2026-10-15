import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDemoFromUrl, DEMO_NOTICE, demoUrl, isDemoSearch, markDemoInUrl } from './demo-mode';
import { createDemoGitLabGateway, createFakePublisher, DEMO_PUBLISH_TARGET } from './fake-publisher';
import { createDemoProvider, DEMO_ANALYSIS_DELAY_MS } from './fake-provider';
import { createNoopHistoryStore } from './noop-history-store';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { SAMPLE_DIFF_REFS } from '../services/diff-sources/sample-diffs';
import { publishReviewBatch as realPublishReviewBatch } from '../services/review-publisher';
import type { PublishBatchFn } from '../app/app-services';
import { liveGitLabGateway } from '../app/live-services';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('?demo=1 偵測', () => {
  it('只有 demo=1 才進入示範', () => {
    expect(isDemoSearch('?demo=1')).toBe(true);
    expect(isDemoSearch('?foo=bar&demo=1')).toBe(true);
    expect(isDemoSearch('')).toBe(false);
    expect(isDemoSearch('?demo=0')).toBe(false);
    expect(isDemoSearch('?demo')).toBe(false);
    expect(isDemoSearch('?demos=1')).toBe(false);
  });

  it('demoUrl 加上／移除參數時保留其他參數與 hash', () => {
    expect(demoUrl('https://x.test/mr-review-tool/?debug=1#top', true)).toBe('/mr-review-tool/?debug=1&demo=1#top');
    expect(demoUrl('https://x.test/mr-review-tool/?demo=1&debug=1#top', false)).toBe('/mr-review-tool/?debug=1#top');
    expect(demoUrl('https://x.test/?demo=1', false)).toBe('/');
  });

  it('離開示範以 replaceState 移除 demo 參數；進入時補上', () => {
    const history = { state: { k: 1 }, replaceState: vi.fn() };
    clearDemoFromUrl(history, 'https://x.test/app/?demo=1');
    expect(history.replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/app/');
    markDemoInUrl(history, 'https://x.test/app/');
    expect(history.replaceState).toHaveBeenLastCalledWith({ k: 1 }, '', '/app/?demo=1');
  });
});

describe('假 AI provider', () => {
  it('約 1 秒後回傳既有範例分析結果，不呼叫 fetch', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = createDemoProvider();
    let done = false;
    const pending = provider
      .review({ kind: 'analysis', systemInstruction: '', prompt: '' })
      .then((r) => {
        done = true;
        return r;
      });
    await vi.advanceTimersByTimeAsync(DEMO_ANALYSIS_DELAY_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toEqual(SAMPLE_ANALYSIS_RESULT);
    expect(result).not.toBe(SAMPLE_ANALYSIS_RESULT);
    expect(DEMO_ANALYSIS_DELAY_MS).toBe(1000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('假發布器', () => {
  const review = SAMPLE_ANALYSIS_RESULT.reviews[0];
  const diffRefs = { base_sha: 'a'.repeat(40), start_sha: 'b'.repeat(40), head_sha: 'c'.repeat(40) };

  it('介面與真的發布器一致（同一個型別）', () => {
    const fake: PublishBatchFn = createFakePublisher().publishReviewBatch;
    const real: PublishBatchFn = realPublishReviewBatch;
    expect(typeof fake).toBe(typeof real);
    expect(fake.length).toBe(real.length);
  });

  it('結果帶「示範，未實際發布」且沒有任何 MR 網址，不呼叫 fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { publishReviewBatch } = createFakePublisher({ delayMs: 0 });
    const started: number[] = [];
    const outcomes = await publishReviewBatch(
      DEMO_PUBLISH_TARGET,
      [
        { index: 0, review, comment: review.comment, suggestion: review.suggestion },
        { index: 2, review: { ...review, lineVerified: false }, comment: 'c', suggestion: '' },
      ],
      diffRefs,
      { onStart: (i) => started.push(i) }
    );
    expect(started).toEqual([0, 2]);
    expect(outcomes).toHaveLength(2);
    for (const o of outcomes) {
      expect(o.ok).toBe(true);
      if (o.ok) {
        expect(o.result.notice).toBe(DEMO_NOTICE);
        expect(String(o.result.discussionId)).toMatch(/^demo-/);
      }
    }
    expect(outcomes[1].ok && outcomes[1].result.mode).toBe('general');
    expect(JSON.stringify(outcomes)).not.toMatch(/https?:|merge_requests/);
    expect(JSON.stringify(DEMO_PUBLISH_TARGET)).not.toMatch(/https?:/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('示範 GitLab：讀取 MR 直接拒絕、摘要與共享只模擬，全程不呼叫 fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const gitlab = createDemoGitLabGateway({ delayMs: 0 });
    const target = gitlab.resolveTarget('https://gitlab.com/g/p/-/merge_requests/1', { gitlabToken: '' } as never);
    expect(target).toBe(DEMO_PUBLISH_TARGET);
    await expect(gitlab.fetchMergeRequest(target)).rejects.toThrow('示範模式不會連到 GitLab');
    await expect(gitlab.fetchRawDiff(target)).rejects.toThrow('示範模式');
    expect(await gitlab.fetchNotes(target)).toEqual([]);
    await gitlab.createNote(target, 'x');
    await gitlab.updateNote(target, 1, 'x');
    await gitlab.shareAnalysis(target, SAMPLE_ANALYSIS_RESULT, null);
    expect(gitlab.notice).toBe(DEMO_NOTICE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('示範 GitLab 提供範例的假 diff_refs（40 字元 hex）；正式版沒有', () => {
    const gitlab = createDemoGitLabGateway({ delayMs: 0 });
    expect(gitlab.fallbackDiffRefs).toEqual(SAMPLE_DIFF_REFS);
    for (const sha of Object.values(SAMPLE_DIFF_REFS)) expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(liveGitLabGateway.fallbackDiffRefs).toBeUndefined();
  });

  it('帶範例 diff_refs 時：行號已驗證走行內、未驗證走一般留言', async () => {
    const { publishReviewBatch } = createFakePublisher({ delayMs: 0 });
    const outcomes = await publishReviewBatch(
      DEMO_PUBLISH_TARGET,
      [
        { index: 0, review: { ...review, newLine: 19, lineVerified: true }, comment: 'a', suggestion: '' },
        { index: 1, review: { ...review, newLine: null, line: null, lineVerified: false }, comment: 'b', suggestion: '' },
      ],
      SAMPLE_DIFF_REFS
    );
    expect(outcomes.map((o) => o.ok && o.result.mode)).toEqual(['inline', 'general']);
  });

  it('正式版沒有 MR 網址時無法組出發布目標', () => {
    expect(() => liveGitLabGateway.resolveTarget('', { gitlabToken: 't', gitlabBaseUrl: '' } as never)).toThrow(
      '請先輸入或指定目標 GitLab MR 網址'
    );
    expect(liveGitLabGateway.notice).toBeUndefined();
  });
});

describe('no-op 歷史紀錄', () => {
  it('寫入後讀不到任何東西', async () => {
    const store = createNoopHistoryStore();
    await store.put({ id: 'x' } as never);
    await store.update('x', { pinned: true });
    expect(await store.get('x')).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });
});
