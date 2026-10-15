/**
 * Anthropic Messages API：瀏覽器直接呼叫（anthropic-dangerous-direct-browser-access）。
 * 以 tool use 強制呼叫 submit_review 取得結構化輸出；
 * 不支援強制 tool_choice 的模型（回 400）改用 tool_choice auto + strict tool 並在 prompt 要求呼叫。
 */
import { fetchJson, LlmError } from './errors';
import { generateValidated, REVIEW_SCHEMAS, toJsonSchema } from './structured';
import { LlmProvider, ProviderSettings, ReviewRequest } from './types';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';
export const SUBMIT_REVIEW_TOOL = 'submit_review';
const LABEL = 'Anthropic';
const MAX_TOKENS = 16000;

export type AnthropicToolMode = 'forced' | 'auto';

export function buildAnthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey.trim(),
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export function buildAnthropicBody(model: string, request: ReviewRequest, mode: AnthropicToolMode): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    name: SUBMIT_REVIEW_TOOL,
    description: '提交本次 MR 審查結果。所有結果都必須透過此工具提交，不要以文字回覆。',
    input_schema: toJsonSchema(REVIEW_SCHEMAS[request.kind], mode === 'auto'),
  };
  if (mode === 'auto') tool.strict = true;
  return {
    model,
    max_tokens: MAX_TOKENS,
    system:
      mode === 'auto'
        ? `${request.systemInstruction}\n\n完成分析後，必須呼叫 ${SUBMIT_REVIEW_TOOL} 工具提交結果，不要用文字回覆。`
        : request.systemInstruction,
    messages: [{ role: 'user', content: request.prompt }],
    tools: [tool],
    tool_choice: mode === 'forced' ? { type: 'tool', name: SUBMIT_REVIEW_TOOL } : { type: 'auto' },
  };
}

const isForcedToolUnsupported = (err: unknown) =>
  err instanceof LlmError && err.status === 400 && /tool_choice/i.test(err.message);

export function createAnthropicProvider(config: ProviderSettings): LlmProvider & { readonly toolMode: AnthropicToolMode } {
  const model = config.model.trim();
  const headers = buildAnthropicHeaders(config.apiKey);
  let mode: AnthropicToolMode = 'forced';

  const callOnce = async (request: ReviewRequest): Promise<unknown> => {
    const json = (await fetchJson(
      LABEL,
      `${ANTHROPIC_BASE_URL}/messages`,
      { method: 'POST', headers, body: JSON.stringify(buildAnthropicBody(model, request, mode)) },
      { model }
    )) as {
      stop_reason?: string;
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
    if (json.stop_reason === 'refusal') {
      throw new LlmError('empty', 'Anthropic 模型拒絕回答（stop_reason: refusal）。');
    }
    if (json.stop_reason === 'max_tokens') {
      throw new LlmError('invalid_output', 'Anthropic 回應超過 max_tokens 被截斷');
    }
    const toolUse = (json.content ?? []).find((b) => b.type === 'tool_use' && b.name === SUBMIT_REVIEW_TOOL);
    if (!toolUse) throw new LlmError('invalid_output', `Anthropic 未呼叫 ${SUBMIT_REVIEW_TOOL} 工具`);
    return toolUse.input;
  };

  return {
    id: 'anthropic',
    label: LABEL,
    model,
    get toolMode() {
      return mode;
    },

    async listModels() {
      const json = (await fetchJson(
        LABEL,
        `${ANTHROPIC_BASE_URL}/models?limit=1000`,
        { method: 'GET', headers },
        { retry: false }
      )) as { data?: Array<{ id?: string }> };
      return (json.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    },

    review(request) {
      return generateValidated(LABEL, request, async () => {
        try {
          return await callOnce(request);
        } catch (err: unknown) {
          if (mode === 'forced' && isForcedToolUnsupported(err)) {
            mode = 'auto';
            return callOnce(request);
          }
          throw err;
        }
      });
    },
  };
}
