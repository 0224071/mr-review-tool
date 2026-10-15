/**
 * App 依賴的外部服務（設定儲存、AI、GitLab、歷史紀錄）。
 * App 只透過這些介面工作；正式版與示範模式各自提供實作，由 Root 選擇注入。
 */
import type React from 'react';
import type { HistoryStore } from '../core/history-store';
import type { LlmProvider, ProviderId } from '../providers/types';
import type {
  PublishBatchItem,
  PublishReviewResult,
  PublishTarget,
} from '../services/review-publisher';
import type { AppSettings } from '../types/settings';
import type { GitLabDiffRefs, GitLabMergeRequestInfo, GitLabNote } from '../types/gitlab';
import type { MRAnalysisResult } from '../types/review';

export interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
  onClearKey: (id: ProviderId) => void;
}

/** 設定的讀寫（正式版為 localStorage） */
export interface SettingsGateway {
  load(): AppSettings;
  save(settings: AppSettings): void;
  /** 清除某個 provider 的 key 並立即保存 */
  clearKey(settings: AppSettings, id: ProviderId): AppSettings;
  /** 設定對話框元件 */
  Dialog: React.ComponentType<SettingsDialogProps>;
}

export interface AiGateway {
  /** 目前所選 provider 尚缺的設定；可呼叫時為 null */
  setupNotice(settings: AppSettings): string | null;
  createProvider(settings: AppSettings): LlmProvider;
}

/** 發布結果；notice 為額外標註（示範模式：「示範，未實際發布」） */
export type PublishedResult = PublishReviewResult & { notice?: string };

export type PublishOutcome =
  | { index: number; ok: true; result: PublishedResult }
  | { index: number; ok: false; error: string };

export type PublishBatchFn = (
  target: PublishTarget,
  items: PublishBatchItem[],
  diffRefs: GitLabDiffRefs | undefined,
  hooks?: { onStart?: (index: number) => void; onDone?: (outcome: PublishOutcome) => void }
) => Promise<PublishOutcome[]>;

export interface GitLabGateway {
  /** 發布確認與結果上的額外標註；正式版為 undefined */
  notice?: string;
  /** 沒有 MR 網址時仍可發布的目標名稱；正式版為 undefined（必須有 MR 網址） */
  targetLabel?: string;
  /** 結果與 MR 都沒有 diff_refs 時使用的版本資訊（示範模式為範例的假版本）；正式版為 undefined */
  fallbackDiffRefs?: GitLabDiffRefs;
  isConfigured(settings: AppSettings): boolean;
  /** 由 MR 網址與設定組出目標；網址缺漏或無效時拋錯 */
  resolveTarget(mrUrl: string, settings: AppSettings): PublishTarget;
  fetchMergeRequest(target: PublishTarget): Promise<GitLabMergeRequestInfo>;
  fetchRawDiff(target: PublishTarget): Promise<string>;
  fetchNotes(target: PublishTarget): Promise<GitLabNote[]>;
  createNote(target: PublishTarget, body: string): Promise<unknown>;
  updateNote(target: PublishTarget, noteId: number, body: string): Promise<unknown>;
  shareAnalysis(target: PublishTarget, result: MRAnalysisResult, targetNoteId: number | null): Promise<unknown>;
  publishBatch: PublishBatchFn;
}

export interface AppServices {
  settings: SettingsGateway;
  ai: AiGateway;
  gitlab: GitLabGateway;
  openHistoryStore(): Promise<HistoryStore | null>;
  /** 啟動時左欄預先填入的 diff */
  initialRawDiff: string;
  /** 空白首頁的說明文字 */
  homeHint: string;
  /** 主要區域最上方的固定橫幅（正式版為 null） */
  banner: React.ReactNode;
  /** 「用範例試試看」：進入（或重新開始）示範 */
  onTryDemo: () => void;
}

/** 有標註時接在訊息後面：「已發布 3 則。（示範，未實際發布）」 */
export function withNotice(message: string, notice: string | undefined): string {
  return notice ? `${message}（${notice}）` : message;
}
