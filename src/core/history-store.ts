/**
 * MR 分析結果快取與歷史紀錄（IndexedDB）
 *
 * - key：GitLab MR 用 host + project path + MR iid；手動／範例 Diff 用 diff hash
 * - 最多 50 筆、超過 30 天自動刪除，釘選的不受限（App 啟動與新增時清理）
 * - 絕不保存 Gemini API Key 或 GitLab Token：寫入前一律經過 sanitizeForStorage
 */
import { MRAnalysisResult } from '../types/review';
import { GitLabMergeRequestInfo } from '../types/gitlab';

export const HISTORY_DB_NAME = 'gitlab_mr_reviewer_history';
export const HISTORY_DB_VERSION = 1;
export const HISTORY_STORE_NAME = 'records';
export const HISTORY_MAX_RECORDS = 50;
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type HistorySourceType = 'gitlab' | 'manual' | 'sample';

/** 一則意見發布成功後的本地紀錄 */
export interface PublishedRecord {
  /** 發布內容（意見＋建議）的 hash */
  contentHash: string;
  /** AI 原始意見內容的 hash（使用者編輯後發布時，仍可用原始內容比對） */
  originalHash: string;
  file: string;
  line: number | null;
  /** epoch ms */
  publishedAt: number;
  discussionId?: string | number;
}

export type DraftEdits = Record<number, { comment: string; suggestion: string }>;

/** 快取用的 MR 資訊快照（只挑發布與顯示需要的欄位） */
export type HistoryMrSnapshot = Pick<
  GitLabMergeRequestInfo,
  | 'id'
  | 'iid'
  | 'project_id'
  | 'title'
  | 'description'
  | 'state'
  | 'created_at'
  | 'updated_at'
  | 'web_url'
  | 'target_branch'
  | 'source_branch'
  | 'author'
  | 'diff_refs'
>;

export interface HistoryRecord {
  id: string;
  sourceType: HistorySourceType;
  /** MR 標題；手動／範例 Diff 為分析結果標題 */
  title: string;
  host?: string;
  projectPath?: string;
  mrIid?: number;
  mrUrl?: string;
  mr?: HistoryMrSnapshot;
  /** 分析當下的 head SHA */
  headSha?: string | null;
  /** 最近一次從 GitLab 得知的 head SHA（與 headSha 不同代表有新 commit） */
  latestHeadSha?: string | null;
  /** 產生此結果的原始 diff，開啟紀錄時用來還原程式碼顯示 */
  rawDiff: string;
  /** epoch ms */
  analyzedAt: number;
  result: MRAnalysisResult;
  selectedIndices: number[];
  draftEdits: DraftEdits;
  published: PublishedRecord[];
  summaryPublished?: boolean;
  sharedPublished?: boolean;
  pinned: boolean;
}

// ---------------------------------------------------------------------------
// 純函式（不依賴 IndexedDB）
// ---------------------------------------------------------------------------

/** cyrb53：快速、穩定的 53-bit 字串 hash，回傳 hex 字串 */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

export function normalizeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return baseUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  }
}

export function buildMrHistoryKey(baseUrl: string, projectPath: string, mrIid: number): string {
  const path = projectPath.replace(/^\/+|\/+$/g, '').toLowerCase();
  return `mr:${normalizeHost(baseUrl)}/${path}!${mrIid}`;
}

export function buildDiffHistoryKey(rawDiff: string): string {
  // 統一換行與尾端空白，避免複製貼上造成的差異
  const normalized = rawDiff.replace(/\r\n/g, '\n').trim();
  return `diff:${hashString(normalized)}`;
}

/** 內容 hash：意見＋建議，空白正規化後計算 */
export function reviewContentHash(comment: string, suggestion: string): string {
  const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
  return hashString(`${norm(comment)}\n${norm(suggestion)}`);
}

export function hasNewCommit(record: Pick<HistoryRecord, 'headSha' | 'latestHeadSha'>): boolean {
  return Boolean(record.headSha && record.latestHeadSha && record.headSha !== record.latestHeadSha);
}

/** YYYY/MM/DD HH:mm（本地時區） */
export function formatHistoryTime(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** 釘選在前，其餘依分析時間新到舊 */
export function sortHistoryRecords<T extends Pick<HistoryRecord, 'pinned' | 'analyzedAt'>>(records: T[]): T[] {
  return [...records].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.analyzedAt - a.analyzedAt;
  });
}

/**
 * 計算需要清除的紀錄 id：
 * 1. 未釘選且超過 30 天
 * 2. 總數超過 50 筆時，從最舊的未釘選紀錄開始刪
 */
export function selectRecordsToPrune(
  records: Array<Pick<HistoryRecord, 'id' | 'pinned' | 'analyzedAt'>>,
  now: number = Date.now(),
  maxRecords: number = HISTORY_MAX_RECORDS,
  maxAgeMs: number = HISTORY_MAX_AGE_MS
): string[] {
  const remove = new Set<string>();
  for (const r of records) {
    if (!r.pinned && now - r.analyzedAt > maxAgeMs) remove.add(r.id);
  }
  const remaining = records.filter((r) => !remove.has(r.id));
  let overflow = remaining.length - maxRecords;
  if (overflow > 0) {
    const oldestUnpinned = remaining
      .filter((r) => !r.pinned)
      .sort((a, b) => a.analyzedAt - b.analyzedAt);
    for (const r of oldestUnpinned) {
      if (overflow <= 0) break;
      remove.add(r.id);
      overflow--;
    }
  }
  return Array.from(remove);
}

const SECRET_KEY_PATTERN = /(token|api[-_]?key|apikey|secret|password|authorization)/i;

/**
 * 深層複製並移除所有疑似機密欄位（依欄位名稱判斷），確保 IndexedDB 不會存到 Key / Token。
 */
export function sanitizeForStorage<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (SECRET_KEY_PATTERN.test(k)) continue;
        if (child === undefined || typeof child === 'function') continue;
        out[k] = walk(child);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

export function toMrSnapshot(mr: GitLabMergeRequestInfo): HistoryMrSnapshot {
  return {
    id: mr.id,
    iid: mr.iid,
    project_id: mr.project_id,
    title: mr.title,
    description: mr.description,
    state: mr.state,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    web_url: mr.web_url,
    target_branch: mr.target_branch,
    source_branch: mr.source_branch,
    author: {
      id: mr.author?.id,
      name: mr.author?.name,
      username: mr.author?.username,
    },
    diff_refs: mr.diff_refs
      ? {
          base_sha: mr.diff_refs.base_sha,
          head_sha: mr.diff_refs.head_sha,
          start_sha: mr.diff_refs.start_sha,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// IndexedDB 存取
// ---------------------------------------------------------------------------

export interface HistoryStore {
  list(): Promise<HistoryRecord[]>;
  get(id: string): Promise<HistoryRecord | undefined>;
  /** 新增或覆寫一筆紀錄，並執行清理；回傳被清除的 id */
  put(record: HistoryRecord, now?: number): Promise<string[]>;
  /** 只更新部分欄位（不觸發清理）；紀錄不存在時回傳 undefined */
  update(id: string, patch: Partial<Omit<HistoryRecord, 'id'>>): Promise<HistoryRecord | undefined>;
  remove(id: string): Promise<void>;
  /** 清除全部未釘選紀錄，回傳清除筆數 */
  clearUnpinned(): Promise<number>;
  /** 依 50 筆／30 天規則清理，回傳被清除的 id */
  prune(now?: number): Promise<string[]>;
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

class IndexedDbHistoryStore implements HistoryStore {
  constructor(private readonly db: IDBDatabase) {}

  private async readAll(): Promise<HistoryRecord[]> {
    const tx = this.db.transaction(HISTORY_STORE_NAME, 'readonly');
    const all = await promisifyRequest(tx.objectStore(HISTORY_STORE_NAME).getAll() as IDBRequest<HistoryRecord[]>);
    return all;
  }

  private async deleteIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const tx = this.db.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE_NAME);
    ids.forEach((id) => store.delete(id));
    await txDone(tx);
  }

  async list(): Promise<HistoryRecord[]> {
    return sortHistoryRecords(await this.readAll());
  }

  async get(id: string): Promise<HistoryRecord | undefined> {
    const tx = this.db.transaction(HISTORY_STORE_NAME, 'readonly');
    return promisifyRequest(tx.objectStore(HISTORY_STORE_NAME).get(id) as IDBRequest<HistoryRecord | undefined>);
  }

  async put(record: HistoryRecord, now: number = Date.now()): Promise<string[]> {
    const tx = this.db.transaction(HISTORY_STORE_NAME, 'readwrite');
    tx.objectStore(HISTORY_STORE_NAME).put(sanitizeForStorage(record));
    await txDone(tx);
    return this.prune(now);
  }

  async update(id: string, patch: Partial<Omit<HistoryRecord, 'id'>>): Promise<HistoryRecord | undefined> {
    const tx = this.db.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE_NAME);
    const existing = await promisifyRequest(store.get(id) as IDBRequest<HistoryRecord | undefined>);
    if (!existing) {
      await txDone(tx);
      return undefined;
    }
    const next = sanitizeForStorage({ ...existing, ...patch, id });
    store.put(next);
    await txDone(tx);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.deleteIds([id]);
  }

  async clearUnpinned(): Promise<number> {
    const ids = (await this.readAll()).filter((r) => !r.pinned).map((r) => r.id);
    await this.deleteIds(ids);
    return ids.length;
  }

  async prune(now: number = Date.now()): Promise<string[]> {
    const ids = selectRecordsToPrune(await this.readAll(), now);
    await this.deleteIds(ids);
    return ids;
  }
}

/**
 * 開啟歷史紀錄資料庫；瀏覽器不支援或被封鎖（例如部分無痕模式）時回傳 null。
 */
export async function openHistoryStore(
  factory: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined
): Promise<HistoryStore | null> {
  if (!factory) return null;
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
      req.onupgradeneeded = () => {
        const upgradeDb = req.result;
        if (!upgradeDb.objectStoreNames.contains(HISTORY_STORE_NAME)) {
          upgradeDb.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return new IndexedDbHistoryStore(db);
  } catch {
    return null;
  }
}
