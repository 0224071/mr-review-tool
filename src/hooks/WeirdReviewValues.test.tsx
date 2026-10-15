// @vitest-environment happy-dom
/**
 * #71：歷史紀錄、快取與 AI 結果裡的怪異 category／severity（HTML 注入字串、__proto__、null、數字）
 * 套用到畫面前先正規化：頁面不會崩潰，離線 HTML 匯出也不含注入的 HTML。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actAsync, createMemoryStore, makeRecord, renderHook } from './test-utils';
import { useAnalysis, UseAnalysisOptions } from './useAnalysis';
import { AnalysisResultView } from '../components/AnalysisResultView';
import { generateOfflineHtmlReport } from '../utils/export-offline';
import { DEFAULT_SETTINGS } from '../types/settings';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { buildDiffHistoryKey, HistoryStore } from '../core/history-store';
import { buildProviderCacheKey } from '../core/analysis-record';
import type { GitLabGateway } from '../app/app-services';
import type { MRAnalysisResult, MRReviewItem } from '../types/review';

const analyzeGitDiff = vi.hoisted(() => vi.fn());
vi.mock('../services/review-service', () => ({ analyzeGitDiff }));

const INJECTED = '<img src=x onerror=alert(1)>';
const WEIRD_VALUES: unknown[] = [INJECTED, '__proto__', null, 42];
const KNOWN_CATEGORIES = ['bug', 'performance', 'a11y', 'readability', 'style', 'test', 'config', 'other'];
const KNOWN_SEVERITIES = ['high', 'medium', 'low'];

/** 每個怪異值各放一則意見，同時當 category 與 severity */
const weirdResult = (): MRAnalysisResult => {
  const base = SAMPLE_ANALYSIS_RESULT.reviews[0];
  return {
    ...SAMPLE_ANALYSIS_RESULT,
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    reviews: WEIRD_VALUES.map(
      (v, i) => ({ ...base, category: v, severity: v, comment: `FAKE 怪異值意見 ${i}` }) as unknown as MRReviewItem
    ),
  };
};

function setup(store: HistoryStore | null) {
  const gitlab = {
    resolveTarget: vi.fn(),
    fetchMergeRequest: vi.fn(),
    fetchRawDiff: vi.fn(),
    fetchNotes: vi.fn(async () => []),
  } as unknown as GitLabGateway;
  const options: UseAnalysisOptions = {
    services: {
      ai: { setupNotice: () => null, createProvider: vi.fn(() => ({ id: 'fake' }) as never) },
      gitlab,
      initialRawDiff: SAMPLE_GIT_DIFF,
    },
    settings: {
      settings: DEFAULT_SETTINGS,
      providerReady: true,
      currentProviderModel: { provider: 'gemini', model: 'gemini-3.8-flash' },
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
  return renderHook((o: UseAnalysisOptions) => useAnalysis(o), options);
}

/** 畫面上的結果：只含認得的值、整頁可以渲染、匯出 HTML 不含注入的標籤 */
function expectSafe(result: MRAnalysisResult | null) {
  expect(result).not.toBeNull();
  const reviews = result!.reviews;
  expect(reviews).toHaveLength(WEIRD_VALUES.length);
  for (const r of reviews) {
    expect(KNOWN_CATEGORIES).toContain(r.category);
    expect(KNOWN_SEVERITIES).toContain(r.severity);
  }

  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <AnalysisResultView
      result={result!}
      selectedIndices={new Set()}
      onSelectedIndicesChange={() => {}}
      draftEdits={{}}
      onDraftEditsChange={() => {}}
    />
  );
  for (let i = 0; i < WEIRD_VALUES.length; i++) expect(container.textContent).toContain(`FAKE 怪異值意見 ${i}`);
  expect(container.querySelector('img')).toBeNull();

  const html = generateOfflineHtmlReport(result!);
  expect(html).not.toMatch(/<img/i);
  // onerror 只會出現在跳脫過的文字裡（例如匯出的 JSON），不會以標籤屬性形式出現
  const onerrorAll = (html.match(/\bonerror\s*=/gi) ?? []).length;
  const onerrorEscaped = (html.match(/&lt;img src=x onerror\s*=/gi) ?? []).length;
  expect(onerrorAll).toBe(onerrorEscaped);
}

beforeEach(() => {
  analyzeGitDiff.mockReset();
});

describe('怪異的 category／severity 不會讓頁面崩潰（#71）', () => {
  it('開啟舊的歷史紀錄', async () => {
    const record = makeRecord({ id: 'old', result: weirdResult(), rawDiff: SAMPLE_GIT_DIFF });
    const { result } = setup(null);
    await actAsync(() => result.current.openRecord(record));
    expectSafe(result.current.analysisResult);
  });

  it('命中快取', async () => {
    const id = buildProviderCacheKey(buildDiffHistoryKey(SAMPLE_GIT_DIFF), { provider: 'gemini', model: 'gemini-3.8-flash' });
    const { store } = createMemoryStore([makeRecord({ id, result: weirdResult(), rawDiff: SAMPLE_GIT_DIFF })]);
    const { result } = setup(store);
    await actAsync(() => result.current.handleAnalyze());
    expect(analyzeGitDiff).not.toHaveBeenCalled();
    expectSafe(result.current.analysisResult);
  });

  it('AI 回傳的結果：畫面與寫入歷史紀錄的都已正規化', async () => {
    analyzeGitDiff.mockResolvedValue(weirdResult());
    const { store } = createMemoryStore();
    const { result } = setup(store);
    await actAsync(() => result.current.handleAnalyze());
    expect(analyzeGitDiff).toHaveBeenCalledTimes(1);
    expectSafe(result.current.analysisResult);
    const saved = store.put.mock.calls.at(-1)![0];
    for (const r of saved.result.reviews) {
      expect(KNOWN_CATEGORIES).toContain(r.category);
      expect(KNOWN_SEVERITIES).toContain(r.severity);
    }
  });
});
