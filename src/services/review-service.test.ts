import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeGitDiff } from './review-service';
import { createProvider } from '../providers/registry';
import { setRetryDelayForTest } from '../providers/errors';
import { LlmProvider, PROVIDER_IDS, ProviderId } from '../providers/types';
import { DIFF, jsonResponse, mockFetch, VALID_RESULT } from '../providers/test-helpers';

/** 各 provider 成功回應的格式 */
const okFor = (id: ProviderId, body: unknown) => {
  switch (id) {
    case 'gemini':
      return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
    case 'anthropic':
      return jsonResponse({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_review', input: body }] });
    default:
      return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(body) } }] });
  }
};

const HOSTS: Record<ProviderId, string> = {
  gemini: 'generativelanguage.googleapis.com',
  openai: 'api.openai.com',
  anthropic: 'api.anthropic.com',
  openrouter: 'openrouter.ai',
  custom: 'localhost:11434',
};

beforeEach(() => setRetryDelayForTest(async () => {}));
afterEach(() => vi.unstubAllGlobals());

describe('analyzeGitDiff（provider 切換）', () => {
  it.each(PROVIDER_IDS)('%s：只呼叫所選 provider，結果標記 provider/model 並套用行數補算', async (id) => {
    const { calls } = mockFetch(okFor(id, VALID_RESULT));
    const provider = createProvider(id, { apiKey: 'k', model: `model-${id}`, baseUrl: 'http://localhost:11434/v1' });
    const result = await analyzeGitDiff({ rawDiff: DIFF, provider });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).host).toBe(HOSTS[id]);
    expect(result.provider).toBe(id);
    expect(result.model).toBe(`model-${id}`);
    expect(result.groups[0].additions).toBe(3);
  });

  it('所選 provider 失敗時直接報錯，不 fallback 到其他 provider', async () => {
    const { calls } = mockFetch(jsonResponse({ error: { message: 'Incorrect API key' } }, 401));
    const provider = createProvider('openai', { apiKey: 'bad', model: 'gpt-4.1-mini' });
    await expect(analyzeGitDiff({ rawDiff: DIFF, provider })).rejects.toThrow('OpenAI API Key 無效');
    expect(calls.every((c) => new URL(c.url).host === 'api.openai.com')).toBe(true);
  });

  it('分批邏輯在上層共用：任何 provider 遇到 12 檔都分 2 批', async () => {
    const rawDiff = readFileSync(new URL('../core/__fixtures__/playground-mr1.diff', import.meta.url), 'utf8');
    const kinds: string[] = [];
    const provider: LlmProvider = {
      id: 'anthropic',
      label: 'Fake',
      model: 'm',
      listModels: async () => [],
      review: (async (req: { kind: string }) => {
        kinds.push(req.kind);
        return structuredClone(VALID_RESULT);
      }) as LlmProvider['review'],
    };
    const progress: Array<[number, number]> = [];
    await analyzeGitDiff({ rawDiff, provider, onBatchProgress: (c, t) => progress.push([c, t]) });
    expect(kinds).toEqual(['analysis', 'analysis']);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('schema 驗證失敗兩次時回報格式錯誤', async () => {
    const { fn } = mockFetch(okFor('openai', { title: 'missing everything' }));
    const provider = createProvider('openai', { apiKey: 'k', model: 'gpt-4.1-mini' });
    await expect(analyzeGitDiff({ rawDiff: DIFF, provider })).rejects.toThrow('輸出格式錯誤（已重試 1 次）');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
