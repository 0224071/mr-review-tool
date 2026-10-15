// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actAsync, createMemoryStore, makeRecord, renderHook } from './test-utils';
import { useAnalysis, UseAnalysisOptions } from './useAnalysis';
import { DEFAULT_SETTINGS } from '../types/settings';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { OPENROUTER_SUGGESTED_FREE_MODEL } from '../providers/openai-compatible';
import { LlmError } from '../providers/errors';
import { buildDiffHistoryKey, buildMrHistoryKey, HistoryStore } from '../core/history-store';
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

const sharedNote = (json: object) =>
  note(`${SHARED_TAG_START}\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\n${SHARED_TAG_END}`);

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

  it('抓取 MR：填入 MR、diff 與留言；共享報告與 MR 目前版本相同時自動載入，不呼叫 AI', async () => {
    const shared = sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: 'h1' });
    const { store } = createMemoryStore();
    const { result, gitlab } = setup({ store, initialRawDiff: '', notes: [shared] });
    await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
    expect(gitlab.resolveTarget).toHaveBeenCalledWith(MR_URL, DEFAULT_SETTINGS);
    expect(result.current.currentGitLabMr).toBe(MR);
    expect(result.current.rawDiff).toBe(SAMPLE_GIT_DIFF);
    expect(result.current.remoteNotes).toEqual([shared]);
    expect(result.current.isFetchingGitLab).toBe(false);

    expect(analyzeGitDiff).not.toHaveBeenCalled();
    expect(result.current.analysisResult?.title).toBe(SAMPLE_ANALYSIS_RESULT.title);
    expect(result.current.analysisResult).not.toHaveProperty('headSha');
    expect(result.current.resultDiffRefs).toEqual(MR.diff_refs);
    expect(result.current.staleSharedAnalysis).toBeNull();
    expect(result.current.infoMessage).toContain('由 Ann（@ann） 於');
    expect(result.current.infoMessage).not.toContain('@Ann');
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({ headSha: 'h1' }), expect.any(Number));
  });

  it('共享報告的 headSha 與 MR 目前 head sha 不同：不載入，只顯示需重新分析的提示', async () => {
    const shared = sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: 'FAKE-old-head' });
    const { store } = createMemoryStore();
    const { result } = setup({ store, initialRawDiff: '', notes: [shared] });
    await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
    expect(result.current.analysisResult).toBeNull();
    expect(store.put).not.toHaveBeenCalled();
    expect(result.current.staleSharedAnalysis).toEqual({
      author: { name: 'Ann', username: 'ann' },
      createdAt: '2026-01-01T00:00:00Z',
      sharedHeadSha: 'FAKE-old-head',
      currentHeadSha: 'h1',
    });
    expect(analyzeGitDiff).not.toHaveBeenCalled();
  });

  it('舊版標記沒有 headSha：一律視為不符，不自動載入', async () => {
    const shared = sharedNote(SAMPLE_ANALYSIS_RESULT);
    const { result } = setup({ initialRawDiff: '', notes: [shared] });
    await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
    expect(result.current.analysisResult).toBeNull();
    expect(result.current.staleSharedAnalysis).toMatchObject({ sharedHeadSha: null, currentHeadSha: 'h1' });
  });

  it('過期提示在重新分析出結果後消失', async () => {
    analyzeGitDiff.mockResolvedValue(RESULT);
    const { result } = setup({ initialRawDiff: '', notes: [sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: 'FAKE-old-head' })] });
    await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
    expect(result.current.staleSharedAnalysis).not.toBeNull();
    await actAsync(() => result.current.handleAnalyze());
    expect(result.current.analysisResult?.title).toBe(RESULT.title);
    expect(result.current.staleSharedAnalysis).toBeNull();
  });

  it('本機已有同版本的快取時以快取為準，不用共享報告覆蓋', async () => {
    const id = buildProviderCacheKey(buildMrHistoryKey('https://gitlab.example.com', 'grp/proj', 7), { provider: 'gemini', model: 'gemini-3.8-flash' });
    const cached = makeRecord({ id, sourceType: 'gitlab', result: RESULT, rawDiff: SAMPLE_GIT_DIFF, headSha: 'h1', draftEdits: { 0: { comment: '草稿', suggestion: '' } } });
    const { store } = createMemoryStore([cached]);
    const { result } = setup({ store, initialRawDiff: '', notes: [sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: 'h1' })] });
    await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
    expect(store.put).not.toHaveBeenCalled();
    expect(result.current.draftEdits).toEqual(cached.draftEdits);
  });

  describe('切換 MR 時只套用最新一次抓取的回應', () => {
    const MR_A = { ...MR, web_url: 'https://gitlab.example.com/grp/proj/-/merge_requests/1', iid: 1, title: 'FAKE-MR-A', diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'FAKE-head-a' } } as GitLabMergeRequestInfo;
    const MR_B = { ...MR, web_url: 'https://gitlab.example.com/grp/proj/-/merge_requests/2', iid: 2, title: 'FAKE-MR-B', diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'FAKE-head-b' } } as GitLabMergeRequestInfo;
    const DIFF_B = 'diff --git a/FAKE-b.ts b/FAKE-b.ts\n--- a/FAKE-b.ts\n+++ b/FAKE-b.ts\n@@ -1 +1 @@\n-old\n+new\n';

    function deferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    /** MR A 的某個 GET 卡住；MR B 立即回應。A 的留言帶與 A 目前版本相同的共享報告（若被套用就會自動載入） */
    function setupRace(slow: 'mr' | 'notes') {
      const { store } = createMemoryStore();
      const ctx = setup({ store, initialRawDiff: '' });
      const gate = deferred<void>();
      const iidOf = (t: { mrIid: number }) => t.mrIid;
      vi.mocked(ctx.gitlab.resolveTarget).mockImplementation(((url: string) => ({
        baseUrl: 'https://gitlab.example.com',
        token: 't',
        projectPath: 'grp/proj',
        mrIid: url.endsWith('/1') ? 1 : 2,
      })) as never);
      vi.mocked(ctx.gitlab.fetchMergeRequest).mockImplementation((async (t: { mrIid: number }) => {
        if (iidOf(t) === 1 && slow === 'mr') await gate.promise;
        return iidOf(t) === 1 ? MR_A : MR_B;
      }) as never);
      vi.mocked(ctx.gitlab.fetchRawDiff).mockImplementation((async (t: { mrIid: number }) =>
        iidOf(t) === 1 ? SAMPLE_GIT_DIFF : DIFF_B) as never);
      vi.mocked(ctx.gitlab.fetchNotes).mockImplementation((async (t: { mrIid: number }) => {
        if (iidOf(t) !== 1) return [];
        if (slow === 'notes') await gate.promise;
        return [sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: 'FAKE-head-a' })];
      }) as never);
      return { ...ctx, store, gate };
    }

    const expectShowingB = (current: ReturnType<typeof useAnalysis>) => {
      expect(current.currentGitLabMr).toBe(MR_B);
      expect(current.rawDiff).toBe(DIFF_B);
      expect(current.remoteNotes).toEqual([]);
      expect(current.analysisResult).toBeNull();
      expect(current.staleSharedAnalysis).toBeNull();
      expect(current.infoMessage).toBeNull();
      expect(current.gitlabError).toBeNull();
      expect(current.isFetchingGitLab).toBe(false);
    };

    it('先切到 A 再切到 B，A 的 MR 資訊較晚回來：畫面維持 B', async () => {
      const { result, gate, store } = setupRace('mr');
      let fetchA!: Promise<void>;
      await actAsync(() => {
        fetchA = result.current.handleFetchGitLabMr(MR_A.web_url);
      });
      expect(result.current.isFetchingGitLab).toBe(true);
      await actAsync(() => result.current.handleFetchGitLabMr(MR_B.web_url));
      expectShowingB(result.current);

      await actAsync(async () => {
        gate.resolve();
        await fetchA;
      });
      expectShowingB(result.current);
      expect(store.put).not.toHaveBeenCalled();
    });

    it('A 已填入 MR 後留言才晚回來（帶目前版本的共享報告）：不自動載入、畫面維持 B', async () => {
      const { result, gate } = setupRace('notes');
      let fetchA!: Promise<void>;
      await actAsync(() => {
        fetchA = result.current.handleFetchGitLabMr(MR_A.web_url);
      });
      expect(result.current.currentGitLabMr).toBe(MR_A);
      await actAsync(() => result.current.handleFetchGitLabMr(MR_B.web_url));
      await actAsync(async () => {
        gate.resolve();
        await fetchA;
      });
      expectShowingB(result.current);
      expect(analyzeGitDiff).not.toHaveBeenCalled();
    });

    it('A 較晚回來的錯誤不顯示；B 還在抓取時 A 回來也不結束 loading', async () => {
      const { result, gitlab, gate } = setupRace('mr');
      let fetchA!: Promise<void>;
      await actAsync(() => {
        fetchA = result.current.handleFetchGitLabMr(MR_A.web_url);
      });
      // B 的 diff 也卡住：A 失敗時 B 仍在抓取中
      const gateB = deferred<string>();
      vi.mocked(gitlab.fetchRawDiff).mockImplementationOnce(() => gateB.promise);
      let fetchB!: Promise<void>;
      await actAsync(() => {
        fetchB = result.current.handleFetchGitLabMr(MR_B.web_url);
      });
      await actAsync(async () => {
        gate.reject(new Error('FAKE-A-failed'));
        await fetchA;
      });
      expect(result.current.gitlabError).toBeNull();
      expect(result.current.isFetchingGitLab).toBe(true);

      await actAsync(async () => {
        gateB.resolve(DIFF_B);
        await fetchB;
      });
      expectShowingB(result.current);
    });
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

describe('分析流程穩定性（#71）', () => {
  function gate<T = void>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const MR_A = { ...MR, web_url: 'https://gitlab.example.com/grp/proj/-/merge_requests/1', iid: 1, title: 'FAKE-MR-A', diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'FAKE-head-a' } } as GitLabMergeRequestInfo;
  const MR_B = { ...MR, web_url: 'https://gitlab.example.com/grp/proj/-/merge_requests/2', iid: 2, title: 'FAKE-MR-B', diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'FAKE-head-b' } } as GitLabMergeRequestInfo;
  const DIFF_B = 'diff --git a/FAKE-b.ts b/FAKE-b.ts\n--- a/FAKE-b.ts\n+++ b/FAKE-b.ts\n@@ -1 +1 @@\n-old\n+new\n';
  const RESULT_A: MRAnalysisResult = { ...RESULT, title: 'FAKE-RESULT-A' };

  /** GitLab 依網址結尾的 iid 回 MR A 或 B */
  function setupAB(store: HistoryStore | null = null) {
    const ctx = setup({ store, initialRawDiff: '' });
    vi.mocked(ctx.gitlab.resolveTarget).mockImplementation(((url: string) => ({
      baseUrl: 'https://gitlab.example.com',
      token: 't',
      projectPath: 'grp/proj',
      mrIid: url.endsWith('/1') ? 1 : 2,
    })) as never);
    vi.mocked(ctx.gitlab.fetchMergeRequest).mockImplementation((async (t: { mrIid: number }) =>
      t.mrIid === 1 ? MR_A : MR_B) as never);
    vi.mocked(ctx.gitlab.fetchRawDiff).mockImplementation((async (t: { mrIid: number }) =>
      t.mrIid === 1 ? SAMPLE_GIT_DIFF : DIFF_B) as never);
    return ctx;
  }

  describe('分析進行中擋住重複觸發', () => {
    it('讀快取的空檔連點兩下「分析」：AI 只被呼叫一次', async () => {
      analyzeGitDiff.mockResolvedValue(RESULT);
      const { store } = createMemoryStore();
      const cacheRead = gate<undefined>();
      store.get.mockImplementation(() => cacheRead.promise);
      const { result } = setup({ store });

      let first!: Promise<void>;
      let second!: Promise<void>;
      await actAsync(() => {
        first = result.current.handleAnalyze();
        second = result.current.handleAnalyze();
      });
      // 第二次在讀快取時就被擋下，連快取都不會再讀
      expect(store.get).toHaveBeenCalledTimes(1);
      await actAsync(async () => {
        store.get.mockResolvedValue(undefined);
        cacheRead.resolve(undefined);
        await Promise.all([first, second]);
      });
      expect(analyzeGitDiff).toHaveBeenCalledTimes(1);
      expect(result.current.analysisResult?.title).toBe(RESULT.title);
    });

    it('AI 分析中再按「分析」不會再呼叫；分析結束後可以再分析', async () => {
      const ai = gate<MRAnalysisResult>();
      analyzeGitDiff.mockImplementationOnce(() => ai.promise);
      const { result } = setup();
      let first!: Promise<void>;
      await actAsync(() => {
        first = result.current.handleAnalyze();
      });
      expect(result.current.isLoading).toBe(true);
      await actAsync(() => result.current.handleAnalyze());
      await actAsync(() => result.current.handleReanalyze());
      expect(analyzeGitDiff).toHaveBeenCalledTimes(1);

      await actAsync(async () => {
        ai.resolve(RESULT);
        await first;
      });
      expect(result.current.isLoading).toBe(false);
      analyzeGitDiff.mockResolvedValueOnce(RESULT);
      await actAsync(() => result.current.handleAnalyze());
      expect(analyzeGitDiff).toHaveBeenCalledTimes(2);
    });

    it('連點「重新分析」：只重新抓一次 MR、只呼叫 AI 一次', async () => {
      analyzeGitDiff.mockResolvedValue(RESULT);
      const { result, gitlab } = setup({ initialRawDiff: '' });
      await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
      vi.mocked(gitlab.fetchMergeRequest).mockClear();
      await actAsync(() => Promise.all([result.current.handleReanalyze(), result.current.handleReanalyze()]));
      expect(gitlab.fetchMergeRequest).toHaveBeenCalledTimes(1);
      expect(analyzeGitDiff).toHaveBeenCalledTimes(1);
    });
  });

  describe('AI 分析結果的序號保護：分析中切換 MR', () => {
    it('分析 A 時切到 B，A 的結果較晚回來：不寫到 B 的畫面，只存進歷史紀錄', async () => {
      const aiA = gate<MRAnalysisResult>();
      analyzeGitDiff.mockImplementationOnce(() => aiA.promise);
      const { store } = createMemoryStore();
      const { result } = setupAB(store);

      await actAsync(() => result.current.handleFetchGitLabMr(MR_A.web_url));
      expect(result.current.currentGitLabMr).toBe(MR_A);
      let analyzeA!: Promise<void>;
      await actAsync(() => {
        analyzeA = result.current.handleAnalyze();
      });
      expect(result.current.isLoading).toBe(true);

      await actAsync(() => result.current.handleFetchGitLabMr(MR_B.web_url));
      expect(result.current.currentGitLabMr).toBe(MR_B);
      // 切到 B 後畫面不再顯示 A 的分析中狀態
      expect(result.current.isLoading).toBe(false);

      await actAsync(async () => {
        aiA.resolve(RESULT_A);
        await analyzeA;
      });
      expect(result.current.currentGitLabMr).toBe(MR_B);
      expect(result.current.rawDiff).toBe(DIFF_B);
      expect(result.current.analysisResult).toBeNull();
      expect(result.current.resultDiffRefs).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.errorMessage).toBeNull();
      // A 的結果仍寫入 A 的歷史紀錄，之後開 A 可直接看到
      expect(store.put).toHaveBeenCalledWith(
        expect.objectContaining({ mrUrl: MR_A.web_url, result: expect.objectContaining({ title: RESULT_A.title }) }),
        expect.any(Number)
      );
    });

    it('分析 A 時切到 B，A 較晚失敗：錯誤不顯示在 B 的畫面', async () => {
      const aiA = gate<MRAnalysisResult>();
      analyzeGitDiff.mockImplementationOnce(() => aiA.promise);
      const { result } = setupAB();
      await actAsync(() => result.current.handleFetchGitLabMr(MR_A.web_url));
      let analyzeA!: Promise<void>;
      await actAsync(() => {
        analyzeA = result.current.handleAnalyze();
      });
      await actAsync(() => result.current.handleFetchGitLabMr(MR_B.web_url));
      await actAsync(async () => {
        aiA.reject(new Error('FAKE-A-failed'));
        await analyzeA;
      });
      expect(result.current.errorMessage).toBeNull();
      expect(result.current.currentGitLabMr).toBe(MR_B);
    });

    it('切到 B 後可以馬上分析 B（不被 A 擋住）；A 較晚回來不蓋掉 B 的結果', async () => {
      const aiA = gate<MRAnalysisResult>();
      analyzeGitDiff.mockImplementationOnce(() => aiA.promise);
      const { result } = setupAB();
      await actAsync(() => result.current.handleFetchGitLabMr(MR_A.web_url));
      let analyzeA!: Promise<void>;
      await actAsync(() => {
        analyzeA = result.current.handleAnalyze();
      });
      await actAsync(() => result.current.handleFetchGitLabMr(MR_B.web_url));

      const RESULT_B: MRAnalysisResult = { ...RESULT, title: 'FAKE-RESULT-B' };
      analyzeGitDiff.mockResolvedValueOnce(RESULT_B);
      await actAsync(() => result.current.handleAnalyze());
      expect(analyzeGitDiff).toHaveBeenCalledTimes(2);
      expect(analyzeGitDiff).toHaveBeenLastCalledWith(expect.objectContaining({ rawDiff: DIFF_B }));
      expect(result.current.analysisResult?.title).toBe('FAKE-RESULT-B');

      await actAsync(async () => {
        aiA.resolve(RESULT_A);
        await analyzeA;
      });
      expect(result.current.analysisResult?.title).toBe('FAKE-RESULT-B');
      expect(result.current.resultDiffRefs).toEqual(MR_B.diff_refs);
    });

    it('「重新分析」的 AI 分析中切到 B：A 的結果不寫到 B 的畫面', async () => {
      const aiA = gate<MRAnalysisResult>();
      analyzeGitDiff.mockImplementationOnce(() => aiA.promise);
      const { result } = setupAB();
      await actAsync(() => result.current.handleFetchGitLabMr(MR_A.web_url));
      let reanalyzeA!: Promise<void>;
      await actAsync(() => {
        reanalyzeA = result.current.handleReanalyze();
      });
      expect(analyzeGitDiff).toHaveBeenCalledTimes(1);
      await actAsync(() => result.current.handleFetchGitLabMr(MR_B.web_url));
      await actAsync(async () => {
        aiA.resolve(RESULT_A);
        await reanalyzeA;
      });
      expect(result.current.currentGitLabMr).toBe(MR_B);
      expect(result.current.analysisResult).toBeNull();
    });
  });

  describe('「重新分析」先重新抓 MR 再分析', () => {
    it('重新抓 MR 與 diff，以最新的 diff 與 MR 呼叫 AI', async () => {
      analyzeGitDiff.mockResolvedValue(RESULT);
      const { result, gitlab } = setup({ initialRawDiff: '' });
      await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
      const LATEST_MR = { ...MR, diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'FAKE-head-latest' } } as GitLabMergeRequestInfo;
      vi.mocked(gitlab.fetchMergeRequest).mockResolvedValueOnce(LATEST_MR);
      vi.mocked(gitlab.fetchRawDiff).mockResolvedValueOnce(DIFF_B);

      await actAsync(() => result.current.handleReanalyze());
      expect(gitlab.fetchMergeRequest).toHaveBeenCalledTimes(2);
      expect(gitlab.fetchRawDiff).toHaveBeenCalledTimes(2);
      expect(analyzeGitDiff).toHaveBeenCalledTimes(1);
      expect(analyzeGitDiff).toHaveBeenCalledWith(expect.objectContaining({ rawDiff: DIFF_B }));
      expect(result.current.currentGitLabMr).toBe(LATEST_MR);
      expect(result.current.rawDiff).toBe(DIFF_B);
      expect(result.current.resultDiffRefs).toEqual(LATEST_MR.diff_refs);
    });

    it('過期共享報告的提示在重新分析出結果後消失', async () => {
      analyzeGitDiff.mockResolvedValue(RESULT);
      const { result } = setup({ initialRawDiff: '', notes: [sharedNote({ ...SAMPLE_ANALYSIS_RESULT, headSha: 'FAKE-old-head' })] });
      await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
      expect(result.current.staleSharedAnalysis).not.toBeNull();
      await actAsync(() => result.current.handleReanalyze());
      expect(result.current.analysisResult?.title).toBe(RESULT.title);
      expect(result.current.staleSharedAnalysis).toBeNull();
    });

    it('重新抓 MR 失敗時顯示 GitLab 錯誤，不呼叫 AI', async () => {
      const { result, gitlab } = setup({ initialRawDiff: '' });
      await actAsync(() => result.current.handleFetchGitLabMr(MR_URL));
      vi.mocked(gitlab.fetchMergeRequest).mockRejectedValueOnce(new Error('FAKE-401'));
      await actAsync(() => result.current.handleReanalyze());
      expect(result.current.gitlabError).toBe('FAKE-401');
      expect(analyzeGitDiff).not.toHaveBeenCalled();
      // 失敗後可以再試
      analyzeGitDiff.mockResolvedValueOnce(RESULT);
      await actAsync(() => result.current.handleReanalyze());
      expect(analyzeGitDiff).toHaveBeenCalledTimes(1);
    });
  });
});
