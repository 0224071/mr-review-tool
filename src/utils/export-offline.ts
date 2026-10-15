import { MRAnalysisResult } from '../types/review';

/**
 * Exports a self-contained offline HTML report with embedded styles and data.
 * Zero external CDN or network dependencies, safely shareable with colleagues.
 */
export function generateOfflineHtmlReport(result: MRAnalysisResult): string {
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
        <div class="review-item review-${r.severity}">
          <div style="display: flex; gap: 8px; font-size: 11px;">
            <span class="tag">嚴重程度: ${r.severity.toUpperCase()}</span>
            <span class="tag">分類: ${r.category}</span>
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

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
