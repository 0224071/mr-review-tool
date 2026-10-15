/**
 * 示範用歷史紀錄：介面與 IndexedDB 版相同，但不保存任何東西。
 */
import { HistoryStore } from '../core/history-store';

export function createNoopHistoryStore(): HistoryStore {
  return {
    list: async () => [],
    get: async () => undefined,
    put: async () => [],
    update: async () => undefined,
    remove: async () => {},
    clearUnpinned: async () => 0,
    prune: async () => [],
  };
}
