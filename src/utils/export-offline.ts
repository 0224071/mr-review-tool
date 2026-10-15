import {
  ChecklistCoverageItem,
  MRAnalysisResult,
  MRGraphEdge,
  MRGraphNode,
  MRGroup,
  MRReviewItem,
} from '../types/review';

/** 只挑出指定欄位（undefined 不輸出），丟掉 schema 以外的一切 */
function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

const RESULT_KEYS = [
  'schemaVersion', 'title', 'description', 'summary', 'testSuggestions', 'groups', 'graph',
  'checklistCoverage', 'reviews', 'provider', 'model',
] as const satisfies readonly (keyof MRAnalysisResult)[];
const GROUP_KEYS = ['id', 'name', 'summary', 'files', 'additions', 'deletions'] as const satisfies readonly (keyof MRGroup)[];
const NODE_KEYS = ['id', 'label', 'groupId', 'kind'] as const satisfies readonly (keyof MRGraphNode)[];
const EDGE_KEYS = ['from', 'to', 'label'] as const satisfies readonly (keyof MRGraphEdge)[];
const COVERAGE_KEYS = ['id', 'hit', 'files'] as const satisfies readonly (keyof ChecklistCoverageItem)[];
const REVIEW_KEYS = [
  'groupId', 'category', 'severity', 'file', 'line', 'codeSnippet', 'comment', 'suggestion',
  'newLine', 'oldLine', 'lineVerified', 'aiLine', 'checklistId',
] as const satisfies readonly (keyof MRReviewItem)[];

export const REDACTED = '[已遮罩]';

/**
 * 有固定前綴的 token / key 格式：保留前綴（讓讀者知道是哪一種），其餘遮罩。
 * 前綴後的長度門檻夠長，避免把一般程式碼（例如 `sk-` 開頭的 CSS class）誤遮。
 */
const PREFIXED_SECRET_PATTERNS: readonly RegExp[] = [
  // GitLab：glpat- / gldt- / glrt- / glptt- / glcbt- / gloas- 等
  /\b(gl(?:pat|dt|rt|ptt|cbt|oas|imt|ft|soat|agent)-)[A-Za-z0-9_-]{16,}/g,
  // GitHub：ghp_ / gho_ / ghu_ / ghs_ / ghr_、fine-grained github_pat_
  /\b(gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}/g,
  // Google API key
  /\b(AIza)[A-Za-z0-9_-]{30,}/g,
  // OpenAI / Anthropic / OpenRouter：sk-、sk-proj-、sk-ant-、sk-or-v1-
  /\b(sk-)[A-Za-z0-9_-]{20,}/g,
  // Slack：xoxb- / xoxp- / xoxa- / xoxo- / xoxs- / xoxr-
  /\b(xox[abposr]-)[A-Za-z0-9-]{10,}/g,
  // AWS access key id
  /\b(AKIA|ASIA)[A-Z0-9-]{16,}/g,
  // Authorization: Bearer / Basic 後面的憑證
  /\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{16,}/g,
  // JWT（header.payload.signature）
  /\b(eyJ)[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/** `token=…`、`"api_key": "…"`、`PRIVATE-TOKEN: …` 這類鍵值；值要像機密（見 looksRandom）才遮 */
const KEY_VALUE_PATTERN =
  /\b((?:api[_-]?key|access[_-]?token|private[_-]?token|auth[_-]?token|secret|password|passwd|token|x-api-key)["']?\s*[:=]\s*["']?)([A-Za-z0-9._~+/=-]{12,})/gi;

/** 沒有前綴的長字串（例如 base64、隨機 key）：長度、字元種類與熵都夠高才算 */
const LONG_TOKEN_PATTERN = /[A-Za-z0-9_+/=-]{32,}/g;

function shannonEntropy(str: string): number {
  const counts = new Map<string, number>();
  for (const ch of str) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * 看起來像隨機產生的憑證：同時有大寫、小寫、至少 3 個數字，且熵夠高。
 * 識別字（camelCase、SNAKE_CASE）、檔案路徑、git SHA（只有小寫 hex）都不符合。
 */
function looksRandom(str: string, minEntropy: number): boolean {
  if (!/[A-Z]/.test(str) || !/[a-z]/.test(str)) return false;
  if ((str.match(/[0-9]/g) ?? []).length < 3) return false;
  return shannonEntropy(str) >= minEntropy;
}

/** 把文字中看起來像 token / API key 的字串遮罩（模型可能把 diff 裡的 token 原文寫進意見） */
export function redactSecrets(text: string): string {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const pattern of PREFIXED_SECRET_PATTERNS) {
    out = out.replace(pattern, (_m, prefix: string) => `${prefix}${REDACTED}`);
  }
  out = out.replace(KEY_VALUE_PATTERN, (m, key: string, value: string) =>
    looksRandom(value, 3.5) ? `${key}${REDACTED}` : m
  );
  out = out.replace(LONG_TOKEN_PATTERN, (m) => (looksRandom(m, 4) ? REDACTED : m));
  return out;
}

const redactAll = (list: string[] | undefined) => list?.map(redactSecrets);

/**
 * 匯出用的結果：只保留 MRAnalysisResult schema 欄位（白名單，逐層）。
 * 模型回傳、MR 留言的共享分析與歷史紀錄都不會剝掉 schema 以外的欄位，
 * 若其中夾帶 key / token（或呼叫端誤把設定、整筆紀錄傳進來），不能原樣寫進可分享的 HTML。
 * 白名單內的自由文字欄位（意見、建議、程式碼片段、摘要等）再遮罩看起來像 token / key 的字串。
 */
export function toExportableResult(result: MRAnalysisResult): MRAnalysisResult {
  const picked = pick(result, RESULT_KEYS);
  return {
    ...picked,
    title: redactSecrets(picked.title),
    description: redactSecrets(picked.description),
    summary: redactAll(picked.summary)!,
    testSuggestions: redactAll(picked.testSuggestions)!,
    groups: (result.groups ?? []).map((g) => {
      const group = pick(g, GROUP_KEYS);
      return { ...group, name: redactSecrets(group.name), summary: redactSecrets(group.summary) };
    }),
    graph: {
      nodes: (result.graph?.nodes ?? []).map((n) => {
        const node = pick(n, NODE_KEYS);
        return { ...node, label: redactSecrets(node.label) };
      }),
      edges: (result.graph?.edges ?? []).map((e) => {
        const edge = pick(e, EDGE_KEYS);
        return edge.label ? { ...edge, label: redactSecrets(edge.label) } : edge;
      }),
    },
    ...(result.checklistCoverage ? { checklistCoverage: result.checklistCoverage.map((c) => pick(c, COVERAGE_KEYS)) } : {}),
    reviews: (result.reviews ?? []).map((r) => {
      const review = pick(r, REVIEW_KEYS);
      return {
        ...review,
        codeSnippet: redactSecrets(review.codeSnippet),
        comment: redactSecrets(review.comment),
        suggestion: redactSecrets(review.suggestion),
      };
    }),
  };
}

/**
 * Exports a self-contained offline HTML report with embedded styles and data.
 * Zero external CDN or network dependencies, safely shareable with colleagues.
 * 只輸出 schema 欄位（見 toExportableResult），不含任何 key / token。
 */
export function generateOfflineHtmlReport(input: MRAnalysisResult): string {
  const result = toExportableResult(input);
  const jsonStr = JSON.stringify(result, null, 2);

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MR 審查報告: ${escapeHtml(result.title)}</title>
  <style>
    :root {
      --primary: #4f46e5;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    .header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 4px;
      background: #eef2ff;
      color: #4338ca;
      margin-bottom: 8px;
    }
    h1 { font-size: 20px; margin-bottom: 8px; }
    .meta { font-size: 12px; color: var(--text-muted); }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    h2 { font-size: 15px; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    ul { padding-left: 20px; font-size: 13px; }
    li { margin-bottom: 6px; }
    .group-item {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
      background: #fdfdfd;
    }
    .group-title { font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; }
    .stat-add { color: #16a34a; font-family: monospace; }
    .stat-del { color: #dc2626; font-family: monospace; }
    .review-item {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .review-high { border-left: 4px solid #ef4444; }
    .review-medium { border-left: 4px solid #f59e0b; }
    .review-low { border-left: 4px solid #10b981; }
    .review-comment { font-weight: 600; font-size: 13px; margin: 6px 0; }
    .review-sugg {
      background: #f1f5f9;
      border-radius: 6px;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      margin-top: 6px;
    }
    .tag { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; }
    pre { background: #0f172a; color: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge">GitLab MR 本機離線審查報告</span>
      <h1>${escapeHtml(result.title)}</h1>
      <div class="meta">產出時間：${new Date().toLocaleString()} · 完全自包含離線報告</div>
    </div>

    <div class="card">
      <h2>整體變更摘要</h2>
      <ul>
        ${result.summary.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <h2>意圖分組 (${result.groups.length} 組)</h2>
      ${result.groups
        .map(
          (g) => `
        <div class="group-item">
          <div class="group-title">
            <span>${escapeHtml(g.name)}</span>
            <span>
              <span class="stat-add">+${g.additions}</span>
              <span class="stat-del">-${g.deletions}</span>
            </span>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(g.summary)}</div>
          <div style="font-size: 11px; font-family: monospace; color: #475569; margin-top: 6px;">
            檔案：${g.files.map((f) => escapeHtml(f)).join(', ')}
          </div>
        </div>
      `
        )
        .join('')}
    </div>

    <div class="card">
      <h2>程式碼審查意見 (${result.reviews.length} 則)</h2>
      ${result.reviews
        .map(
          (r) => `
        <div class="review-item review-${escapeHtml(r.severity)}">
          <div style="display: flex; gap: 8px; font-size: 11px;">
            <span class="tag">嚴重程度: ${escapeHtml(String(r.severity ?? '').toUpperCase())}</span>
            <span class="tag">分類: ${escapeHtml(r.category)}</span>
            <span class="tag" style="font-family: monospace;">${escapeHtml(r.file)}${
            r.line ? `:L${r.line}` : ''
          }</span>
          ${
            r.lineVerified === false
              ? '<span class="tag" style="color: #b45309; background: #fef3c7; border: 1px solid #fde68a;">⚠️ 行號未驗證</span>'
              : ''
          }
          </div>
          <div class="review-comment">${escapeHtml(r.comment)}</div>
          <div class="review-sugg">💡 建議修改：\n${escapeHtml(r.suggestion)}</div>
        </div>
      `
        )
        .join('')}
    </div>

    <div class="card">
      <h2>建議測試清單</h2>
      <ul>
        ${result.testSuggestions.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <h2>完整分析 JSON (可用於重新導入)</h2>
      <pre><code>${escapeHtml(jsonStr)}</code></pre>
    </div>
  </div>
</body>
</html>`;
}

/** 結果可能來自被竄改的分享留言或舊紀錄，欄位不一定是字串（null、數字等），一律轉成字串再跳脫 */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
