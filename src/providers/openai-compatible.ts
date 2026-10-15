/**
 * OpenAI 相容 Chat Completions：OpenAI、OpenRouter、Ollama／自訂 base URL 共用，只差預設 base URL 與 header。
 *
 * 結構化輸出：
 * - OpenAI：response_format json_schema（strict）
 * - OpenRouter／自訂：json_schema → json_object → 純 prompt JSON 依序降級（記住可用模式，後續批次直接沿用）
 */
import { getLlmMixedContentWarning } from '../core/mixed-content';
import { fetchJson, LlmError } from './errors';
import {
  buildJsonInstruction,
  generateValidated,
  parseJsonText,
  REVIEW_SCHEMA_NAMES,
  REVIEW_SCHEMAS,
  toJsonSchema,
} from './structured';
import { LlmProvider, ProviderSettings, ReviewKind, ReviewRequest } from './types';

export type OpenAiCompatibleFlavor = 'openai' | 'openrouter' | 'custom';
export type ResponseFormatMode = 'json_schema' | 'json_object' | 'prompt';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

const FLAVOR_LABEL: Record<OpenAiCompatibleFlavor, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  custom: 'OpenAI 相容服務',
};

const DEFAULT_BASE_URL: Record<OpenAiCompatibleFlavor, string> = {
  openai: OPENAI_BASE_URL,
  openrouter: OPENROUTER_BASE_URL,
  custom: OLLAMA_DEFAULT_BASE_URL,
};

/** header 值只能是可見 ASCII，否則 fetch 會直接丟錯 */
const isHeaderSafe = (v: string) => /^[\x20-\x7e]+$/.test(v);

export function buildOpenAiHeaders(
  flavor: OpenAiCompatibleFlavor,
  config: ProviderSettings
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = config.apiKey.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  if (flavor === 'openrouter') {
    const referer = (config.referer ?? '').trim();
    const title = (config.title ?? '').trim();
    if (referer && isHeaderSafe(referer)) headers['HTTP-Referer'] = referer;
    if (title && isHeaderSafe(title)) headers['X-Title'] = title;
  }
  return headers;
}

export function buildResponseFormat(kind: ReviewKind, mode: ResponseFormatMode): unknown {
  if (mode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: { name: REVIEW_SCHEMA_NAMES[kind], strict: true, schema: toJsonSchema(REVIEW_SCHEMAS[kind], true) },
    };
  }
  if (mode === 'json_object') return { type: 'json_object' };
  return undefined;
}

export function buildChatBody(
  flavor: OpenAiCompatibleFlavor,
  model: string,
  request: ReviewRequest,
  mode: ResponseFormatMode
): Record<string, unknown> {
  const system =
    mode === 'json_schema' ? request.systemInstruction : request.systemInstruction + buildJsonInstruction(request.kind);
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: request.prompt },
    ],
  };
  // OpenAI 新推理模型只接受預設 temperature，因此只對其他相容服務指定
  if (flavor !== 'openai') body.temperature = 0.2;
  const responseFormat = buildResponseFormat(request.kind, mode);
  if (responseFormat) body.response_format = responseFormat;
  return body;
}

const FALLBACK_CHAIN: Record<OpenAiCompatibleFlavor, ResponseFormatMode[]> = {
  openai: ['json_schema'],
  openrouter: ['json_schema', 'json_object', 'prompt'],
  custom: ['json_schema', 'json_object', 'prompt'],
};

export function createOpenAiCompatibleProvider(
  flavor: OpenAiCompatibleFlavor,
  config: ProviderSettings
): LlmProvider & { readonly responseMode: ResponseFormatMode } {
  const label = FLAVOR_LABEL[flavor];
  const model = config.model.trim();
  const baseUrl = (flavor === 'custom' ? (config.baseUrl ?? '').trim() || DEFAULT_BASE_URL.custom : DEFAULT_BASE_URL[flavor])
    .replace(/\/+$/, '');
  const headers = buildOpenAiHeaders(flavor, config);
  const networkHint =
    flavor === 'custom'
      ? [
          getLlmMixedContentWarning(baseUrl),
          '若使用 Ollama，請以 OLLAMA_ORIGINS 允許此網頁來源（例如 OLLAMA_ORIGINS="*" ollama serve）並確認服務已啟動。',
        ]
          .filter(Boolean)
          .join(' ')
      : undefined;

  const chain = FALLBACK_CHAIN[flavor];
  let modeIndex = 0;

  const callOnce = async (request: ReviewRequest, mode: ResponseFormatMode): Promise<unknown> => {
    const json = (await fetchJson(
      label,
      `${baseUrl}/chat/completions`,
      { method: 'POST', headers, body: JSON.stringify(buildChatBody(flavor, model, request, mode)) },
      { model, networkHint }
    )) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
    };
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) {
      throw new LlmError('empty', `${label} 模型拒絕回答：${choice.message.refusal}`);
    }
    const content = choice?.message?.content;
    if (!content) throw new LlmError('invalid_output', `${label} 未回傳內容`);
    if (choice?.finish_reason === 'length') {
      throw new LlmError('invalid_output', `${label} 回應超過長度上限被截斷`);
    }
    return parseJsonText(label, content);
  };

  return {
    id: flavor,
    label,
    model,
    get responseMode() {
      return chain[modeIndex];
    },

    async listModels() {
      const json = (await fetchJson(
        label,
        `${baseUrl}/models`,
        { method: 'GET', headers },
        { retry: false, networkHint }
      )) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> };
      const list = json.data ?? json.models ?? [];
      return list.map((m) => m.id ?? (m as { name?: string }).name ?? '').filter(Boolean).sort();
    },

    review(request) {
      return generateValidated(label, request, async () => {
        for (;;) {
          try {
            return await callOnce(request, chain[modeIndex]);
          } catch (err: unknown) {
            // 400/422：多半是不支援此 response_format，降級到下一種模式再試
            const unsupported =
              err instanceof LlmError && (err.status === 400 || err.status === 422) && err.kind !== 'auth';
            if (unsupported && modeIndex < chain.length - 1) {
              modeIndex++;
              continue;
            }
            throw err;
          }
        }
      });
    },
  };
}
