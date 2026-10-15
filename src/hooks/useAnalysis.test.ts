// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actAsync, createMemoryStore, makeRecord, renderHook } from './test-utils';
import { useAnalysis, UseAnalysisOptions } from './useAnalysis';
import { DEFAULT_SETTINGS } from '../types/settings';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { OPENROUTER_SUGGESTED_FREE_MODEL } from '../providers/openai-compatible';
import { LlmError } from '../providers/errors';
import { buildDiffHistoryKey, HistoryStore } from '../core/history-store';
import { buildProviderCacheKey } from '../core/analysis-record';
import { SHARED_TAG_END, SHARED_TAG_START } from '../services/gitlab-api';
import type { GitLabGateway } from '../app/app-services';
import type { GitLabMergeRequestInfo, GitLabNote } from '../types/gitlab';
import type { MRAnalysisResult } from '../types/review';

const analyzeGitDiff = vi.hoisted(() => vi.fn());
vi.mock('../services/review-service', () => ({ analyzeGitDiff }));

const MR_URL = 'https://gitlab.example.com/grp/proj/-/merge_requests/7';
const MR = {
  web_url: MR_URL,
  title: 'MR',
  diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'h1' },
} as GitLabMergeRequestInfo;
const RESULT: MRAnalysisResult = { ...SAMPLE_ANALYSIS_RESULT, provider: 'gemini', model: 'gemini-3.8-flash' };

const note = (body: string): GitLabNote => ({
  id: 9,
  body,
  author: { id: 1, name: 'Ann', username: 'ann' },
  created_at: '2026-01-01T00:00:00Z',
  system: false,
});

function setup({
  store = null,
  providerReady = true,
  settings = DEFAULT_SETTINGS,
  initialRawDiff = SAMPLE_GIT_DIFF,
  notes = [] as GitLabNote[],
}: {
  store?: HistoryStore | null;
  providerReady?: boolean;
  settings?: typeof DEFAULT_SETTINGS;
  initialRawDiff?: string;
  notes?: GitLabNote[];
} = {}) {
  const gitlab = {
    resolveTarget: vi.fn(() => ({ baseUrl: 'https://gitlab.example.com', token: 't', projectPath: 'grp/proj', mrIid: 7 })),
    fetchMergeRequest: vi.fn(async () => MR),
    fetchRawDiff: vi.fn(async () => SAMPLE_GIT_DIFF),
    fetchNotes: vi.fn(async () => notes),
  } as unknown as GitLabGateway;
  const provider = { id: 'fake' };
  const options: UseAnalysisOptions = {
    services: {
      ai: { setupNotice: () => null, createProvider: vi.fn(() => provider as never) },
      gitlab,
      initialRawDiff,
    },
    settings: {
      settings,
      providerReady,
      currentProviderModel: { provider: settings.llmProvider, model: 'gemini-3.8-flash' },
      setIsSetupGuideOpen: vi.fn(),
      handleSaveSettings: vi.fn(),
    },
    history: {
      historyStore: store,
      refreshHistory: vi.fn(async () => {}),
      currentRecordId: null,
      setCurrentRecordId: vi.fn(),
      currentRecordIdRef: { current: null },
    },
  };
  const hook = renderHook((o: UseAnalysisOptions) => useAnalysis(o), options);
  return { ...hook, options, gitlab, provider };
}

beforeEach(() => {
  analyzeGitDiff.mockReset();
});

describe('useAnalysis', () => {
  it('左欄先填入服務提供的 diff 並即時解析', () => {
    const { result } = setup();
    expect(result.current.rawDiff).toBe(SAMPLE_GIT_DIFF);
    expect(result.current.parsedDiff.files.length).toBeGreaterThan(0);
    expect(result.current.resultDiffFiles).toBe(result.current.parsedDiff.files);
    expect(result.current.analysisResult).toBeNull();
  });

  it('provider 未設定時按「分析」只開啟設定引導', async () => {
    const { result, options } = setup({ providerReady: false });
    await actAsync(() => result.current.handleAnalyze());
    expect(options.settings.setIsSetupGuideOpen).toHaveBeenCalledWith(true);
    expect(analyzeGitDiff).not.toHaveBeenCalled();
  });

  it('分析成功：顯示結果、寫入歷史紀錄並設為目前紀錄', async () => {
    analyzeGitDiff.mockImplementation(async ({ onBatchProgress }) => {
      onBatchProgress(1, 2);
      return RESULT;
    });
    const { store } = createMemoryStore();
    const { result, options, provider } = setup({ store });
    await actAsync(() => result.current.handleAnalyze());

    expect(analyzeGitDiff).toHaveBeenCalledWith(
      expect.objectContaining({ rawDiff: SAMPLE_GIT_DIFF, provider, teamRules: DEFAULT_SETTINGS.teamRules })
    );
    const id = buildProviderCacheKey(buildDiffHistoryKey(SAMPLE_GIT_DIFF), { provider: 'gemini', model: 'gemini-3.8-flash' });
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({ id, sourceType: 'sample' }), expect.any(Number));
    expect(options.history.refreshHistory).toHaveBeenCalled();
    expect(options.history.setCurrentRecordId).toHaveBeenLastCalledWith(id);
    expect(options.settings.setIsSetupGuideOpen).toHaveBeenCalledWith(false);
    expect(result.current.analysisResult?.title).toBe(RESULT.title);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.batchProgress).toBeNull();
  });

  it('沒有歷史紀錄時仍顯示結果，目前紀錄為 null', async () => {
    analyzeGitDiff.mockResolvedValue(RESULT);
    const { result, options } = setup();
    await actAsync(() => result.current.handleAnalyze());
    expect(result.current.analysisResult?.title).toBe(RESULT.title);
    expect(options.history.setCurrentRecordId).toHaveBeenLastCalledWith(null);
  });

  it('有同 diff、同模型的快取時直接顯示，不呼叫 AI', async () => {
    const id = buildProviderCacheKey(buildDiffHistoryKey(SAMPLE_GIT_DIFF), { provider: 'gemini', model: 'gemini-3.8-flash' });
    const cached = makeRecord({ id, result: RESULT, rawDiff: SAMPLE_GIT_DIFF, selectedIndices: [1], draftEdits: { 1: { comment: 'c', suggestion: 's' } } });
    const { store } = createMemoryStore([cached]);
    const { result, options } = setup({ store });
    await actAsync(() => result.current.handleAnalyze());
    expect(analyzeGitDiff).not.toHaveBeenCalled();
    expect(options.history.setCurrentRecordId).toHaveBeenCalledWith(id);
    expect(result.current.selectedIndices).toEqual(new Set([1]));
    expect(result.current.draftEdits).toEqual(cached.draftEdits);
  });

  it('分析失敗顯示錯誤；OpenRouter 402 時提示改用免費模型', async () => {
    const settings = { ...DEFAULT_SETTINGS, llmProvider: 'openrouter' as const };
    analyzeGitDiff.mockRejectedValue(new LlmError('quota', '額度不足', 402));
    const { result, options } = setup({ settings });
    await actAsync(() => result.current.handleAnalyze());
    expect(result.current.errorMessage).toBe('額度不足');
    expect(result.current.suggestFreeModel).toBe(true);
    expect(result.current.isLoading).toBe(false);

    await actAsync(() => result.current.handleUseFreeModel());
    const saved = vi.mocked(options.settings.handleSaveSettings).mock.calls[0][0];
    expect(saved.providerSettings.openrouter.model).toBe(OPENROUTER_SUGGESTED_FREE_MODEL);
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.infoMessage).toContain(OPENROUTER_SUGGESTED_FREE_MODEL);
  });

  it('一般錯誤不提示免費模型', async () => {
    analyzeGitDiff.mockRejectedValue(new Error('壞掉了'));
    const { result } = setup();
    await actAsync(() => result.current.handleAnalyze());
    expect(result.current.errorMessage).toBe('壞掉了');
    expect(result.current.suggestFreeModel).toBe(false);
  });

  it('抓取 MR：填入 MR、diff 與留言，並偵測已分享的分析', async () => {
    const shared = note(`${SHARED_TAG_START}\n\`\`\`json\n${JSON.stringify(SAMPLE_ANALYSIS_RESULT)}\n\`\`\`\n${SHARED_TAG_END}`);
    const { result, gitlab } = setup({ initialRawDiff: '', notes: [shared] });
    await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
    expect(gitlab.resolveTarget).toHaveBeenCalledWith(MR_URL, DEFAULT_SETTINGS);
    expect(result.current.currentGitLabMr).toBe(MR);
    expect(result.current.rawDiff).toBe(SAMPLE_GIT_DIFF);
    expect(result.current.remoteNotes).toEqual([shared]);
    expect(result.current.sharedAnalysisAvailable?.author).toBe('Ann');
    expect(result.current.isFetchingGitLab).toBe(false);

    await actAsync(() => result.current.handleLoadSharedAnalysis());
    expect(result.current.analysisResult?.title).toBe(SAMPLE_ANALYSIS_RESULT.title);
    expect(result.current.sharedAnalysisAvailable).toBeNull();
  });

  it('抓取 MR 失敗時顯示 GitLab 錯誤', async () => {
    const { result, gitlab } = setup();
    vi.mocked(gitlab.fetchMergeRequest).mockRejectedValueOnce(new Error('401 Unauthorized'));
    await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
    expect(result.current.gitlabError).toBe('401 Unauthorized');
    expect(result.current.isFetchingGitLab).toBe(false);
  });

  it('載入範例分析：顯示範例結果、清空勾選與發布狀態', async () => {
    const { result, options } = setup({ initialRawDiff: '' });
    await actAsync(() => result.current.setSelectedIndices(new Set([0])));
    await actAsync(() => result.current.handleLoadSampleAnalysis());
    expect(result.current.rawDiff).toBe(SAMPLE_GIT_DIFF);
    expect(result.current.analysisResult?.title).toBe(SAMPLE_ANALYSIS_RESULT.title);
    expect(result.current.selectedIndices.size).toBe(0);
    expect(result.current.publishedRecords).toEqual([]);
    expect(options.history.setCurrentRecordId).toHaveBeenLastCalledWith(null);
  });

  it('開啟紀錄還原左欄 diff 與 MR；resetToEmpty 清空畫面', async () => {
    const record = makeRecord({
      id: 'mr',
      sourceType: 'gitlab',
      mrUrl: MR_URL,
      mr: MR,
      rawDiff: SAMPLE_GIT_DIFF,
      summaryPublished: true,
      selectedIndices: [2],
    });
    const { result } = setup({ initialRawDiff: '' });
    await actAsync(() => result.current.openRecord(record));
    expect(result.current.rawDiff).toBe(SAMPLE_GIT_DIFF);
    expect(result.current.gitlabMrUrl).toBe(MR_URL);
    expect(result.current.currentGitLabMr?.web_url).toBe(MR_URL);
    expect(result.current.resultDiffRefs).toEqual(MR.diff_refs);
    expect(result.current.isSummaryPublished).toBe(true);
    expect(result.current.selectedIndices).toEqual(new Set([2]));

    await actAsync(() => result.current.resetToEmpty());
    expect(result.current.analysisResult).toBeNull();
    expect(result.current.rawDiff).toBe('');
    expect(result.current.gitlabMrUrl).toBe('');
    expect(result.current.currentGitLabMr).toBeNull();
    expect(result.current.isSummaryPublished).toBe(false);
    expect(result.current.selectedIndices.size).toBe(0);
  });

  it('勾選、草稿變動時寫回目前紀錄', async () => {
    const { store } = createMemoryStore([makeRecord({ id: 'rec-1' })]);
    const { result, rerender, options } = setup({ store });
    rerender({ ...options, history: { ...options.history, currentRecordId: 'rec-1' } });
    await actAsync(() => result.current.setSelectedIndices(new Set([3])));
    expect(store.update).toHaveBeenLastCalledWith('rec-1', {
      selectedIndices: [3],
      draftEdits: {},
      published: [],
      summaryPublished: false,
      sharedPublished: false,
    });
  });
});
