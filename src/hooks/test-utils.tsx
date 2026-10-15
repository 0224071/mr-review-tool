/**
 * hook 單元測試用的小工具：以 react-dom/client 掛載只呼叫 hook 的元件（需在 happy-dom 環境執行）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { HistoryRecord, HistoryStore } from '../core/history-store';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function renderHook<P, R>(hook: (props: P) => R, initialProps: P) {
  const result = { current: undefined as unknown as R };
  function Probe({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => {
    root.render(<Probe props={initialProps} />);
  });
  return {
    result,
    rerender(props: P) {
      act(() => {
        root.render(<Probe props={props} />);
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

/** 在 act 內執行（可為非同步），並讓排程中的 promise／計時器跑完 */
export async function actAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  let value!: T;
  await act(async () => {
    value = await fn();
    await new Promise((r) => setTimeout(r, 0));
  });
  return value;
}

/** 等待背景的非同步工作（例如 useEffect 開啟歷史紀錄） */
export const flush = () => actAsync(() => undefined);

export function makeRecord(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'rec-1',
    sourceType: 'manual',
    title: SAMPLE_ANALYSIS_RESULT.title,
    rawDiff: '',
    analyzedAt: 1_700_000_000_000,
    result: SAMPLE_ANALYSIS_RESULT,
    selectedIndices: [],
    draftEdits: {},
    published: [],
    pinned: false,
    ...over,
  };
}

/** 記憶體版 HistoryStore，每個方法都是 vi.fn 方便斷言 */
export function createMemoryStore(initial: HistoryRecord[] = []) {
  const records = new Map(initial.map((r) => [r.id, r]));
  const store = {
    list: vi.fn(async () => Array.from(records.values())),
    get: vi.fn(async (id: string) => records.get(id)),
    put: vi.fn(async (record: HistoryRecord) => {
      records.set(record.id, record);
      return [] as string[];
    }),
    update: vi.fn(async (id: string, patch: Partial<Omit<HistoryRecord, 'id'>>) => {
      const existing = records.get(id);
      if (!existing) return undefined;
      const next = { ...existing, ...patch };
      records.set(id, next);
      return next;
    }),
    remove: vi.fn(async (id: string) => {
      records.delete(id);
    }),
    clearUnpinned: vi.fn(async () => {
      let n = 0;
      for (const [id, r] of records) {
        if (!r.pinned) {
          records.delete(id);
          n++;
        }
      }
      return n;
    }),
    prune: vi.fn(async () => [] as string[]),
  } satisfies HistoryStore;
  return { store, records };
}

/**
 * 以 vi.stubGlobal 模擬 GitLab API 的 fetch（用完要 vi.unstubAllGlobals）：
 * MR 資訊、raw diff 與留言的 GET 依參數回應；所有非 GET 請求記進 writes 並回 500（不應該出現）。
 */
export function stubGitLabFetch({
  mr,
  rawDiff,
  notes,
}: {
  mr: unknown;
  rawDiff: string;
  /** 留言：陣列為成功回應，數字為失敗的 HTTP status；可回傳 Promise 延遲回應 */
  notes: () => unknown[] | number | Promise<unknown[] | number>;
}) {
  const writes: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      writes.push(`${method} ${url.pathname}`);
      return new Response('{}', { status: 500 });
    }
    if (url.pathname.endsWith('/notes')) {
      const body = await notes();
      return typeof body === 'number'
        ? new Response('{"message":"FAKE error"}', { status: body })
        : new Response(JSON.stringify(body), { status: 200, headers: { 'x-next-page': '' } });
    }
    if (url.pathname.endsWith('/raw_diffs')) return new Response(rawDiff, { status: 200 });
    if (/\/merge_requests\/\d+$/.test(url.pathname)) return new Response(JSON.stringify(mr), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, writes };
}
