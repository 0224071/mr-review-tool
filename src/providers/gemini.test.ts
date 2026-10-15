import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRetryDelayForTest } from './errors';
import { createGeminiProvider } from './gemini';
import { jsonResponse, mockFetch, REQUEST, VALID_RESULT } from './test-helpers';

const ok = (body: unknown) => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] });
const provider = () => createGeminiProvider({ apiKey: ' test-key ', model: 'gemini-3.8-flash' });

beforeEach(() => setRetryDelayForTest(async () => {}));
afterEach(() => vi.unstubAllGlobals());

describe('Gemini provider', () => {
  it('POST generateContent：key 在 query、body 帶 responseSchema 與 system/user prompt', async () => {
    const { calls } = mockFetch(ok(VALID_RESULT));
    const result = await provider().review(REQUEST);
    expect(result.title).toBe('新增分頁');
    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=test-key'
    );
    expect(call.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(call.body.systemInstruction.parts[0].text).toBe('SYS');
    expect(call.body.contents[0].parts[0].text).toBe('PROMPT');
    expect(call.body.generationConfig.responseMimeType).toBe('application/json');
    expect(call.body.generationConfig.responseSchema.type).toBe('OBJECT');
  });

  it('listModels 只列出支援 generateContent 的模型並去掉 models/ 前綴', async () => {
    const { calls } = mockFetch(
      jsonResponse({
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] },
        ],
      })
    );
    expect(await provider().listModels()).toEqual(['gemini-3.8-flash']);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/v1beta/models?');
  });

  it('JSON 不符合 schema 時重試一次，仍失敗則報格式錯誤', async () => {
    const { fn } = mockFetch(ok({ title: 'x' }));
    await expect(provider().review(REQUEST)).rejects.toThrow('Gemini 輸出格式錯誤（已重試 1 次）');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('沒有候選內容（安全過濾）時直接報錯不重試', async () => {
    const { fn } = mockFetch(jsonResponse({ candidates: [] }));
    await expect(provider().review(REQUEST)).rejects.toThrow('安全過濾器');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'API key not valid. Please pass a valid API key.', 'API Key 無效'],
    [429, 'Resource has been exhausted (e.g. check quota).', '額度已達上限 (429'],
    [404, 'models/nope is not found for API version v1beta', '找不到模型「gemini-3.8-flash」'],
  ])('HTTP %i 轉成易懂錯誤', async (status, message, expected) => {
    mockFetch(jsonResponse({ error: { message } }, status));
    await expect(provider().review(REQUEST)).rejects.toThrow(expected);
  });

  it('網路／CORS 錯誤顯示 host 而不洩漏帶 key 的 URL', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const err = await provider().review(REQUEST).catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.message).toContain('generativelanguage.googleapis.com');
    expect(err.message).toContain('CORS');
    expect(err.message).not.toContain('test-key');
  });
});
