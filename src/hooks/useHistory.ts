/**
 * 快取與歷史紀錄：開啟 IndexedDB、紀錄清單、目前顯示的紀錄 id，以及抽屜上的開啟／釘選／刪除／清除。
 * 把紀錄套用到畫面、清空畫面由呼叫端（useAnalysis）以 callback 提供。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HistoryRecord, HistoryStore } from '../core/history-store';
import { AppSettings } from '../types/settings';
import { GitLabNote } from '../types/gitlab';
import type { GitLabGateway } from '../app/app-services';

export interface UseHistoryOptions {
  openHistoryStore: () => Promise<HistoryStore | null>;
  gitlab: Pick<GitLabGateway, 'resolveTarget' | 'fetchMergeRequest' | 'fetchNotes'>;
  settings: AppSettings;
  /** 從抽屜開啟紀錄：把紀錄（含原始 diff 與 MR）套用到畫面 */
  onOpenRecord: (record: HistoryRecord) => void;
  /** 開啟 MR 紀錄後在背景讀到的現有留言 */
  onRemoteNotes: (notes: GitLabNote[]) => void;
  /** 目前顯示的紀錄被刪除或清除：畫面回到空白 */
  onActiveRecordRemoved: () => void;
}

export function useHistory({
  openHistoryStore,
  gitlab,
  settings,
  onOpenRecord,
  onRemoteNotes,
  onActiveRecordRemoved,
}: UseHistoryOptions) {
  const [historyStore, setHistoryStore] = useState<HistoryStore | null>(null);
  // null = 檢查中；false = 此瀏覽器無法使用 IndexedDB
  const [historyAvailable, setHistoryAvailable] = useState<boolean | null>(null);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);
  const currentRecordIdRef = useRef<string | null>(null);
  currentRecordIdRef.current = currentRecordId;

  const currentRecord = useMemo(
    () => historyRecords.find((r) => r.id === currentRecordId) ?? null,
    [historyRecords, currentRecordId]
  );

  const refreshHistory = useCallback(async (store: HistoryStore | null = historyStore) => {
    if (!store) return;
    try {
      setHistoryRecords(await store.list());
    } catch (err) {
      // 讀取失敗時保留目前清單，不中斷操作
      console.warn('讀取分析紀錄失敗，保留目前清單:', err);
    }
  }, [historyStore]);

  // App 啟動：開啟 IndexedDB 並清理過期／超量紀錄
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await openHistoryStore();
      if (cancelled) return;
      if (!store) {
        setHistoryAvailable(false);
        return;
      }
      try {
        await store.prune();
        const list = await store.list();
        if (cancelled) return;
        setHistoryRecords(list);
        setHistoryStore(store);
        setHistoryAvailable(true);
      } catch {
        if (!cancelled) setHistoryAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 從抽屜開啟紀錄；MR 紀錄會在背景確認是否有新 commit 並讀取現有留言 */
  const handleOpenRecord = async (id: string) => {
    if (!historyStore) return;
    const record = await historyStore.get(id).catch(() => undefined);
    if (!record) {
      await refreshHistory();
      return;
    }
    setIsHistoryOpen(false);
    onOpenRecord(record);

    if (record.sourceType !== 'gitlab' || !record.mrUrl) return;
    try {
      const target = gitlab.resolveTarget(record.mrUrl, settings);
      const [latestMr, notes] = await Promise.all([gitlab.fetchMergeRequest(target), gitlab.fetchNotes(target)]);
      if (currentRecordIdRef.current !== id) return;
      onRemoteNotes(notes);
      const latestHead = latestMr.diff_refs?.head_sha ?? null;
      if (latestHead && latestHead !== record.latestHeadSha) {
        await historyStore.update(id, { latestHeadSha: latestHead });
        await refreshHistory();
      }
    } catch {
      // 連不到 GitLab 時仍顯示快取結果
    }
  };

  const handleTogglePin = async (id: string) => {
    if (!historyStore) return;
    const record = historyRecords.find((r) => r.id === id);
    await historyStore.update(id, { pinned: !record?.pinned }).catch(() => undefined);
    await refreshHistory();
  };

  const handleDeleteRecord = async (id: string) => {
    if (!historyStore) return;
    await historyStore.remove(id).catch(() => undefined);
    if (id === currentRecordId) onActiveRecordRemoved();
    await refreshHistory();
  };

  const handleClearUnpinned = async () => {
    if (!historyStore) return;
    await historyStore.clearUnpinned().catch(() => 0);
    if (currentRecord && !currentRecord.pinned) onActiveRecordRemoved();
    await refreshHistory();
  };

  return {
    historyStore,
    historyAvailable,
    historyRecords,
    isHistoryOpen,
    setIsHistoryOpen,
    currentRecordId,
    setCurrentRecordId,
    currentRecordIdRef,
    currentRecord,
    refreshHistory,
    handleOpenRecord,
    handleTogglePin,
    handleDeleteRecord,
    handleClearUnpinned,
  };
}

export type HistoryState = ReturnType<typeof useHistory>;
