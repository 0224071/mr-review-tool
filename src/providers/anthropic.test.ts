import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider, SUBMIT_REVIEW_TOOL } from './anthropic';
import { setRetryDelayForTest } from './errors';
import { jsonResponse, mockFetch, REQUEST, VALID_RESULT } from './test-helpers';

const toolUse = (input: unknown, stop_reason = 'tool_use') =>
  jsonResponse({
    stop_reason,
    content: [
      { type: 'text', text: '好的' },
      { type: 'tool_use', id: 'toolu_1', name: SUBMIT_REVIEW_TOOL, input },
    ],
  });
const provider = () => createAnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5' });

beforeEach(() => setRetryDelayForTest(async () => {}));
afterEach(() => vi.unstubAllGlobals());

describe('Anthropic provider', () => {
  it('POST /v1/messages：x-api-key、anthropic-version、direct-browser-access header；強制 submit_review', async () => {
    const { calls } = mockFetch(toolUse(VALID_RESULT));
    const result = await provider().review(REQUEST);
    expect(result.title).toBe('新增分頁');
    const call = calls[0];
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(call.body.model).toBe('claude-opus-5-5');
    expect(call.body.system).toBe('SYS');
    expect(call.body.messages).toEqual([{ role: 'user', content: 'PROMPT' }]);
    expect(call.body.max_tokens).toBeGreaterThan(0);
    expect(call.body.tools[0].name).toBe(SUBMIT_REVIEW_TOOL);
    expect(call.body.tools[0].input_schema.type).toBe('object');
    expect(call.body.tool_choice).toEqual({ type: 'tool', name: SUBMIT_REVIEW_TOOL });
  });

  it('模型不支援強制 tool_choice（400）時改用 auto + strict tool 並記住', async () => {
    const { calls } = mockFetch(
      jsonResponse(
        { type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice: type "tool" and "any" are not supported for this model.' } },
        400
      ),
      toolUse(VALID_RESULT)
    );
    const p = provider();
    expect((await p.review(REQUEST)).title).toBe('新增分頁');
    expect(calls[1].body.tool_choice).toEqual({ type: 'auto' });
    expect(calls[1].body.tools[0].strict).toBe(true);
    expect(calls[1].body.tools[0].input_schema.additionalProperties).toBe(false);
    expect(calls[1].body.system).toContain(SUBMIT_REVIEW_TOOL);
    expect(p.toolMode).toBe('auto');
  });

  it('沒有呼叫工具時重試一次後報錯', async () => {
    const { fn } = mockFetch(jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] }));
    await expect(provider().review(REQUEST)).rejects.toThrow(`未呼叫 ${SUBMIT_REVIEW_TOOL}`);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('tool input 不符合 schema 時重試，第二次正確即成功', async () => {
    const { fn } = mockFetch(toolUse({ title: 'x' }), toolUse(VALID_RESULT));
    expect((await provider().review(REQUEST)).title).toBe('新增分頁');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('refusal 直接報錯不重試', async () => {
    const { fn } = mockFetch(jsonResponse({ stop_reason: 'refusal', content: [] }));
    await expect(provider().review(REQUEST)).rejects.toThrow('拒絕');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'authentication_error', 'invalid x-api-key', 'Anthropic API Key 無效或沒有權限 (401)'],
    [429, 'rate_limit_error', 'Number of request tokens has exceeded your rate limit', '額度已達上限 (429'],
    [404, 'not_found_error', 'model: claude-nope', '找不到模型「claude-opus-5-5」'],
    [529, 'overloaded_error', 'Overloaded', '服務暫時異常 (529)'],
  ])('HTTP %i 轉成易懂錯誤', async (status, type, message, expected) => {
    mockFetch(jsonResponse({ type: 'error', error: { type, message } }, status));
    await expect(provider().review(REQUEST)).rejects.toThrow(expected);
  });

  it('listModels 讀 /v1/models data[].id 並帶相同 header', async () => {
    const { calls } = mockFetch(jsonResponse({ data: [{ id: 'claude-opus-5-5', type: 'model' }], has_more: false }));
    expect(await provider().listModels()).toEqual(['claude-opus-5-5']);
    expect(calls[0].url).toContain('https://api.anthropic.com/v1/models');
    expect(calls[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });
});
