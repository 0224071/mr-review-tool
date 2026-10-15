// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { actAsync, renderHook } from './test-utils';
import { buildNoteUrl, usePublish, UsePublishOptions, PublishItem } from './usePublish';
import { DEFAULT_SETTINGS } from '../types/settings';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { createPublishedRecord } from '../core/publish-dedup';
import { SHARED_TAG_END, SHARED_TAG_START, SUMMARY_TAG } from '../services/gitlab-api';
import type { GitLabGateway, PublishBatchFn } from '../app/app-services';
import type { GitLabDiffRefs, GitLabMergeRequestInfo, GitLabNote, ReviewPublishState } from '../types/gitlab';
import type { PublishedRecord } from '../core/history-store';

const MR_URL = 'https://gitlab.example.com/grp/proj/-/merge_requests/7';
const TARGET = { baseUrl: 'https://gitlab.example.com', token: 't', projectPath: 'grp/proj', mrIid: 7 };
const RESULT_REFS: GitLabDiffRefs = { base_sha: 'rb', start_sha: 'rs', head_sha: 'rh' };
const MR_REFS: GitLabDiffRefs = { base_sha: 'mb', start_sha: 'ms', head_sha: 'mh' };
const reviews = SAMPLE_ANALYSIS_RESULT.reviews;

const note = (id: number, body: string): GitLabNote => ({
  id,
  body,
  author: { id: 1, name: 'a', username: 'a' },
  created_at: '2026-01-01T00:00:00Z',
  system: false,
});

/** 像 useState 的 setter：記住最後的值，函式型更新也會套用 */
function fakeState<T>(initial: T) {
  const box = { value: initial };
  const set = vi.fn((next: SetStateAction<T>) => {
    box.value = typeof next === 'function' ? (next as (prev: T) => T)(box.value) : next;
  });
  return { box, set };
}

const item = (index: number, over: Partial<PublishItem> = {}): PublishItem => ({ review: reviews[index], index, ...over });

function setup({
  configured = true,
  notes = [] as GitLabNote[],
  publishedRecords = [] as PublishedRecord[],
  withResultRefs = true,
  currentGitLabMr = { web_url: MR_URL, diff_refs: MR_REFS } as GitLabMergeRequestInfo | null,
  hasResult = true,
} = {}) {
  const publishBatch = vi.fn<PublishBatchFn>(async (_t, items, _refs, hooks) =>
    items.map((i) => {
      hooks?.onStart?.(i.index);
      const outcome = { index: i.index, ok: true as const, result: { mode: 'inline' as const, discussionId: `d${i.index}` } };
      hooks?.onDone?.(outcome);
      return outcome;
    })
  );
  const gitlab: GitLabGateway = {
    isConfigured: vi.fn(() => configured),
    resolveTarget: vi.fn((url: string) => {
      if (!url) throw new Error('請提供 MR 網址');
      return TARGET;
    }),
    fetchMergeRequest: vi.fn(),
    fetchRawDiff: vi.fn(),
    fetchNotes: vi.fn(async () => notes),
    createNote: vi.fn(async () => ({})),
    updateNote: vi.fn(async () => ({})),
    shareAnalysis: vi.fn(async () => ({})),
    publishBatch,
  };
  const state = {
    remoteNotes: fakeState<GitLabNote[]>([]),
    publishedRecords: fakeState<PublishedRecord[]>(publishedRecords),
    selectedIndices: fakeState(new Set([0, 1])),
    publishStates: fakeState<Record<number, ReviewPublishState>>({}),
    summary: fakeState(false),
    shared: fakeState(false),
    error: fakeState<string | null>(null),
    info: fakeState<string | null>(null),
    settingsOpen: fakeState(false),
  };
  const options: UsePublishOptions = {
    gitlab,
    settings: { settings: DEFAULT_SETTINGS, setIsSettingsOpen: state.settingsOpen.set },
    analysis: {
      analysisResult: hasResult ? SAMPLE_ANALYSIS_RESULT : null,
      currentGitLabMr,
      gitlabMrUrl: '',
      resultDiffRefs: withResultRefs ? RESULT_REFS : undefined,
      remoteNotes: [],
      setRemoteNotes: state.remoteNotes.set,
      draftEdits: {},
      publishedRecords,
      setPublishedRecords: state.publishedRecords.set,
      setSelectedIndices: state.selectedIndices.set,
      setPublishStates: state.publishStates.set,
      setIsSummaryPublished: state.summary.set,
      setIsSharedToMrPublished: state.shared.set,
      setErrorMessage: state.error.set,
      setInfoMessage: state.info.set,
    },
  };
  const hook = renderHook((o: UsePublishOptions) => usePublish(o), options);
  return { ...hook, gitlab, state, publishBatch };
}

describe('usePublish', () => {
  it('diff_refs 依序取結果版本 → 目前 MR', () => {
    expect(setup().result.current.publishDiffRefs).toBe(RESULT_REFS);
    expect(setup({ withResultRefs: false }).result.current.publishDiffRefs).toBe(MR_REFS);
    expect(setup().result.current.mrUrl).toBe(MR_URL);
  });

  it('GitLab 未設定時發布改為開啟設定', async () => {
    const { result, state } = setup({ configured: false });
    await actAsync(() => result.current.handlePublishBatchReviews([item(0)]));
    expect(state.settingsOpen.set).toHaveBeenCalledWith(true);
    expect(result.current.isPublishModalOpen).toBe(false);
  });

  it('內文是空的意見略過並提示，其餘進入發布確認', async () => {
    const { result, state } = setup();
    await actAsync(() => result.current.handlePublishBatchReviews([item(0), item(1, { customComment: '  ' })]));
    expect(state.info.box.value).toBe('已略過 1 則內文是空的意見，不會發布。');
    expect(result.current.isPublishModalOpen).toBe(true);
    expect(result.current.publishModalConfig.itemsToPublish.map((i) => i.index)).toEqual([0]);
  });

  it('確認發布：以結果的 diff_refs 送出，記錄已發布並取消勾選', async () => {
    const { result, state, publishBatch } = setup();
    await actAsync(() => result.current.handlePublishBatchReviews([item(0), item(1, { customComment: '改寫' })]));
    await actAsync(() => result.current.handleConfirmPublish());

    expect(publishBatch).toHaveBeenCalledWith(
      TARGET,
      [
        expect.objectContaining({ index: 0, comment: reviews[0].comment.trim() }),
        expect.objectContaining({ index: 1, comment: '改寫' }),
      ],
      RESULT_REFS,
      expect.any(Object)
    );
    expect(state.publishStates.box.value[0]).toMatchObject({ status: 'published', discussionId: 'd0' });
    expect(state.publishedRecords.box.value).toHaveLength(2);
    expect(state.selectedIndices.box.value.size).toBe(0);
    expect(state.info.box.value).toBe('已發布 2 則審查意見。');
    expect(result.current.isPublishModalOpen).toBe(false);
    expect(result.current.isPublishingInProgress).toBe(false);
  });

  it('有已發布過的意見時先警告；「只發布未發布的」只送出新的', async () => {
    const published = [createPublishedRecord(reviews[0], reviews[0].comment, reviews[0].suggestion, 'old')];
    const { result } = setup({ publishedRecords: published });
    await actAsync(() => result.current.handlePublishBatchReviews([item(0), item(1)]));
    expect(result.current.isPublishModalOpen).toBe(false);
    expect(result.current.duplicateWarning?.duplicates.map((i) => i.index)).toEqual([0]);
    expect(result.current.duplicateWarning?.fresh.map((i) => i.index)).toEqual([1]);
    expect(result.current.publishedMatches[0]?.source).toBe('local');

    await actAsync(() => result.current.confirmDuplicateWarning());
    expect(result.current.duplicateWarning).toBeNull();
    expect(result.current.publishModalConfig.itemsToPublish.map((i) => i.index)).toEqual([1]);
  });

  it('「仍要全部發布」依原順序送出全部；取消則關閉警告', async () => {
    const published = [createPublishedRecord(reviews[0], reviews[0].comment, reviews[0].suggestion, 'old')];
    const { result } = setup({ publishedRecords: published });
    await actAsync(() => result.current.handlePublishBatchReviews([item(1), item(0)]));
    await actAsync(() => result.current.publishAllDespiteDuplicates());
    expect(result.current.publishModalConfig.itemsToPublish.map((i) => i.index)).toEqual([0, 1]);

    await actAsync(() => result.current.handlePublishBatchReviews([item(0)]));
    expect(result.current.duplicateWarning).not.toBeNull();
    await actAsync(() => result.current.cancelDuplicateWarning());
    expect(result.current.duplicateWarning).toBeNull();
  });

  it('整體摘要：沒有既有留言時新增，有摘要留言時更新', async () => {
    const first = setup();
    await actAsync(() => first.result.current.handlePublishSummaryToMr());
    expect(first.result.current.publishModalConfig.isPublishingSummary).toBe(true);
    await actAsync(() => first.result.current.handleConfirmPublish());
    expect(first.gitlab.createNote).toHaveBeenCalledWith(TARGET, expect.stringContaining(SUMMARY_TAG));
    expect(first.state.summary.box.value).toBe(true);
    expect(first.state.info.box.value).toBe('已發布整體摘要。');

    const second = setup({ notes: [note(5, `${SUMMARY_TAG}\n舊摘要`)] });
    await actAsync(() => second.result.current.handlePublishSummaryToMr());
    await actAsync(() => second.result.current.handleConfirmPublish());
    expect(second.gitlab.updateNote).toHaveBeenCalledWith(TARGET, 5, expect.stringContaining(SAMPLE_ANALYSIS_RESULT.title));
    expect(second.gitlab.createNote).not.toHaveBeenCalled();
  });

  it('已有分享報告時不再發整體摘要', async () => {
    const { result, gitlab, state } = setup({ notes: [note(6, `${SHARED_TAG_START}{}${SHARED_TAG_END}`)] });
    await actAsync(() => result.current.handlePublishSummaryToMr());
    await actAsync(() => result.current.handleConfirmPublish());
    expect(gitlab.createNote).not.toHaveBeenCalled();
    expect(state.info.box.value).toBe('分享報告已包含摘要，無需重複發布整體留言。');
    expect(state.summary.box.value).toBe(true);
    expect(result.current.isPublishModalOpen).toBe(false);
  });

  it('沒有目標 MR 時確認發布顯示錯誤並關閉確認視窗', async () => {
    const { result, state } = setup({ currentGitLabMr: null });
    await actAsync(() => result.current.handlePublishSummaryToMr());
    await actAsync(() => result.current.handleConfirmPublish());
    expect(state.error.box.value).toBe('請提供 MR 網址');
    expect(result.current.isPublishModalOpen).toBe(false);
  });

  it('分享分析報告：更新既有摘要留言', async () => {
    const { result, gitlab, state } = setup({ notes: [note(5, `${SUMMARY_TAG}\n舊摘要`)] });
    await actAsync(() => result.current.handleShareAnalysisToMr());
    await actAsync(() => result.current.handleConfirmShareAnalysis());
    expect(gitlab.shareAnalysis).toHaveBeenCalledWith(TARGET, SAMPLE_ANALYSIS_RESULT, 5, RESULT_REFS.head_sha);
    expect(state.shared.box.value).toBe(true);
    expect(state.summary.box.value).toBe(true);
    expect(state.info.box.value).toBe('已共享分析報告。');
    expect(result.current.isSharingToMr).toBe(false);
  });

  it('分享分析報告：先開確認視窗（新增留言），確認前只讀留言、不寫入', async () => {
    const { result, gitlab, state } = setup();
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(gitlab.fetchNotes).toHaveBeenCalledWith(TARGET);
    expect(result.current.shareConfirm).toEqual({ target: TARGET, targetNoteId: null, overwrite: null, overwriteAuthor: undefined });
    expect(gitlab.shareAnalysis).not.toHaveBeenCalled();
    expect(gitlab.createNote).not.toHaveBeenCalled();
    expect(gitlab.updateNote).not.toHaveBeenCalled();
    expect(state.shared.box.value).toBe(false);

    await actAsync(() => result.current.handleConfirmShareAnalysis());
    expect(gitlab.shareAnalysis).toHaveBeenCalledWith(TARGET, SAMPLE_ANALYSIS_RESULT, null, RESULT_REFS.head_sha);
    expect(result.current.shareConfirm).toBeNull();
    expect(state.shared.box.value).toBe(true);
  });

  it('分享分析報告：已有分享留言時確認視窗標示覆寫該則', async () => {
    const shared = note(8, `${SHARED_TAG_START}\n{}\n${SHARED_TAG_END}`);
    const { result, gitlab } = setup({ notes: [note(5, `${SUMMARY_TAG}\n舊摘要`), shared] });
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(result.current.shareConfirm).toMatchObject({ targetNoteId: 8, overwrite: 'shared', overwriteAuthor: 'a' });
    await actAsync(() => result.current.handleConfirmShareAnalysis());
    expect(gitlab.shareAnalysis).toHaveBeenCalledWith(TARGET, SAMPLE_ANALYSIS_RESULT, 8, RESULT_REFS.head_sha);
  });

  it('分享分析報告：取消確認視窗不送出寫入', async () => {
    const { result, gitlab, state } = setup({ notes: [note(5, `${SUMMARY_TAG}\n舊摘要`)] });
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(result.current.shareConfirm).toMatchObject({ overwrite: 'summary', targetNoteId: 5 });
    await actAsync(() => result.current.cancelShareAnalysis());
    expect(result.current.shareConfirm).toBeNull();
    expect(gitlab.shareAnalysis).not.toHaveBeenCalled();
    expect(gitlab.createNote).not.toHaveBeenCalled();
    expect(gitlab.updateNote).not.toHaveBeenCalled();
    expect(state.shared.box.value).toBe(false);
    expect(state.info.box.value).toBeNull();
  });

  it('分享分析報告：結果沒有 diff_refs 時不寫 headSha（開啟時不自動載入）', async () => {
    const { result, gitlab } = setup({ withResultRefs: false });
    await actAsync(() => result.current.handleShareAnalysisToMr());
    await actAsync(() => result.current.handleConfirmShareAnalysis());
    expect(gitlab.shareAnalysis).toHaveBeenCalledWith(TARGET, SAMPLE_ANALYSIS_RESULT, null, null);
  });

  it('分享分析報告：讀取留言失敗時顯示錯誤、不開確認視窗', async () => {
    const { result, gitlab, state } = setup();
    vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(new Error('讀取留言失敗 (500)'));
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(result.current.shareConfirm).toBeNull();
    expect(state.error.box.value).toBe('讀取留言失敗 (500)');
    expect(gitlab.shareAnalysis).not.toHaveBeenCalled();
  });

  it('分享分析報告：GET 讀留言期間為「讀取留言中」階段，按確認後寫入期間才是「寫入」階段', async () => {
    const { result, gitlab } = setup();
    let releaseNotes!: (notes: GitLabNote[]) => void;
    vi.mocked(gitlab.fetchNotes).mockImplementationOnce(() => new Promise((r) => (releaseNotes = r)));
    let reading!: Promise<void>;
    await actAsync(() => {
      reading = result.current.handleShareAnalysisToMr();
    });
    expect(result.current.shareStage).toBe('reading');
    expect(result.current.isSharingToMr).toBe(true);
    expect(gitlab.shareAnalysis).not.toHaveBeenCalled();

    await actAsync(async () => {
      releaseNotes([]);
      await reading;
    });
    expect(result.current.shareStage).toBeNull();
    expect(result.current.shareConfirm).not.toBeNull();

    let releaseWrite!: () => void;
    vi.mocked(gitlab.shareAnalysis).mockImplementationOnce(() => new Promise((r) => (releaseWrite = () => r({}))));
    let writing!: Promise<void>;
    await actAsync(() => {
      writing = result.current.handleConfirmShareAnalysis();
    });
    expect(result.current.shareStage).toBe('writing');
    await actAsync(async () => {
      releaseWrite();
      await writing;
    });
    expect(result.current.shareStage).toBeNull();
  });

  it('分享分析報告：覆寫時帶原留言作者 handle、發布時間與網址（MR 網址 + #note_<id>）', async () => {
    const shared: GitLabNote = {
      ...note(8, `${SHARED_TAG_START}\n{}\n${SHARED_TAG_END}`),
      author: { id: 2, name: 'FAKE Name', username: 'fake-handle' },
      created_at: '2026-10-01T08:00:00Z',
    };
    const { result } = setup({ notes: [shared] });
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(result.current.shareConfirm).toMatchObject({
      overwrite: 'shared',
      overwriteAuthor: 'fake-handle',
      overwriteCreatedAt: '2026-10-01T08:00:00Z',
      overwriteNoteUrl: `${MR_URL}#note_8`,
    });
  });

  it('buildNoteUrl：去掉 MR 網址既有的 # 後接 #note_<id>', () => {
    expect(buildNoteUrl(`${MR_URL}#note_1`, 42)).toBe(`${MR_URL}#note_42`);
  });

  it('分享分析報告：沒有 MR 網址時顯示錯誤', async () => {
    const { result, gitlab, state } = setup({ currentGitLabMr: null });
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(state.error.box.value).toBe('請先提供目標 GitLab MR 網址以發布共享報告');
    expect(gitlab.shareAnalysis).not.toHaveBeenCalled();
  });
});
