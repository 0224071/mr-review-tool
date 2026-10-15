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
import {
  ConnectionTestResult,
  LlmProvider,
  ModelInfo,
  OpenRouterKeyInfo,
  ProviderSettings,
  ReviewKind,
  ReviewRequest,
} from './types';

export type OpenAiCompatibleFlavor = 'openai' | 'openrouter' | 'custom';
export type ResponseFormatMode = 'json_schema' | 'json_object' | 'prompt';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
/** 額度不足時建議的 OpenRouter 免費模型（playground MR !1 實測可完成分析） */
export const OPENROUTER_SUGGESTED_FREE_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

export const OPENROUTER_PAYMENT_HINT = `可改用免費模型（id 以 :free 結尾，例如 ${OPENROUTER_SUGGESTED_FREE_MODEL}）：到設定按「測試連線」後勾選「只看免費」挑選，或到 OpenRouter 儲值。`;

/** 分析時遇到 402 額度不足、且目前不是免費模型時，建議改用免費模型 */
export function shouldSuggestFreeModel(err: unknown, providerId: string, model: string): boolean {
  return providerId === 'openrouter' && err instanceof LlmError && err.status === 402 && !model.trim().endsWith(':free');
}

/** OpenRouter 免費模型：id 以 :free 結尾，或輸入／輸出單價皆為 0 */
export function isOpenRouterFreeModel(m: { id?: string; pricing?: { prompt?: string; completion?: string } }): boolean {
  if (m.id?.endsWith(':free')) return true;
  return m.pricing?.prompt === '0' && m.pricing?.completion === '0';
}

export function parseOpenRouterKeyInfo(json: unknown): OpenRouterKeyInfo {
  const d = ((json as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    label: typeof d.label === 'string' ? d.label : undefined,
    limit: num(d.limit),
    usage: num(d.usage) ?? 0,
    limitRemaining: num(d.limit_remaining),
    isFreeTier: d.is_free_tier === true,
  };
}

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

  const paymentHint = flavor === 'openrouter' ? OPENROUTER_PAYMENT_HINT : undefined;
  const chain = FALLBACK_CHAIN[flavor];
  let modeIndex = 0;

  const fetchModels = async (): Promise<ModelInfo[]> => {
    const json = (await fetchJson(
      label,
      `${baseUrl}/models`,
      { method: 'GET', headers },
      { retry: false, networkHint }
    )) as {
      data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const list: Array<{ id?: string; name?: string; pricing?: { prompt?: string; completion?: string } }> =
      json.data ?? json.models ?? [];
    return list
      .map((m) => {
        const id = m.id ?? m.name ?? '';
        return flavor === 'openrouter' ? { id, free: isOpenRouterFreeModel({ ...m, id }) } : { id };
      })
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  };

  const callOnce = async (request: ReviewRequest, mode: ResponseFormatMode): Promise<unknown> => {
    const json = (await fetchJson(
      label,
      `${baseUrl}/chat/completions`,
      { method: 'POST', headers, body: JSON.stringify(buildChatBody(flavor, model, request, mode)) },
      { model, networkHint, paymentHint }
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
      return (await fetchModels()).map((m) => m.id);
    },

    async testConnection(): Promise<ConnectionTestResult> {
      if (flavor === 'openrouter') {
        // OpenRouter 的 /models 是公開的，假 key 也回 200；/key 需要有效的 Bearer key，順便取得額度
        const keyInfo = parseOpenRouterKeyInfo(
          await fetchJson(label, `${baseUrl}/key`, { method: 'GET', headers }, { retry: false })
        );
        return { models: await fetchModels(), keyVerified: true, keyInfo };
      }
      // OpenAI 的 /models 需要驗證；自訂服務（Ollama 等）多半不檢查 key，只能 best-effort
      return { models: await fetchModels(), keyVerified: flavor === 'openai' };
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

/** 把 OpenRouter /key 額度資訊轉成設定頁提示；warn=true 表示付費模型很可能回 402 */
export function describeOpenRouterCredit(info: OpenRouterKeyInfo): { warn: boolean; message: string } {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  if (info.limitRemaining != null && info.limitRemaining <= 0) {
    return {
      warn: true,
      message: `此 key 額度已用完（已用 ${usd(info.usage)}／上限 ${usd(info.limit ?? 0)}），付費模型會回 402 額度不足；請改用標示「免費」的模型，或到 OpenRouter 調高 key 上限／儲值。`,
    };
  }
  if (info.isFreeTier) {
    return {
      warn: true,
      message: '此帳戶尚未儲值（free tier），付費模型會回 402 額度不足；建議勾選「只看免費」改用 :free 模型（有每日請求次數上限）。',
    };
  }
  if (info.limitRemaining != null) {
    return {
      warn: info.limitRemaining < 0.5,
      message: `此 key 剩餘額度 ${usd(info.limitRemaining)}（上限 ${usd(info.limit ?? 0)}，已用 ${usd(info.usage)}）。`,
    };
  }
  return { warn: false, message: `此 key 未設額度上限（已用 ${usd(info.usage)}），實際可用額度依帳戶餘額而定。` };
}
