/**
 * Google Gemini：瀏覽器直接呼叫 generateContent，使用既有 responseSchema。
 */
import { fetchJson, LlmError } from './errors';
import { generateValidated, parseJsonText, REVIEW_SCHEMAS } from './structured';
import { LlmProvider, ProviderSettings } from './types';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const LABEL = 'Gemini';

export function createGeminiProvider(config: ProviderSettings): LlmProvider {
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();

  return {
    id: 'gemini',
    label: LABEL,
    model,

    async listModels() {
      const json = (await fetchJson(
        LABEL,
        `${GEMINI_BASE_URL}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
        { method: 'GET' },
        { retry: false }
      )) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
      return (json.models ?? [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    },

    review(request) {
      const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;
      const payload = {
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [{ parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: REVIEW_SCHEMAS[request.kind],
          temperature: 0.2,
        },
      };
      return generateValidated(LABEL, request, async () => {
        const json = (await fetchJson(
          LABEL,
          url,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
          { model }
        )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new LlmError('empty', 'Gemini API 未回傳有效的分析內容，可能被安全過濾器攔截。');
        }
        return parseJsonText(LABEL, text);
      });
    },
  };
}
