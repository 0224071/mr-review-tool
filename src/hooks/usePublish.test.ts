// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { actAsync, renderHook } from './test-utils';
import { buildNoteUrl, buildNotesReadErrorMessage, usePublish, UsePublishOptions, PublishItem } from './usePublish';
import { DEFAULT_SETTINGS } from '../types/settings';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { createPublishedRecord } from '../core/publish-dedup';
import { SHARED_TAG_END, SHARED_TAG_START, SUMMARY_TAG } from '../services/gitlab-api';
import type { GitLabGateway, PublishBatchFn } from '../app/app-services';
import type { GitLabDiffRefs, GitLabMergeRequestInfo, GitLabNote, ReviewPublishState } from '../types/gitlab';
import type { DraftEdits, PublishedRecord } from '../core/history-store';

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
  remoteNotes = [] as GitLabNote[],
  draftEdits = {} as DraftEdits,
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
      remoteNotes,
      setRemoteNotes: state.remoteNotes.set,
      draftEdits,
      selectedIndices: state.selectedIndices.box.value,
      publishStates: state.publishStates.box.value,
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
  return { ...hook, gitlab, state, publishBatch, options };
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
    expect(result.current.shareConfirm).toMatchObject({ targetNoteId: 8, overwrite: 'shared', overwriteAuthor: { name: 'a', username: 'a' } });
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
    const { result, gitlab } = setup();
    vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(new Error('讀取留言失敗 (500)'));
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(result.current.shareConfirm).toBeNull();
    expect(result.current.notesReadError).toContain('讀取留言失敗 (500)');
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

  it('分享分析報告：覆寫時帶原留言作者（顯示名稱與 username）、發布時間與網址（MR 網址 + #note_<id>）', async () => {
    const shared: GitLabNote = {
      ...note(8, `${SHARED_TAG_START}\n{}\n${SHARED_TAG_END}`),
      author: { id: 2, name: 'FAKE Name', username: 'fake-handle' },
      created_at: '2026-10-01T08:00:00Z',
    };
    const { result } = setup({ notes: [shared] });
    await actAsync(() => result.current.handleShareAnalysisToMr());
    expect(result.current.shareConfirm).toMatchObject({
      overwrite: 'shared',
      overwriteAuthor: { name: 'FAKE Name', username: 'fake-handle' },
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
  describe('發布前讀不到 MR 留言時中止（#78）', () => {
    const FAIL = new Error('讀取 MR 留言失敗 (第 1 頁，500)');
    /** MR 上已有第 0 則意見的一般留言（內文含檔名與意見） */
    const dupNote = () => note(9, `${reviews[0].file}\n${reviews[0].comment}`);

    const expectNothingWritten = (gitlab: GitLabGateway) => {
      expect(gitlab.publishBatch).not.toHaveBeenCalled();
      expect(gitlab.createNote).not.toHaveBeenCalled();
      expect(gitlab.updateNote).not.toHaveBeenCalled();
      expect(gitlab.shareAnalysis).not.toHaveBeenCalled();
    };

    it('buildNotesReadErrorMessage：說明沒有送出任何留言並提示重試', () => {
      const msg = buildNotesReadErrorMessage(FAIL);
      expect(msg).toContain('沒有送出任何留言');
      expect(msg).toContain('第 1 頁，500');
      expect(msg).toContain('重試');
      expect(buildNotesReadErrorMessage('x')).toContain('沒有送出任何留言');
    });

    it('單則／發布已選：讀取失敗時中止，不開確認、不改用先前讀到的留言比對', async () => {
      // 先前讀到的留言裡沒有重複：若 fallback 用它比對會直接開發布確認
      const { result, gitlab, state } = setup({ remoteNotes: [] });
      vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
      await actAsync(() => result.current.handlePublishBatchReviews([item(0), item(1)]));

      expect(result.current.notesReadError).toContain('沒有送出任何留言');
      expect(result.current.isPublishModalOpen).toBe(false);
      expect(result.current.duplicateWarning).toBeNull();
      expect(result.current.isPublishingInProgress).toBe(false);
      expect(state.remoteNotes.set).not.toHaveBeenCalled();
      // 即使硬按確認，也沒有要發布的項目
      expect(result.current.publishModalConfig.itemsToPublish).toEqual([]);
      expectNothingWritten(gitlab);
    });

    it('單則／發布已選：重試會重新讀留言並從頭比對，成功後進入確認並可正常發布', async () => {
      const { result, gitlab, publishBatch } = setup();
      vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
      await actAsync(() => result.current.handlePublishSingleReview(reviews[1], undefined, undefined, 1));
      expect(result.current.notesReadError).not.toBeNull();

      await actAsync(() => result.current.retryNotesRead());
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(2);
      expect(result.current.notesReadError).toBeNull();
      expect(result.current.isPublishModalOpen).toBe(true);
      expect(result.current.publishModalConfig.itemsToPublish.map((i) => i.index)).toEqual([1]);

      await actAsync(() => result.current.handleConfirmPublish());
      expect(publishBatch).toHaveBeenCalledTimes(1);
      expect(publishBatch.mock.calls[0][1].map((i) => i.index)).toEqual([1]);
    });

    it('單則／發布已選：重試時再比對到重複，仍跳重複警告', async () => {
      const { result, gitlab } = setup();
      vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(FAIL).mockResolvedValueOnce([dupNote()]);
      await actAsync(() => result.current.handlePublishBatchReviews([item(0), item(1)]));
      await actAsync(() => result.current.retryNotesRead());
      expect(result.current.isPublishModalOpen).toBe(false);
      expect(result.current.duplicateWarning?.duplicates.map((i) => i.index)).toEqual([0]);
      expectNothingWritten(gitlab);
    });

    it('單則／發布已選（回歸）：讀取成功時用最新留言略過重複，讀到空陣列也會更新留言', async () => {
      const dup = setup({ notes: [dupNote()] });
      await actAsync(() => dup.result.current.handlePublishBatchReviews([item(0), item(1)]));
      expect(dup.result.current.duplicateWarning?.duplicates.map((i) => i.index)).toEqual([0]);
      expect(dup.state.remoteNotes.box.value).toEqual([dupNote()]);
      await actAsync(() => dup.result.current.confirmDuplicateWarning());
      expect(dup.result.current.publishModalConfig.itemsToPublish.map((i) => i.index)).toEqual([1]);

      // 先前讀到的留言有重複，但 MR 上已刪除：以最新（空的）留言為準
      const empty = setup({ remoteNotes: [dupNote()], notes: [] });
      await actAsync(() => empty.result.current.handlePublishBatchReviews([item(0)]));
      expect(empty.state.remoteNotes.set).toHaveBeenCalledWith([]);
      expect(empty.result.current.duplicateWarning).toBeNull();
      expect(empty.result.current.isPublishModalOpen).toBe(true);
    });

    it('發布摘要：讀取失敗時中止，不新增也不更新留言', async () => {
      const { result, gitlab, state } = setup();
      vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
      await actAsync(() => result.current.handlePublishSummaryToMr());
      await actAsync(() => result.current.handleConfirmPublish());
      expect(result.current.notesReadError).toContain('沒有送出任何留言');
      expect(result.current.isPublishModalOpen).toBe(false);
      expect(result.current.isPublishingInProgress).toBe(false);
      expect(state.summary.box.value).toBe(false);
      expect(state.error.box.value).toBeNull();
      expectNothingWritten(gitlab);
    });

    it('發布摘要：重試會重新開確認，確認後重新讀留言並更新既有摘要', async () => {
      const { result, gitlab } = setup();
      vi.mocked(gitlab.fetchNotes)
        .mockRejectedValueOnce(FAIL)
        .mockResolvedValueOnce([note(5, `${SUMMARY_TAG}\n舊摘要`)]);
      await actAsync(() => result.current.handlePublishSummaryToMr());
      await actAsync(() => result.current.handleConfirmPublish());

      await actAsync(() => result.current.retryNotesRead());
      expect(result.current.isPublishModalOpen).toBe(true);
      expect(result.current.publishModalConfig.isPublishingSummary).toBe(true);
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(1);

      await actAsync(() => result.current.handleConfirmPublish());
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(2);
      expect(gitlab.updateNote).toHaveBeenCalledWith(TARGET, 5, expect.stringContaining(SUMMARY_TAG));
      expect(gitlab.createNote).not.toHaveBeenCalled();
      expect(result.current.notesReadError).toBeNull();
    });

    it('共享報告：讀取失敗時中止，重試後重新讀留言並開確認視窗、確認後寫入', async () => {
      const { result, gitlab, state } = setup();
      vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(FAIL).mockResolvedValueOnce([note(5, `${SUMMARY_TAG}\n舊摘要`)]);
      await actAsync(() => result.current.handleShareAnalysisToMr());
      expect(result.current.notesReadError).toContain('沒有送出任何留言');
      expect(result.current.shareConfirm).toBeNull();
      expect(result.current.isPublishBusy).toBe(false);
      expect(state.error.box.value).toBeNull();
      expectNothingWritten(gitlab);

      await actAsync(() => result.current.retryNotesRead());
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(2);
      expect(result.current.shareConfirm).toMatchObject({ overwrite: 'summary', targetNoteId: 5 });
      await actAsync(() => result.current.handleConfirmShareAnalysis());
      expect(gitlab.shareAnalysis).toHaveBeenCalledWith(TARGET, SAMPLE_ANALYSIS_RESULT, 5, RESULT_REFS.head_sha);
    });

    describe('重試依目前的勾選與草稿重新組出要發布的意見（不重送失敗當下的內容）', () => {
      /** 改變目前的勾選／草稿／發布狀態（模擬使用者在失敗後操作畫面） */
      const changeState = (
        hook: ReturnType<typeof setup>,
        over: Partial<Pick<UsePublishOptions['analysis'], 'selectedIndices' | 'draftEdits' | 'publishStates'>>
      ) => hook.rerender({ ...hook.options, analysis: { ...hook.options.analysis, ...over } });
      const sent = (hook: ReturnType<typeof setup>) =>
        hook.publishBatch.mock.calls[0][1].map((i) => ({ index: i.index, comment: i.comment }));

      it('發布已選：失敗後改勾選，重試送出目前勾選的意見', async () => {
        const hook = setup();
        vi.mocked(hook.gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
        await actAsync(() => hook.result.current.handlePublishBatchReviews([item(0), item(1)], 'selected'));
        changeState(hook, { selectedIndices: new Set([2, 1]) });

        await actAsync(() => hook.result.current.retryNotesRead());
        expect(hook.result.current.publishModalConfig.itemsToPublish.map((i) => i.index)).toEqual([1, 2]);
        await actAsync(() => hook.result.current.handleConfirmPublish());
        expect(sent(hook).map((i) => i.index)).toEqual([1, 2]);
      });

      it('發布已選：失敗後改草稿，重試送出新內文', async () => {
        const hook = setup();
        vi.mocked(hook.gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
        await actAsync(() => hook.result.current.handlePublishBatchReviews([item(0), item(1)], 'selected'));
        changeState(hook, { draftEdits: { 0: { comment: 'FAKE 新內文', suggestion: '' } } });

        await actAsync(() => hook.result.current.retryNotesRead());
        await actAsync(() => hook.result.current.handleConfirmPublish());
        expect(sent(hook)).toEqual([
          { index: 0, comment: 'FAKE 新內文' },
          { index: 1, comment: reviews[1].comment },
        ]);
      });

      it('發布已選：失敗後取消全部勾選，重試不讀留言、不發布並提示', async () => {
        const hook = setup();
        vi.mocked(hook.gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
        await actAsync(() => hook.result.current.handlePublishBatchReviews([item(0), item(1)], 'selected'));
        changeState(hook, { selectedIndices: new Set() });

        await actAsync(() => hook.result.current.retryNotesRead());
        expect(hook.gitlab.fetchNotes).toHaveBeenCalledTimes(1);
        expect(hook.result.current.isPublishModalOpen).toBe(false);
        expect(hook.state.info.box.value).toBe('目前沒有勾選要發布的意見。');
      });

      it('單則：失敗後改草稿，重試送出該則的新內文（不受勾選影響）', async () => {
        const hook = setup();
        vi.mocked(hook.gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
        await actAsync(() => hook.result.current.handlePublishSingleReview(reviews[3], undefined, undefined, 3));
        changeState(hook, { draftEdits: { 3: { comment: 'FAKE 單則新內文', suggestion: '' } } });

        await actAsync(() => hook.result.current.retryNotesRead());
        await actAsync(() => hook.result.current.handleConfirmPublish());
        expect(sent(hook)).toEqual([{ index: 3, comment: 'FAKE 單則新內文' }]);
      });

      it('重試失敗 N 則：重試時依目前的失敗項目與草稿重新組出', async () => {
        const hook = setup();
        const error: ReviewPublishState = { status: 'error', errorMessage: 'FAKE' };
        changeState(hook, { publishStates: { 2: error, 4: error } });
        vi.mocked(hook.gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
        await actAsync(() => hook.result.current.handlePublishBatchReviews([item(2), item(4)], 'failed'));
        // 失敗後第 4 則已改用單則發布成功，第 2 則改了草稿
        changeState(hook, {
          publishStates: { 2: error, 4: { status: 'published', discussionId: 'd4', mode: 'inline' } },
          draftEdits: { 2: { comment: 'FAKE 重試新內文', suggestion: '' } },
        });

        await actAsync(() => hook.result.current.retryNotesRead());
        await actAsync(() => hook.result.current.handleConfirmPublish());
        expect(sent(hook)).toEqual([{ index: 2, comment: 'FAKE 重試新內文' }]);
      });
    });

    it('切換 MR：從 A 切到 B 後 B 的留言讀取失敗，發布中止，不用 A 的留言通過重複檢查', async () => {
      // A 的留言沒有任何重複：若誤用 A 的留言（remoteNotes）比對，B 的發布會直接開確認
      const a = note(1, 'FAKE A 的其他留言');
      const hook = setup({ remoteNotes: [a] });
      const mrB = { web_url: `${MR_URL.replace(/7$/, '8')}`, diff_refs: MR_REFS } as GitLabMergeRequestInfo;
      hook.rerender({ ...hook.options, analysis: { ...hook.options.analysis, currentGitLabMr: mrB, remoteNotes: [a] } });
      vi.mocked(hook.gitlab.fetchNotes).mockRejectedValueOnce(FAIL);

      await actAsync(() => hook.result.current.handlePublishBatchReviews([item(0), item(1)], 'selected'));
      expect(hook.gitlab.resolveTarget).toHaveBeenLastCalledWith(mrB.web_url, DEFAULT_SETTINGS);
      expect(hook.result.current.notesReadError).toContain('沒有送出任何留言');
      expect(hook.result.current.isPublishModalOpen).toBe(false);
      expect(hook.result.current.duplicateWarning).toBeNull();
      expect(hook.state.remoteNotes.set).not.toHaveBeenCalled();
      expectNothingWritten(hook.gitlab);
    });

    it('換了 MR 後不再顯示前一個 MR 的讀取失敗，重試也不動作', async () => {
      const hook = setup();
      vi.mocked(hook.gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
      await actAsync(() => hook.result.current.handleShareAnalysisToMr());
      expect(hook.result.current.notesReadError).not.toBeNull();

      const otherMr = { web_url: `${MR_URL}9`, diff_refs: MR_REFS } as GitLabMergeRequestInfo;
      hook.rerender({ ...hook.options, analysis: { ...hook.options.analysis, currentGitLabMr: otherMr } });
      expect(hook.result.current.notesReadError).toBeNull();
      await actAsync(() => hook.result.current.retryNotesRead());
      expect(hook.gitlab.fetchNotes).toHaveBeenCalledTimes(1);
    });

    it('關閉錯誤後不再顯示', async () => {
      const { result, gitlab } = setup();
      vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(FAIL);
      await actAsync(() => result.current.handlePublishBatchReviews([item(0)]));
      await actAsync(() => result.current.dismissNotesReadError());
      expect(result.current.notesReadError).toBeNull();
    });
  });

  describe('防連點：從讀留言開始就算發布中（#78）', () => {
    it('單則／發布已選：讀留言期間 isPublishingInProgress 為 true，連點只讀一次', async () => {
      const { result, gitlab } = setup();
      let release!: (notes: GitLabNote[]) => void;
      vi.mocked(gitlab.fetchNotes).mockImplementationOnce(() => new Promise((r) => (release = r)));
      await actAsync(() => {
        // 同一輪連點三次（state 尚未重新 render）
        result.current.handlePublishBatchReviews([item(0)]);
        result.current.handlePublishBatchReviews([item(0)]);
        result.current.handlePublishSingleReview(reviews[0], undefined, undefined, 0);
      });
      expect(result.current.isPublishingInProgress).toBe(true);
      expect(result.current.isPublishBusy).toBe(true);
      expect(result.current.notesReading).toBe('reviews');
      // 重新 render 後再點，也被擋下
      await actAsync(() => result.current.handlePublishBatchReviews([item(1)]));
      await actAsync(() => result.current.handleShareAnalysisToMr());
      await actAsync(() => result.current.handlePublishSummaryToMr());
      expect(result.current.isPublishModalOpen).toBe(false);
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(1);

      await actAsync(() => release([]));
      expect(result.current.isPublishingInProgress).toBe(false);
      expect(result.current.isPublishModalOpen).toBe(true);
      expect(result.current.notesReading).toBeNull();
      expect(result.current.publishModalConfig.itemsToPublish.map((i) => i.index)).toEqual([0]);
    });

    it('共享報告讀留言期間，單則／發布已選與摘要都不會開始', async () => {
      const { result, gitlab } = setup();
      let release!: (notes: GitLabNote[]) => void;
      vi.mocked(gitlab.fetchNotes).mockImplementationOnce(() => new Promise((r) => (release = r)));
      let reading!: Promise<void>;
      await actAsync(() => {
        reading = result.current.handleShareAnalysisToMr();
        void result.current.handleShareAnalysisToMr();
      });
      expect(result.current.isPublishBusy).toBe(true);
      await actAsync(() => result.current.handlePublishBatchReviews([item(0)]));
      await actAsync(() => result.current.handlePublishSummaryToMr());
      expect(result.current.isPublishModalOpen).toBe(false);
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(1);
      await actAsync(async () => {
        release([]);
        await reading;
      });
      expect(result.current.isPublishBusy).toBe(false);
      expect(result.current.shareConfirm).not.toBeNull();
    });

    it('發布摘要：確認後讀留言期間為發布中，連按確認只讀一次、只寫一次', async () => {
      const { result, gitlab } = setup();
      await actAsync(() => result.current.handlePublishSummaryToMr());
      let release!: (notes: GitLabNote[]) => void;
      vi.mocked(gitlab.fetchNotes).mockImplementationOnce(() => new Promise((r) => (release = r)));
      let confirming!: Promise<void>;
      await actAsync(() => {
        confirming = result.current.handleConfirmPublish();
        void result.current.handleConfirmPublish();
      });
      expect(result.current.isPublishingInProgress).toBe(true);
      expect(result.current.notesReading).toBe('summary');
      await actAsync(() => result.current.handleConfirmPublish());
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(1);
      await actAsync(async () => {
        release([]);
        await confirming;
      });
      expect(gitlab.createNote).toHaveBeenCalledTimes(1);
      expect(result.current.isPublishingInProgress).toBe(false);
      expect(result.current.notesReading).toBeNull();
    });

    it('讀取失敗後的「重試」在讀留言期間連點只讀一次', async () => {
      const { result, gitlab } = setup();
      vi.mocked(gitlab.fetchNotes).mockRejectedValueOnce(new Error('x'));
      await actAsync(() => result.current.handlePublishBatchReviews([item(0)]));
      let release!: (notes: GitLabNote[]) => void;
      vi.mocked(gitlab.fetchNotes).mockImplementationOnce(() => new Promise((r) => (release = r)));
      await actAsync(() => {
        result.current.retryNotesRead();
        result.current.retryNotesRead();
      });
      expect(gitlab.fetchNotes).toHaveBeenCalledTimes(2);
      await actAsync(() => release([]));
      expect(result.current.isPublishModalOpen).toBe(true);
    });
  });
});
