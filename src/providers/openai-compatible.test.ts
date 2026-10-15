import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRetryDelayForTest } from './errors';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import { jsonResponse, mockFetch, REQUEST, VALID_RESULT } from './test-helpers';

const chatOk = (content: string, finish_reason = 'stop') =>
  jsonResponse({ choices: [{ finish_reason, message: { role: 'assistant', content } }] });
const unsupported = () => jsonResponse({ error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported." } }, 400);

beforeEach(() => setRetryDelayForTest(async () => {}));
afterEach(() => vi.unstubAllGlobals());

describe('OpenAI provider', () => {
  const openai = () => createOpenAiCompatibleProvider('openai', { apiKey: 'sk-test', model: 'gpt-4.1-mini' });

  it('POST /v1/chat/completions，Bearer header，response_format json_schema strict', async () => {
    const { calls } = mockFetch(chatOk(JSON.stringify(VALID_RESULT)));
    const result = await openai().review(REQUEST);
    expect(result.title).toBe('新增分頁');
    const call = calls[0];
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' });
    expect(call.body.model).toBe('gpt-4.1-mini');
    expect(call.body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'PROMPT' },
    ]);
    expect(call.body.temperature).toBeUndefined();
    expect(call.body.response_format.type).toBe('json_schema');
    expect(call.body.response_format.json_schema.strict).toBe(true);
    expect(call.body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it('OpenAI 不降級：response_format 400 直接報錯', async () => {
    const { fn } = mockFetch(unsupported());
    await expect(openai().review(REQUEST)).rejects.toThrow('OpenAI API 回傳錯誤 (400)');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('listModels 讀 /models data[].id', async () => {
    const { calls } = mockFetch(jsonResponse({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] }));
    expect(await openai().listModels()).toEqual(['gpt-a', 'gpt-b']);
    expect(calls[0].url).toBe('https://api.openai.com/v1/models');
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test');
  });

  it.each([
    [401, 'Incorrect API key provided', 'API Key 無效或沒有權限 (401)'],
    [429, 'You exceeded your current quota', '額度已達上限 (429'],
    [404, 'The model `gpt-x` does not exist', '找不到模型「gpt-4.1-mini」'],
    [500, 'server error', '服務暫時異常 (500)'],
  ])('HTTP %i 轉成易懂錯誤', async (status, message, expected) => {
    mockFetch(jsonResponse({ error: { message } }, status));
    await expect(openai().review(REQUEST)).rejects.toThrow(expected);
  });

  it('回應被截斷（finish_reason length）視為格式錯誤並重試一次', async () => {
    const { fn } = mockFetch(chatOk('{"title":', 'length'), chatOk(JSON.stringify(VALID_RESULT)));
    expect((await openai().review(REQUEST)).title).toBe('新增分頁');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('OpenRouter provider', () => {
  it('帶選填 HTTP-Referer 與 X-Title；非 ASCII 的 title 不送出', async () => {
    const { calls } = mockFetch(chatOk(JSON.stringify(VALID_RESULT)));
    await createOpenAiCompatibleProvider('openrouter', {
      apiKey: 'sk-or',
      model: 'openai/gpt-4.1-mini',
      referer: 'https://example.com',
      title: 'MR Tool',
    }).review(REQUEST);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers).toMatchObject({
      Authorization: 'Bearer sk-or',
      'HTTP-Referer': 'https://example.com',
      'X-Title': 'MR Tool',
    });

    const second = mockFetch(chatOk(JSON.stringify(VALID_RESULT)));
    await createOpenAiCompatibleProvider('openrouter', { apiKey: 'k', model: 'm', title: '審查工具' }).review(REQUEST);
    expect(second.calls[0].headers['X-Title']).toBeUndefined();
    expect(second.calls[0].headers['HTTP-Referer']).toBeUndefined();
  });

  it('json_schema → json_object → 純 prompt 依序降級，並記住可用模式', async () => {
    const { calls } = mockFetch(unsupported(), unsupported(), chatOk('```json\n' + JSON.stringify(VALID_RESULT) + '\n```'));
    const provider = createOpenAiCompatibleProvider('openrouter', { apiKey: 'k', model: 'm' });
    expect((await provider.review(REQUEST)).title).toBe('新增分頁');
    expect(calls.map((c) => c.body.response_format?.type)).toEqual(['json_schema', 'json_object', undefined]);
    expect(calls[1].body.messages[0].content).toContain('JSON Schema');
    expect(calls[2].body.messages[0].content).toContain('只輸出一個 JSON 物件');
    expect(provider.responseMode).toBe('prompt');

    await provider.review(REQUEST);
    expect(calls[3].body.response_format).toBeUndefined();
  });

  it('401 不觸發降級', async () => {
    const { fn } = mockFetch(jsonResponse({ error: { message: 'No auth credentials found' } }, 401));
    await expect(createOpenAiCompatibleProvider('openrouter', { apiKey: 'k', model: 'm' }).review(REQUEST)).rejects.toThrow(
      'OpenRouter API Key 無效'
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('Ollama／自訂 OpenAI 相容 provider', () => {
  it('使用自訂 base URL（去尾斜線），沒有 key 時不送 Authorization', async () => {
    const { calls } = mockFetch(chatOk(JSON.stringify(VALID_RESULT)));
    await createOpenAiCompatibleProvider('custom', {
      apiKey: '',
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434/v1/',
    }).review(REQUEST);
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body.temperature).toBe(0.2);
  });

  it('連不上時提示 OLLAMA_ORIGINS', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const err = await createOpenAiCompatibleProvider('custom', { apiKey: '', model: 'm', baseUrl: 'http://localhost:11434/v1' })
      .listModels()
      .catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.message).toContain('localhost:11434');
    expect(err.message).toContain('OLLAMA_ORIGINS');
  });

  it('listModels 也接受 Ollama 風格 { models: [{ name }] }', async () => {
    mockFetch(jsonResponse({ models: [{ name: 'qwen2.5-coder' }] }));
    expect(await createOpenAiCompatibleProvider('custom', { apiKey: '', model: 'm', baseUrl: 'http://x/v1' }).listModels()).toEqual([
      'qwen2.5-coder',
    ]);
  });
});
