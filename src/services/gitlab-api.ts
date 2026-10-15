import {
  GitLabAuthor,
  GitLabCreateDiscussionPayload,
  GitLabMergeRequestInfo,
  GitLabNote,
  ParsedGitLabUrl,
} from '../types/gitlab';
import { MRAnalysisResult } from '../types/review';
import { getMixedContentWarning } from '../core/mixed-content';
import { normalizeResultReviews } from '../core/review-category';

export const SHARED_TAG_START = '<!-- GITLAB_MR_REVIEWER_START v=1 -->';
export const SHARED_TAG_END = '<!-- GITLAB_MR_REVIEWER_END -->';

/**
 * Parses GitLab MR URLs (e.g. https://gitlab.com/group/project/-/merge_requests/123)
 */
export function parseGitLabMrUrl(url: string, defaultBaseUrl: string = 'https://gitlab.com'): ParsedGitLabUrl {
  if (!url || typeof url !== 'string') {
    throw new Error('請輸入有效的 GitLab MR 網址');
  }

  const trimmed = url.trim();

  // Pattern: https://<domain>/<project_path>/-/merge_requests/<iid> or /merge_requests/<iid>
  const match = trimmed.match(/^(https?:\/\/[^/]+)\/(.+?)(?:\/-)?\/merge_requests\/(\d+)(?:\/.*)?$/);

  if (match) {
    const baseUrl = match[1];
    let projectPath = match[2];
    // Remove trailing /-/ if present
    projectPath = projectPath.replace(/\/-$/, '').replace(/^\//, '');
    const mrIid = parseInt(match[3], 10);
    return { baseUrl, projectPath, mrIid };
  }

  // Fallback pattern if only project path and iid was entered (e.g. group/project!123 or group/project/-/merge_requests/123)
  const relativeMatch = trimmed.match(/^([^!]+)!(\d+)$/);
  if (relativeMatch) {
    return {
      baseUrl: defaultBaseUrl.replace(/\/$/, ''),
      projectPath: relativeMatch[1].trim(),
      mrIid: parseInt(relativeMatch[2], 10),
    };
  }

  throw new Error('無法解析 GitLab MR 網址，請確認格式為：https://gitlab.com/<group>/<project>/-/merge_requests/<iid>');
}

/** GitLab API 回應非 2xx 時拋出，保留 HTTP status 供呼叫端判斷（例如行內留言失敗時改發一般留言） */
export class GitLabApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitLabApiError';
    this.status = status;
  }
}

/**
 * fetch 包裝：https 頁面連 http GitLab 會被瀏覽器擋下，先給出明確提示
 */
function gitlabFetch(url: string, init?: RequestInit): Promise<Response> {
  const warning = getMixedContentWarning(url);
  if (warning) {
    return Promise.reject(new Error(warning));
  }
  return fetch(url, init);
}

/**
 * Builds standard GitLab headers
 */
function getHeaders(token?: string): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token && token.trim()) {
    headers['PRIVATE-TOKEN'] = token.trim();
  }
  return headers;
}

/**
 * 驗證 GitLab Personal Access Token（GET /api/v4/user），回傳 Token 所屬使用者。
 * Base URL 留空時預設 https://gitlab.com；網路錯誤（含 CORS）與非 2xx 皆轉成可直接顯示的錯誤訊息。
 */
export async function verifyGitlabToken(
  baseUrl: string,
  token: string
): Promise<{ id: number; username: string; name: string }> {
  if (!token || !token.trim()) {
    throw new Error('請先填入 Personal Access Token');
  }

  const cleanBase = (baseUrl.trim() || 'https://gitlab.com').replace(/\/+$/, '');
  const url = `${cleanBase}/api/v4/user`;
  const warning = getMixedContentWarning(url);
  if (warning) {
    throw new Error(warning);
  }

  let res: Response;
  try {
    res = await fetch(url, { headers: getHeaders(token) });
  } catch {
    throw new Error('無法連線至 GitLab：請檢查 Base URL、網路或該站台是否允許跨來源 (CORS) 存取');
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new GitLabApiError('GitLab Personal Access Token 無效或已過期 (401 Unauthorized)', res.status);
    }
    if (res.status === 403) {
      throw new GitLabApiError('GitLab Token 權限不足 (403)，請確認至少具備 read_user 或 read_api scope', res.status);
    }
    throw new GitLabApiError(`GitLab 連線失敗 (${res.status})`, res.status);
  }

  const user = await res.json();
  return { id: user.id, username: user.username, name: user.name };
}

/**
 * Fetches GitLab MR metadata (including title, description, branches, and diff_refs)
 */
export async function fetchGitLabMergeRequest(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number
): Promise<GitLabMergeRequestInfo> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${cleanBase}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`;

  const res = await gitlabFetch(url, { headers: getHeaders(token) });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`找不到該專案或 Merge Request (#${mrIid})，請檢查專案路徑與 PAT 權限`);
    }
    if (res.status === 401) {
      throw new Error('GitLab Token 無效或無存取該專案之權限 (401)');
    }
    throw new Error(`取得 MR 資訊失敗 (${res.status})`);
  }

  return res.json();
}

/**
 * Fetches raw git diff for a Merge Request
 */
export async function fetchGitLabMrRawDiff(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number
): Promise<string> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(projectPath);

  // 1. Try raw_diffs endpoint first（GitLab 17.9+；單數 raw_diff 不存在，會在 console 留下 404）
  try {
    const rawUrl = `${cleanBase}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/raw_diffs`;
    const res = await gitlabFetch(rawUrl, {
      headers: {
        ...(token ? { 'PRIVATE-TOKEN': token.trim() } : {}),
      },
    });

    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        return text;
      }
    }
  } catch {
    // fallback to diffs api
  }

  // 2. Fallback: fetch /diffs array and convert to unified diff
  const diffsUrl = `${cleanBase}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/diffs?per_page=100`;
  const res = await gitlabFetch(diffsUrl, { headers: getHeaders(token) });
  if (!res.ok) {
    throw new Error(`無法取得 MR Diff (${res.status})，請確認專案權限與 Token`);
  }

  const diffs = await res.json();
  if (!Array.isArray(diffs) || diffs.length === 0) {
    throw new Error('此 Merge Request 沒有任何檔案變更 (Diff 為空)');
  }

  // Construct unified diff format
  const rawChunks = diffs.map((d: { old_path: string; new_path: string; diff: string; new_file?: boolean; deleted_file?: boolean }) => {
    let header = `diff --git a/${d.old_path} b/${d.new_path}\n`;
    if (d.new_file) {
      header += `new file mode 100644\n--- /dev/null\n+++ b/${d.new_path}\n`;
    } else if (d.deleted_file) {
      header += `deleted file mode 100644\n--- a/${d.old_path}\n+++ /dev/null\n`;
    } else {
      header += `--- a/${d.old_path}\n+++ b/${d.new_path}\n`;
    }
    return header + d.diff;
  });

  return rawChunks.join('\n');
}

const NOTES_PER_PAGE = 100;
/** 防止異常回應造成無限迴圈（100 頁 = 1 萬則留言） */
const NOTES_MAX_PAGES = 100;

/**
 * Fetches all MR notes (comments), newest first, following GitLab pagination (x-next-page).
 * 讀不完整就拋錯（任何一頁失敗、回應不是陣列、分頁異常或超過頁數上限），
 * 呼叫端不會拿到不完整的留言去做重複發布比對。
 */
export async function fetchGitLabMrNotes(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number
): Promise<GitLabNote[]> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(projectPath);
  const notes: GitLabNote[] = [];

  let page = 1;
  for (let fetched = 0; fetched < NOTES_MAX_PAGES; fetched++) {
    const url = `${cleanBase}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes?per_page=${NOTES_PER_PAGE}&page=${page}&sort=desc`;
    const res = await gitlabFetch(url, { headers: getHeaders(token) });
    if (!res.ok) {
      throw new Error(`讀取 MR 留言失敗 (第 ${page} 頁，${res.status})`);
    }
    const batch: unknown = await res.json();
    if (!Array.isArray(batch)) {
      throw new Error(`讀取 MR 留言失敗 (第 ${page} 頁回應格式不正確)`);
    }
    notes.push(...(batch as GitLabNote[]));

    let next: number | null;
    const nextHeader = res.headers.get('x-next-page');
    if (nextHeader !== null) {
      // 最後一頁的 x-next-page 是空字串
      const parsed = nextHeader.trim() === '' ? null : parseInt(nextHeader, 10);
      if (parsed !== null && (Number.isNaN(parsed) || parsed <= page)) {
        throw new Error(`讀取 MR 留言失敗 (第 ${page} 頁的分頁資訊不正確)`);
      }
      next = parsed;
    } else {
      // 沒有分頁 header（例如被 proxy 拿掉）時，以回傳筆數判斷是否還有下一頁
      next = batch.length === NOTES_PER_PAGE ? page + 1 : null;
    }
    if (next === null) return notes;
    page = next;
  }
  throw new Error(`讀取 MR 留言失敗 (超過 ${NOTES_MAX_PAGES} 頁上限)`);
}

/** MR 留言中偵測到的共享分析報告 */
export interface SharedAnalysis {
  result: MRAnalysisResult;
  noteId: number;
  author: GitLabAuthor;
  createdAt: string;
  /** 分析當時 MR 的 diff_refs.head_sha；舊版標記沒有此欄位時為 null */
  headSha: string | null;
}

/**
 * Looks for embedded shared MR analysis JSON within MR notes
 * 標記 JSON 的 headSha 為分析時的 head sha，不屬於分析結果本身，會從 result 中拿掉。
 * 作者同時保留顯示名稱與 username，畫面上以「名稱 @username」呈現。
 */
export function findSharedAnalysisInNotes(notes: GitLabNote[]): SharedAnalysis | null {
  for (const note of notes) {
    if (note.body && note.body.includes(SHARED_TAG_START) && note.body.includes(SHARED_TAG_END)) {
      try {
        const startIdx = note.body.indexOf(SHARED_TAG_START) + SHARED_TAG_START.length;
        const endIdx = note.body.indexOf(SHARED_TAG_END);
        const jsonBlock = note.body.slice(startIdx, endIdx);

        // Extract JSON content between ```json ... ``` or directly
        const jsonMatch = jsonBlock.match(/```json\s*([\s\S]*?)\s*```/) || jsonBlock.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const raw = jsonMatch[1] || jsonMatch[0];
          const parsed = JSON.parse(raw.trim()) as MRAnalysisResult & { headSha?: unknown };
          if (parsed && parsed.schemaVersion === 1 && parsed.title && parsed.groups) {
            const { headSha, ...result } = parsed;
            return {
              // 留言任何人都能寫：不認得的 category／severity 改成預設值，避免畫面查不到對應樣式而白掉
              result: normalizeResultReviews(result),
              noteId: note.id,
              author: { name: note.author.name ?? '', username: note.author.username ?? '' },
              createdAt: note.created_at,
              headSha: typeof headSha === 'string' && headSha ? headSha : null,
            };
          }
        }
      } catch {
        // Continue searching other notes if one failed to parse
      }
    }
  }
  return null;
}

/**
 * 共享報告是否對應 MR 目前的版本：兩邊都有 head sha 且相同才算；
 * 舊版標記沒有 headSha、或讀不到 MR 目前的 head sha 時一律視為不符（不自動載入）。
 */
export function isSharedAnalysisCurrent(
  shared: Pick<SharedAnalysis, 'headSha'>,
  currentHeadSha: string | null | undefined
): boolean {
  return !!shared.headSha && !!currentHeadSha && shared.headSha === currentHeadSha;
}

/**
 * Creates a Discussion with line position or general comment on GitLab MR
 * POST /projects/:id/merge_requests/:iid/discussions
 * 回傳的 id 為 discussion id（字串）；不帶 position 時即為 MR 一般留言。
 */
export async function createGitLabDiscussion(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number,
  payload: GitLabCreateDiscussionPayload
): Promise<{ id: string | number }> {
  if (!token || !token.trim()) {
    throw new Error('未設定 GitLab Personal Access Token，請至偏好設定中填寫');
  }

  const cleanBase = baseUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${cleanBase}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/discussions`;

  const res = await gitlabFetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let errorMsg = errorBody;
    try {
      const parsed = JSON.parse(errorBody);
      errorMsg = parsed.message || errorBody;
    } catch {
      // 錯誤 body 不是 JSON：直接用原始文字當錯誤訊息
    }
    throw new GitLabApiError(`發布 Discussion 失敗 (${res.status})：${errorMsg}`, res.status);
  }

  const data = await res.json();
  return { id: data.id };
}

/**
 * 以 /discussions（不帶 position）發一般留言，和行內留言一樣回傳 discussion id，發布紀錄格式一致
 */
export async function createGitLabGeneralDiscussion(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number,
  body: string
): Promise<{ id: string | number }> {
  return createGitLabDiscussion(baseUrl, token, projectPath, mrIid, { body });
}

/**
 * Posts a general comment to GitLab MR
 * POST /projects/:id/merge_requests/:iid/notes
 */
export async function createGitLabNote(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number,
  body: string
): Promise<{ id: number }> {
  if (!token || !token.trim()) {
    throw new Error('未設定 GitLab Personal Access Token，請至偏好設定中填寫');
  }

  const cleanBase = baseUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${cleanBase}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes`;

  const res = await gitlabFetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`發送 MR 留言失敗 (${res.status})：${errorText}`);
  }

  const data = await res.json();
  return { id: data.id };
}

export const SUMMARY_TAG = '<!-- GITLAB_MR_SUMMARY_START -->';

/**
 * Updates an existing note/comment on GitLab MR
 * PUT /projects/:id/merge_requests/:iid/notes/:note_id
 */
export async function updateGitLabNote(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number,
  noteId: number,
  body: string
): Promise<{ id: number }> {
  if (!token || !token.trim()) {
    throw new Error('未設定 GitLab Personal Access Token，請至偏好設定中填寫');
  }

  const cleanBase = baseUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${cleanBase}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes/${noteId}`;

  const res = await gitlabFetch(url, {
    method: 'PUT',
    headers: getHeaders(token),
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`更新 MR 留言失敗 (${res.status})：${errorText}`);
  }

  const data = await res.json();
  return { id: data.id };
}

/**
 * Scans notes for existing overall comments (shared analysis report or general summary)
 */
export function findExistingOverallNote(notes: GitLabNote[]): {
  sharedNote: GitLabNote | null;
  summaryNote: GitLabNote | null;
} {
  let sharedNote: GitLabNote | null = null;
  let summaryNote: GitLabNote | null = null;

  for (const note of notes) {
    if (note.body && (note.body.includes('GITLAB_MR_REVIEWER_START') || (note.body.includes(SHARED_TAG_START) && note.body.includes(SHARED_TAG_END)))) {
      if (!sharedNote) sharedNote = note;
    } else if (
      note.body &&
      (note.body.includes(SUMMARY_TAG) || note.body.includes('### 📋 MR 審查整體摘要'))
    ) {
      if (!summaryNote) summaryNote = note;
    }
  }

  return { sharedNote, summaryNote };
}

/**
 * Formats and posts or updates the complete MR analysis JSON back to the MR as a shared comment
 * (Mechanism 1: Share analysis result back to MR with hidden metadata tag)
 * If targetNoteId is provided (e.g. existing summary note or shared note), updates that note to preserve a single overall comment.
 * headSha 為分析當時 MR 的 diff_refs.head_sha；沒有（例如手動貼上的 diff）時不寫入，開啟時視為版本不符。
 */
export async function postSharedAnalysisToMr(
  baseUrl: string,
  token: string,
  projectPath: string,
  mrIid: number,
  result: MRAnalysisResult,
  targetNoteId?: number | null,
  headSha?: string | null
): Promise<{ id: number; updated: boolean }> {
  // headSha 記錄分析當時 MR 的 head sha，開啟時與 MR 目前版本比對，不同就不自動載入
  const jsonString = JSON.stringify(headSha ? { ...result, headSha } : result, null, 2);

  const commentBody = `### 🤖 GitLab MR AI 講解與審查報告

**標題**：${result.title}

#### 📋 變更摘要
${result.summary.map((s) => `- ${s}`).join('\n')}

#### 📁 意圖分組 (${result.groups.length} 組)
${result.groups.map((g) => `- **${g.name}** (+${g.additions} / -${g.deletions}): ${g.summary} (${g.files.length} 個檔案)`).join('\n')}

#### 🔍 審查意見摘要 (${result.reviews.length} 則)
- **重大 (High)**: ${result.reviews.filter((r) => r.severity === 'high').length} 則
- **中等 (Medium)**: ${result.reviews.filter((r) => r.severity === 'medium').length} 則
- **一般 (Low)**: ${result.reviews.filter((r) => r.severity === 'low').length} 則

---
*💡 團隊成員可使用「GitLab MR 講解與審查工具」開啟本 MR 網址，將自動載入此報告，無需 Gemini API Key。*

${SHARED_TAG_START}
\`\`\`json
${jsonString}
\`\`\`
${SHARED_TAG_END}`;

  if (targetNoteId) {
    const updated = await updateGitLabNote(baseUrl, token, projectPath, mrIid, targetNoteId, commentBody);
    return { id: updated.id, updated: true };
  }

  const created = await createGitLabNote(baseUrl, token, projectPath, mrIid, commentBody);
  return { id: created.id, updated: false };
}
