/** 「測試連線」必須打需要驗證 key 的 endpoint；OpenRouter 額度／免費模型提示 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from './anthropic';
import { LlmError, setRetryDelayForTest } from './errors';
import { createGeminiProvider } from './gemini';
import {
  createOpenAiCompatibleProvider,
  describeOpenRouterCredit,
  isOpenRouterFreeModel,
  OPENROUTER_SUGGESTED_FREE_MODEL,
  parseOpenRouterKeyInfo,
  shouldSuggestFreeModel,
} from './openai-compatible';
import { jsonResponse, mockFetch, REQUEST } from './test-helpers';

beforeEach(() => setRetryDelayForTest(async () => {}));
afterEach(() => vi.unstubAllGlobals());

const unauthorized = () => jsonResponse({ error: { message: 'Invalid API key', code: 401 } }, 401);
const openrouter = (model = 'openai/gpt-4.1-mini') =>
  createOpenAiCompatibleProvider('openrouter', { apiKey: 'sk-or-fake', model });

describe('OpenRouter 測試連線', () => {
  it('先打 /key（Bearer）驗證 key，再取 /models 並標示免費模型', async () => {
    const { calls } = mockFetch(
      jsonResponse({ data: { label: 'sk-or-v1-abc', limit: null, usage: 0, limit_remaining: null, is_free_tier: true } }),
      jsonResponse({
        data: [
          { id: 'openai/gpt-4.1-mini', pricing: { prompt: '0.0000004', completion: '0.0000016' } },
          { id: OPENROUTER_SUGGESTED_FREE_MODEL, pricing: { prompt: '0', completion: '0' } },
          { id: 'some/zero-price', pricing: { prompt: '0', completion: '0' } },
        ],
      })
    );
    const result = await openrouter().testConnection();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://openrouter.ai/api/v1/key',
      'GET https://openrouter.ai/api/v1/models',
    ]);
    expect(calls[0].headers.Authorization).toBe('Bearer sk-or-fake');
    expect(result.keyVerified).toBe(true);
    expect(result.keyInfo).toEqual({ label: 'sk-or-v1-abc', limit: null, usage: 0, limitRemaining: null, isFreeTier: true });
    expect(result.models).toEqual([
      { id: OPENROUTER_SUGGESTED_FREE_MODEL, free: true },
      { id: 'openai/gpt-4.1-mini', free: false },
      { id: 'some/zero-price', free: true },
    ]);
  });

  it('假 key：/key 回 401 時報 auth 錯誤，不再呼叫公開的 /models', async () => {
    const { fn } = mockFetch(unauthorized(), jsonResponse({ data: [{ id: 'x' }] }));
    const err = await openrouter().testConnection().catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe('auth');
    expect(err.message).toContain('OpenRouter API Key 無效');
    expect(err.message).toContain('401');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('分析回 402 時歸類為額度不足並建議免費模型', async () => {
    mockFetch(jsonResponse({ error: { message: 'Insufficient credits', code: 402 } }, 402));
    const err = await openrouter().review(REQUEST).catch((e) => e);
    expect(err.kind).toBe('quota');
    expect(err.status).toBe(402);
    expect(err.message).toContain('額度不足');
    expect(err.message).toContain(':free');
    expect(shouldSuggestFreeModel(err, 'openrouter', 'openai/gpt-4.1-mini')).toBe(true);
    // 已經是免費模型、或不是 OpenRouter、或不是 402 時不建議
    expect(shouldSuggestFreeModel(err, 'openrouter', OPENROUTER_SUGGESTED_FREE_MODEL)).toBe(false);
    expect(shouldSuggestFreeModel(err, 'openai', 'gpt-4.1-mini')).toBe(false);
    expect(shouldSuggestFreeModel(new LlmError('quota', 'x', 429), 'openrouter', 'm')).toBe(false);
  });

  it('其他 provider 的 402 不附 OpenRouter 免費模型提示', async () => {
    mockFetch(jsonResponse({ error: { message: 'billing' } }, 402));
    const err = await createOpenAiCompatibleProvider('openai', { apiKey: 'k', model: 'm' }).review(REQUEST).catch((e) => e);
    expect(err.kind).toBe('quota');
    expect(err.message).not.toContain(':free');
  });
});

describe('OpenRouter 額度提示', () => {
  it('parseOpenRouterKeyInfo 容忍缺欄位', () => {
    expect(parseOpenRouterKeyInfo({})).toEqual({ label: undefined, limit: null, usage: 0, limitRemaining: null, isFreeTier: false });
  });

  it('額度用完、free tier 時警告；有剩餘或無上限時一般提示', () => {
    const base = { limit: 5, usage: 5, limitRemaining: 0, isFreeTier: false };
    expect(describeOpenRouterCredit(base)).toMatchObject({ warn: true });
    expect(describeOpenRouterCredit(base).message).toContain('額度已用完');
    expect(describeOpenRouterCredit({ ...base, limit: null, limitRemaining: null, usage: 0, isFreeTier: true })).toMatchObject({
      warn: true,
    });
    expect(describeOpenRouterCredit({ ...base, limitRemaining: 3, usage: 2 })).toEqual({
      warn: false,
      message: '此 key 剩餘額度 $3.00（上限 $5.00，已用 $2.00）。',
    });
    expect(describeOpenRouterCredit({ ...base, limit: null, limitRemaining: null, usage: 1.5 }).warn).toBe(false);
  });

  it('isOpenRouterFreeModel：:free 結尾或單價皆為 0', () => {
    expect(isOpenRouterFreeModel({ id: 'a/b:free' })).toBe(true);
    expect(isOpenRouterFreeModel({ id: 'a/b', pricing: { prompt: '0', completion: '0' } })).toBe(true);
    expect(isOpenRouterFreeModel({ id: 'a/b', pricing: { prompt: '0', completion: '0.1' } })).toBe(false);
    expect(isOpenRouterFreeModel({ id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } })).toBe(false);
  });
});

describe('其他 provider 測試連線都打需要驗證的 endpoint', () => {
  it('OpenAI：GET /v1/models 帶 Bearer，401 報 auth', async () => {
    const { calls } = mockFetch(unauthorized());
    const err = await createOpenAiCompatibleProvider('openai', { apiKey: 'sk-fake', model: 'm' }).testConnection().catch((e) => e);
    expect(calls[0].url).toBe('https://api.openai.com/v1/models');
    expect(calls[0].headers.Authorization).toBe('Bearer sk-fake');
    expect(err.kind).toBe('auth');
  });

  it('OpenAI：成功時 keyVerified=true', async () => {
    mockFetch(jsonResponse({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] }));
    expect(await createOpenAiCompatibleProvider('openai', { apiKey: 'k', model: 'm' }).testConnection()).toEqual({
      models: [{ id: 'gpt-a' }, { id: 'gpt-b' }],
      keyVerified: true,
    });
  });

  it('Anthropic：GET /v1/models 帶 x-api-key，401 報 auth', async () => {
    const { calls } = mockFetch(
      jsonResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)
    );
    const err = await createAnthropicProvider({ apiKey: 'sk-ant-fake', model: 'm' }).testConnection().catch((e) => e);
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-fake');
    expect(err.kind).toBe('auth');
  });

  it('Gemini：帶 key 的 models list，400 API_KEY_INVALID 報 auth', async () => {
    const { calls } = mockFetch(
      jsonResponse(
        { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } },
        400
      )
    );
    const err = await createGeminiProvider({ apiKey: 'AIza-fake', model: 'm' }).testConnection().catch((e) => e);
    expect(calls[0].url).toMatch(/\/v1beta\/models\?pageSize=1000&key=AIza-fake$/);
    expect(err.kind).toBe('auth');
  });

  it('自訂 OpenAI 相容：/models best-effort，keyVerified=false', async () => {
    mockFetch(jsonResponse({ models: [{ name: 'llama3.1' }] }));
    expect(
      await createOpenAiCompatibleProvider('custom', { apiKey: 'whatever', model: 'm', baseUrl: 'http://x/v1' }).testConnection()
    ).toEqual({ models: [{ id: 'llama3.1' }], keyVerified: false });
  });
});
