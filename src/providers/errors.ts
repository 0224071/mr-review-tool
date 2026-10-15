/**
 * 各 provider 共用的 HTTP 呼叫與錯誤分類，讓 UI 顯示看得懂的原因而不只是「失敗」。
 */

export type LlmErrorKind =
  | 'network'
  | 'auth'
  | 'quota'
  | 'server'
  | 'model_not_found'
  | 'bad_request'
  | 'invalid_output'
  | 'empty';

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 529]);
const RETRY_DELAYS_MS = [2000, 5000];
let retryDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 測試用：替換重試等待（避免測試真的等待） */
export function setRetryDelayForTest(fn: (ms: number) => Promise<void>): void {
  retryDelay = fn;
}

/** 從各家錯誤 body 取出訊息：{error:{message}}、{error:"..."}、{message} 或純文字 */
export function extractErrorMessage(bodyText: string): string {
  try {
    const json = JSON.parse(bodyText);
    const err = json?.error;
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
    if (typeof json?.message === 'string') return json.message;
  } catch {
    // 非 JSON
  }
  return bodyText.slice(0, 300);
}

const MODEL_NOT_FOUND_PATTERN =
  /(model[^.]*?(not found|does not exist|not exist|is not supported|not available|unknown))|((unknown|invalid|no such) model)|(no endpoints found)/i;

export function describeHttpError(
  label: string,
  status: number,
  bodyText: string,
  model?: string,
  paymentHint?: string
): LlmError {
  const detail = extractErrorMessage(bodyText);
  if (status === 402) {
    return new LlmError(
      'quota',
      `${label} 額度不足 (402)：帳戶餘額或此 key 的額度上限不足以呼叫${model ? `「${model}」` : '此模型'}。${
        paymentHint ?? '請儲值或調整 key 的額度上限。'
      }${detail ? `（${detail}）` : ''}`,
      status
    );
  }
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(detail))) {
    return new LlmError(
      'auth',
      `${label} API Key 無效或沒有權限 (${status})：請到設定檢查金鑰是否正確、是否已啟用。${detail ? `（${detail}）` : ''}`,
      status
    );
  }
  if (status === 429) {
    return new LlmError(
      'quota',
      `${label} 請求次數或額度已達上限 (429, Rate limit)：請稍候再試，或檢查帳戶方案／今日額度。${detail ? `（${detail}）` : ''}`,
      status
    );
  }
  if (status === 404 || MODEL_NOT_FOUND_PATTERN.test(detail)) {
    return new LlmError(
      'model_not_found',
      `${label} 找不到模型${model ? `「${model}」` : ''} (${status})：請到設定改選可用的模型。${detail ? `（${detail}）` : ''}`,
      status
    );
  }
  if (status >= 500) {
    return new LlmError(
      'server',
      `${label} 服務暫時異常 (${status})：已自動重試仍失敗，請稍後再試。${detail ? `（${detail}）` : ''}`,
      status
    );
  }
  return new LlmError('bad_request', `${label} API 回傳錯誤 (${status})：${detail}`, status);
}

export function describeNetworkError(label: string, url: string, err: unknown, hint?: string): LlmError {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // 網址無法解析時直接用原字串顯示在錯誤訊息裡
  }
  const raw = err instanceof Error ? err.message : String(err);
  return new LlmError(
    'network',
    `無法連線至 ${label}（${host}）：可能被瀏覽器 CORS 政策擋下、網路中斷或服務未啟動。${hint ? hint : ''}（${raw}）`
  );
}

/**
 * fetch 並處理暫時性錯誤重試；回傳 ok 的 Response，否則丟出分類過的 LlmError。
 * URL 可能含金鑰（Gemini），錯誤訊息只顯示 host。
 */
export async function fetchJson(
  label: string,
  url: string,
  init: RequestInit,
  options: { model?: string; networkHint?: string; paymentHint?: string; retry?: boolean } = {}
): Promise<unknown> {
  const { model, networkHint, paymentHint, retry = true } = options;
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(url, init);
    } catch (err: unknown) {
      throw describeNetworkError(label, url, err, networkHint);
    }
    // 模型暫時過載（503 high demand）等暫時性錯誤：稍候重試，避免整次分析失敗
    if (!retry || !RETRYABLE_STATUS.has(response.status) || attempt >= RETRY_DELAYS_MS.length) break;
    await retryDelay(RETRY_DELAYS_MS[attempt]);
  }
  if (!response.ok) {
    throw describeHttpError(label, response.status, await response.text().catch(() => ''), model, paymentHint);
  }
  try {
    return await response.json();
  } catch (err: unknown) {
    throw new LlmError(
      'invalid_output',
      `${label} 回應不是有效的 JSON：${err instanceof Error ? err.message : String(err)}`
    );
  }
}
