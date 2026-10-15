/**
 * 結構化輸出共用工具：
 * - 以 Gemini responseSchema（core/gemini-schema.ts）為唯一來源，轉成標準 JSON Schema 給其他 provider
 * - 所有 provider 的輸出都經過同一個 validator；解析或驗證失敗時重試一次後再報錯
 */
import { MR_ANALYSIS_RESPONSE_SCHEMA, RECHECK_RESPONSE_SCHEMA } from '../core/gemini-schema';
import { LlmError } from './errors';
import { ReviewKind, ReviewOutputMap, ReviewRequest } from './types';

export interface GeminiSchemaNode {
  type: string;
  description?: string;
  enum?: string[];
  nullable?: boolean;
  items?: GeminiSchemaNode;
  properties?: Record<string, GeminiSchemaNode>;
  required?: string[];
}

export const REVIEW_SCHEMAS: Record<ReviewKind, GeminiSchemaNode> = {
  analysis: MR_ANALYSIS_RESPONSE_SCHEMA as GeminiSchemaNode,
  recheck: RECHECK_RESPONSE_SCHEMA as GeminiSchemaNode,
};

/** 給 tool use / json_schema 用的名稱 */
export const REVIEW_SCHEMA_NAMES: Record<ReviewKind, string> = {
  analysis: 'mr_analysis',
  recheck: 'checklist_recheck',
};

export type JsonSchema = Record<string, unknown>;

/**
 * Gemini schema → JSON Schema。
 * strict=true 時符合 OpenAI strict / Anthropic strict tool 規則：
 * 每個 object 都 additionalProperties:false，且所有欄位列入 required（原本選填的改成可為 null）。
 */
export function toJsonSchema(node: GeminiSchemaNode, strict = false): JsonSchema {
  const convert = (n: GeminiSchemaNode, forceNullable: boolean): JsonSchema => {
    const baseType = n.type.toLowerCase();
    const nullable = Boolean(n.nullable) || forceNullable;
    const out: JsonSchema = { type: nullable ? [baseType, 'null'] : baseType };
    if (n.description) out.description = n.description;
    if (n.enum) out.enum = nullable ? [...n.enum, null] : [...n.enum];
    if (baseType === 'array' && n.items) out.items = convert(n.items, false);
    if (baseType === 'object' && n.properties) {
      const required = new Set(n.required ?? []);
      const props: Record<string, JsonSchema> = {};
      for (const [key, child] of Object.entries(n.properties)) {
        props[key] = convert(child, strict && !required.has(key));
      }
      out.properties = props;
      out.required = strict ? Object.keys(n.properties) : [...required];
      if (strict) out.additionalProperties = false;
    }
    return out;
  };
  return convert(node, false);
}

/**
 * 依 Gemini schema 驗證值，回傳錯誤清單（空陣列表示通過）。
 * 多出來的欄位不視為錯誤；選填欄位缺少或為 null 可接受。
 */
export function validateAgainstSchema(value: unknown, schema: GeminiSchemaNode, path = '$'): string[] {
  const errors: string[] = [];
  const walk = (v: unknown, s: GeminiSchemaNode, p: string) => {
    if (v === null || v === undefined) {
      if (!s.nullable) errors.push(`${p} 不可為 null`);
      return;
    }
    switch (s.type.toUpperCase()) {
      case 'OBJECT': {
        if (typeof v !== 'object' || Array.isArray(v)) {
          errors.push(`${p} 應為物件`);
          return;
        }
        const obj = v as Record<string, unknown>;
        for (const key of s.required ?? []) {
          if (!(key in obj) || obj[key] === undefined) errors.push(`${p}.${key} 缺少必要欄位`);
        }
        for (const [key, child] of Object.entries(s.properties ?? {})) {
          if (obj[key] === undefined) continue;
          if (obj[key] === null && !(s.required ?? []).includes(key)) continue;
          walk(obj[key], child, `${p}.${key}`);
        }
        return;
      }
      case 'ARRAY':
        if (!Array.isArray(v)) {
          errors.push(`${p} 應為陣列`);
          return;
        }
        if (s.items) v.forEach((item, i) => walk(item, s.items!, `${p}[${i}]`));
        return;
      case 'STRING':
        if (typeof v !== 'string') errors.push(`${p} 應為字串`);
        else if (s.enum && !s.enum.includes(v)) errors.push(`${p} 值「${v}」不在允許清單 ${s.enum.join('/')}`);
        return;
      case 'INTEGER':
        if (typeof v !== 'number' || !Number.isInteger(v)) errors.push(`${p} 應為整數`);
        return;
      case 'NUMBER':
        if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`${p} 應為數字`);
        return;
      case 'BOOLEAN':
        if (typeof v !== 'boolean') errors.push(`${p} 應為布林值`);
        return;
      default:
        return;
    }
  };
  walk(value, schema, path);
  return errors;
}

/**
 * 從模型文字輸出取出 JSON：容許 ```json 圍欄或前後多餘文字。
 * 解析失敗丟 invalid_output（會觸發重試）。
 */
export function parseJsonText(label: string, text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  let lastErr = '';
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new LlmError('invalid_output', `解析 ${label} 回傳 JSON 失敗：${lastErr || '回應為空'}`);
}

/** 純 prompt / json_object 模式時附加在 system prompt 的格式要求 */
export function buildJsonInstruction(kind: ReviewKind): string {
  return [
    '',
    '## 輸出格式（必須遵守）',
    '只輸出一個 JSON 物件，不要 Markdown 圍欄、不要任何說明文字。JSON 必須符合以下 JSON Schema：',
    JSON.stringify(toJsonSchema(REVIEW_SCHEMAS[kind])),
  ].join('\n');
}

const MAX_ATTEMPTS = 2;

/**
 * 呼叫 provider 的原始產生函式並驗證輸出；解析或 schema 驗證失敗重試一次後再報錯。
 * 網路、金鑰、額度等錯誤不重試（直接往上拋）。
 */
export async function generateValidated<K extends ReviewKind>(
  label: string,
  request: ReviewRequest<K>,
  generate: () => Promise<unknown>
): Promise<ReviewOutputMap[K]> {
  const schema = REVIEW_SCHEMAS[request.kind];
  let lastProblem = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let value: unknown;
    try {
      value = await generate();
    } catch (err: unknown) {
      if (err instanceof LlmError && err.kind === 'invalid_output') {
        lastProblem = err.message;
        continue;
      }
      throw err;
    }
    const errors = validateAgainstSchema(value, schema);
    if (errors.length === 0) return value as ReviewOutputMap[K];
    lastProblem = `回傳內容不符合 schema：${errors.slice(0, 5).join('；')}${
      errors.length > 5 ? ` 等 ${errors.length} 項` : ''
    }`;
  }
  throw new LlmError('invalid_output', `${label} 輸出格式錯誤（已重試 1 次）：${lastProblem}`);
}
