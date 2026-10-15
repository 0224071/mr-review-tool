import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  extractBacktickSnippets,
  resolveReviewLine,
  alignReviewsWithDiff,
  dropUnverifiedFallbackLines,
} from './line-resolver';
import { parseGitDiff } from './diff-parser';
import { ParsedDiff } from '../types/diff';
import { MRReviewItem } from '../types/review';

describe('line-resolver', () => {
  describe('extractBacktickSnippets', () => {
    it('extracts backticked code snippets from comment and suggestion', () => {
      const comment = '請避免使用 `key={index}`，並考慮使用 `useMemo`';
      const suggestion = '改用 `key={item.id}`';
      const result = extractBacktickSnippets(comment, suggestion);
      expect(result).toEqual(['key={index}', 'useMemo', 'key={item.id}']);
    });

    it('returns empty array when no backticks exist', () => {
      const result = extractBacktickSnippets('這裡有邏輯錯誤', '請修正');
      expect(result).toEqual([]);
    });

    it('deduplicates identical snippets', () => {
      const comment = '檢查 `data` 的型別';
      const suggestion = '請對 `data` 做防護';
      const result = extractBacktickSnippets(comment, suggestion);
      expect(result).toEqual(['data']);
    });
  });

  describe('resolveReviewLine', () => {
    // Sample parsed diff fixture representing a React component change
    const sampleParsedDiff: ParsedDiff = {
      files: [
        {
          oldPath: 'src/components/ItemList.tsx',
          newPath: 'src/components/ItemList.tsx',
          status: 'modified',
          additions: 7,
          deletions: 0,
          rawContent: '',
          hunks: [
            {
              oldStart: 1,
              oldLines: 25,
              newStart: 1,
              newLines: 30,
              header: '@@ -1,25 +1,30 @@',
              lines: [
                { type: 'context', content: 'import React from "react";', oldLineNumber: 1, newLineNumber: 1 },
                { type: 'context', content: 'export function ItemList({ items }) {', oldLineNumber: 2, newLineNumber: 2 },
                { type: 'add', content: '  const handleAction = () => {', newLineNumber: 3 },
                { type: 'add', content: '    console.log("action");', newLineNumber: 4 },
                { type: 'add', content: '  };', newLineNumber: 5 },
                { type: 'context', content: '  return (', oldLineNumber: 6, newLineNumber: 6 },
                { type: 'context', content: '    <div>', oldLineNumber: 7, newLineNumber: 7 },
                { type: 'add', content: '      {items.map((item, index) => (', newLineNumber: 8 },
                { type: 'add', content: '        <div key={index} className="item-row">', newLineNumber: 9 },
                { type: 'add', content: '          <span>{item.name}</span>', newLineNumber: 10 },
                { type: 'add', content: '        </div>', newLineNumber: 11 },
                { type: 'add', content: '      ))}', newLineNumber: 12 },
                { type: 'context', content: '    </div>', oldLineNumber: 13, newLineNumber: 13 },
                { type: 'context', content: '  );', oldLineNumber: 14, newLineNumber: 14 },
                { type: 'add', content: '  };', newLineNumber: 15 }, // Duplicate short snippet "};"
              ],
            },
          ],
        },
      ],
      totalAdditions: 7,
      totalDeletions: 0,
      fileCount: 1,
    };

    it('情境 1: snippet 精準命中', () => {
      const review = {
        file: 'src/components/ItemList.tsx',
        line: 4,
        codeSnippet: 'console.log("action");',
        comment: '應移除不必要的除錯 `console.log`',
        suggestion: '刪除除錯日誌',
      };

      const result = resolveReviewLine(review, sampleParsedDiff);
      expect(result.newLine).toBe(4);
      expect(result.oldLine).toBeNull();
      expect(result.lineVerified).toBe(true);
    });

    it('情境 2: snippet 選到迴圈開頭那行，但 comment 提到 `key={index}`，應該修正到下一行', () => {
      const review = {
        file: 'src/components/ItemList.tsx',
        line: 8,
        // AI selected the loop opening line (line 8) instead of the actual key line (line 9)
        codeSnippet: '{items.map((item, index) => (',
        comment: '不應使用 `key={index}` 作為列表 key，當項目排序或刪除時會引起渲染錯誤',
        suggestion: '應改為 `key={item.id}`',
      };

      const result = resolveReviewLine(review, sampleParsedDiff);
      // It should search ±5 lines, find <div key={index} className="item-row"> on line 9, and correct it
      expect(result.newLine).toBe(9);
      expect(result.lineVerified).toBe(true);
    });

    it('情境 3: 短 snippet 在同一個檔案中重複出現', () => {
      const review = {
        file: 'src/components/ItemList.tsx',
        line: 5,
        // Short snippet "};" (< 8 characters) that appears twice in ItemList.tsx (line 5 and line 15)
        codeSnippet: '};',
        comment: '結尾分號規範問題',
        suggestion: '請確認程式碼風格',
      };

      const result = resolveReviewLine(review, sampleParsedDiff);
      // Because it is short, duplicated, and does not pass backticked snippet verification, lineVerified must be false
      expect(result.lineVerified).toBe(false);
      // Keeps the line number as fallback
      expect(result.newLine).toBe(5);
    });

    it('情境 4: 找不到 snippet 時，不保留 AI 給的行號並標記為未驗證', () => {
      const review = {
        file: 'src/components/ItemList.tsx',
        line: 42,
        codeSnippet: 'nonExistentFunctionCall("test");',
        comment: '這個函式呼叫有問題',
        suggestion: '請修正',
      };

      const result = resolveReviewLine(review, sampleParsedDiff);
      expect(result.newLine).toBeNull();
      expect(result.oldLine).toBeNull();
      expect(result.lineVerified).toBe(false);
    });

    it('額外情境: 短 snippet 若藉由反引號關鍵字在 5 行內成功對齊，應標記為已驗證', () => {
      const review = {
        file: 'src/components/ItemList.tsx',
        line: 5,
        codeSnippet: '};', // short snippet
        comment: '請注意 `handleAction` 的宣告範疇', // mentions handleAction, which is at line 3 (within 5 lines)
        suggestion: '確保函式只在需要時建立',
      };

      const result = resolveReviewLine(review, sampleParsedDiff);
      expect(result.newLine).toBe(3);
      expect(result.lineVerified).toBe(true);
    });
  });

  describe('alignReviewsWithDiff', () => {
    it('aligns an entire list of reviews with the parsed diff', () => {
      const sampleParsedDiff: ParsedDiff = {
        files: [
          {
            oldPath: 'src/utils/math.ts',
            newPath: 'src/utils/math.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
            rawContent: '',
            hunks: [
              {
                oldStart: 10,
                oldLines: 3,
                newStart: 10,
                newLines: 3,
                header: '@@ -10,3 +10,3 @@',
                lines: [
                  { type: 'context', content: 'export function add(a, b) {', oldLineNumber: 10, newLineNumber: 10 },
                  { type: 'add', content: '  return a + b + 0;', newLineNumber: 11 },
                  { type: 'context', content: '}', oldLineNumber: 12, newLineNumber: 12 },
                ],
              },
            ],
          },
        ],
        totalAdditions: 1,
        totalDeletions: 0,
        fileCount: 1,
      };

      const reviews: MRReviewItem[] = [
        {
          groupId: 'math-group',
          category: 'bug',
          severity: 'medium',
          file: 'src/utils/math.ts',
          line: 99, // inaccurate AI line
          codeSnippet: 'return a + b + 0;',
          comment: '多餘的加零運算 `a + b + 0`',
          suggestion: '改為 `return a + b;`',
        },
      ];

      const aligned = alignReviewsWithDiff(reviews, sampleParsedDiff);
      expect(aligned).toHaveLength(1);
      expect(aligned[0].line).toBe(11);
      expect(aligned[0].newLine).toBe(11);
      expect(aligned[0].lineVerified).toBe(true);
    });
  });

  describe('修改建議中的修正後程式碼（端到端實測回歸）', () => {
    const diff = parseGitDiff(`diff --git a/src/components/UserList.tsx b/src/components/UserList.tsx
--- a/src/components/UserList.tsx
+++ b/src/components/UserList.tsx
@@ -12,6 +12,12 @@
     <ul className="user-list">
-      {users.map((user) => (
-        <li key={user.id} className="user-item">
-          <img src={user.avatarUrl} alt={user.name} width={40} height={40} />
+      {users.map((user, index) => (
+        <li key={index} className="user-item">
+          <img src={user.avatarUrl} width={40} height={40} />
+          <div
+            style={{ color: favorites.includes(user.id) ? '#f5a623' : '#cccccc' }}
+            onClick={() => onToggleFavorite(user.id)}
+          >
+            ★
+          </div>
         </li>
`);
    const file = 'src/components/UserList.tsx';

    it('建議片段不在 diff 中時，以 codeSnippet 精準命中的新增行為準並標記已驗證', () => {
      const result = resolveReviewLine(
        {
          file,
          line: 25,
          codeSnippet: '            onClick={() => onToggleFavorite(user.id)}',
          comment: '使用具點擊事件的 div 未具備按鈕語意與鍵盤操作支援。',
          suggestion: '請改用 `<button type="button">` 元素，或補上 `role="button"`、`tabIndex={0}` 及 `onKeyDown`。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 18, oldLine: null, lineVerified: true });
    });

    it('建議「改回舊寫法」命中刪除行時，不把錨點從新增行移到刪除行', () => {
      const result = resolveReviewLine(
        {
          file,
          line: 15,
          codeSnippet: '          <img src={user.avatarUrl} width={40} height={40} />',
          comment: 'img 標籤移除了 alt 屬性，違反無障礙規範。',
          suggestion: '請補上 `alt={user.name}`。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 15, oldLine: null, lineVerified: true });
    });

    it('comment 提到且存在於新增行的片段仍會用來修正行號', () => {
      const result = resolveReviewLine(
        {
          file,
          line: 13,
          codeSnippet: '      {users.map((user, index) => (',
          comment: '不應使用 `key={index}`',
          suggestion: '請改回 `key={user.id}`',
        },
        diff
      );
      expect(result).toEqual({ newLine: 14, oldLine: null, lineVerified: true });
    });

    it('片段只出現在刪除行、且候選行就是刪除行時仍可驗證', () => {
      const result = resolveReviewLine(
        {
          file,
          line: 14,
          codeSnippet: '          <img src={user.avatarUrl} alt={user.name} width={40} height={40} />',
          comment: '原本的 `alt={user.name}` 被移除',
          suggestion: '保留 alt',
        },
        diff
      );
      expect(result).toEqual({ newLine: null, oldLine: 15, lineVerified: true });
    });

    it('codeSnippet 被截斷時以包含比對找到新增行', () => {
      const result = resolveReviewLine(
        {
          file,
          line: 16,
          codeSnippet: '        <li key={index} className=',
          comment: '列表項目的 key 從原本的 user.id 變更為 index，會造成重繪異常。',
          suggestion: '請恢復使用穩定的唯一識別碼 `key={user.id}`。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 14, oldLine: null, lineVerified: true });
    });

    it('反引號片段在檔案中多處出現時，不把精準命中的行拉到別行', () => {
      const hookDiff = parseGitDiff(`diff --git a/src/hooks/useFavorites.ts b/src/hooks/useFavorites.ts
new file mode 100644
--- /dev/null
+++ b/src/hooks/useFavorites.ts
@@ -0,0 +1,9 @@
+  const toggleFavorite = useCallback((id: number) => {
+    if (favorites.includes(id)) {
+      setFavorites(favorites.filter((f) => f !== id));
+    } else {
+      setFavorites([...favorites, id]);
+    }
+  }, []);
+
+  return { favorites, toggleFavorite };
`);
      const result = resolveReviewLine(
        {
          file: 'src/hooks/useFavorites.ts',
          line: 9,
          codeSnippet: '  }, []);',
          comment: 'useCallback 依賴陣列為空但函式本體引用了外部變數 favorites。',
          suggestion: '請改用函式型更新以移除對 `favorites` 的讀取。',
        },
        hookDiff
      );
      // 行號維持在依賴陣列那行；片段太短又無法以反引號佐證 → 未驗證
      expect(result).toEqual({ newLine: 7, oldLine: null, lineVerified: false });
    });
  });

  describe('lineVerified=false 不保留 AI 行號（playground 發布實測）', () => {
    const diff = parseGitDiff(`diff --git a/src/components/Pagination.tsx b/src/components/Pagination.tsx
--- a/src/components/Pagination.tsx
+++ b/src/components/Pagination.tsx
@@ -1,3 +1,4 @@
 export function Pagination({ page }) {
+  const next = page + 1;
   return <nav>{page}</nav>;
 }
`);
    const base: MRReviewItem = {
      groupId: 'g',
      category: 'bug',
      severity: 'low',
      file: 'src/components/Pagination.tsx',
      line: 999,
      codeSnippet: 'zz_not_in_diff_qq',
      comment: '案例2 行號未驗證，應以一般留言發出。',
      suggestion: '請修正',
    };

    it('snippet 不在 diff 中：line/newLine/oldLine 皆為 null', () => {
      const [aligned] = alignReviewsWithDiff([base], diff);
      expect(aligned).toMatchObject({ line: null, newLine: null, oldLine: null, lineVerified: false });
    });

    it('檔案不在 diff 中：同樣不保留 AI 行號', () => {
      const [aligned] = alignReviewsWithDiff([{ ...base, file: 'src/other.ts' }], diff);
      expect(aligned.line).toBeNull();
      expect(aligned.lineVerified).toBe(false);
    });

    it('候選行在 diff 中但未驗證時，保留 diff 中的行號', () => {
      const [aligned] = alignReviewsWithDiff([{ ...base, line: 2, codeSnippet: '}' }], diff);
      expect(aligned).toMatchObject({ line: 4, newLine: 4, oldLine: 3, lineVerified: false });
    });

    it('dropUnverifiedFallbackLines：清掉舊快取中不在 diff 的未驗證行號，其餘不動', () => {
      const stale = { ...base, newLine: 999, oldLine: null, lineVerified: false };
      const inDiff = { ...base, line: 2, newLine: 2, oldLine: null, lineVerified: false };
      const verified = { ...base, line: 999, newLine: 999, lineVerified: true };
      const [a, b, c] = dropUnverifiedFallbackLines([stale, inDiff, verified], diff);
      expect(a).toMatchObject({ line: null, newLine: null, oldLine: null });
      expect(b).toBe(inDiff);
      expect(c).toBe(verified);
    });
  });

  describe('playground MR !1 真實 diff（GitLab /diffs 回應）', () => {
    const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
    const diff = parseGitDiff(fixture('playground-mr1.diff'));
    const favorites = 'src/hooks/useFavorites.ts';
    const companyFilter = 'src/components/CompanyFilter.tsx';

    it('新檔 hunk @@ -0,0 +1,N @@ 的行號與 MR 上既有 DiffNote 位置一致', () => {
      const lineOf = (path: string, n: number) =>
        diff.files.find((f) => f.newPath === path)!.hunks[0].lines.find((l) => l.newLineNumber === n)!;
      expect(lineOf(favorites, 14)).toMatchObject({ type: 'add', content: '    saveFavorites(favorites);' });
      expect(lineOf(favorites, 23)).toMatchObject({ type: 'add', content: '  }, []);' });
      expect(lineOf(companyFilter, 14)).toMatchObject({
        type: 'add',
        content: '    const list = Array.from(new Set(users.map((u) => u.company))).sort();',
      });
      expect(lineOf(companyFilter, 16)).toMatchObject({ type: 'add', content: '  }, []);' });
    });

    it('Gemini 實際輸出的意見全部對齊到 AI 行號且已驗證', () => {
      const reviews = JSON.parse(fixture('playground-mr1.gemini-reviews.json')) as MRReviewItem[];
      for (const review of reviews) {
        expect(resolveReviewLine(review, diff)).toEqual({ newLine: review.line, oldLine: null, lineVerified: true });
      }
    });

    it('useFavorites L14：comment 只提到其他行的 `useEffect`／`localStorage` 時仍已驗證', () => {
      const result = resolveReviewLine(
        {
          file: favorites,
          line: 14,
          codeSnippet: '    saveFavorites(favorites);',
          comment: '`useEffect` 在元件初次 mount 時便會無條件發送 POST 請求，把 `localStorage` 的值寫入遠端伺服器。',
          suggestion: '請使用 ref 標記跳過初次掛載執行，或改在使用者觸發收藏動作時發送請求。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 14, oldLine: null, lineVerified: true });
    });

    it('useFavorites L23：短片段 `}, []);` 唯一命中且 AI 行號一致時已驗證', () => {
      const result = resolveReviewLine(
        {
          file: favorites,
          line: 23,
          codeSnippet: '  }, []);',
          comment: '`toggleFavorite` 依賴為空陣列且讀取外部 `favorites`，產生 Stale closure 問題。',
          suggestion: '請改用 `setFavorites(prev => ...)` 函式型更新，並以 `useCallback` 包裹。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 23, oldLine: null, lineVerified: true });
    });

    it('CompanyFilter L16：依賴陣列那行是新增行，唯一命中且 AI 行號一致時已驗證', () => {
      const result = resolveReviewLine(
        {
          file: companyFilter,
          line: 16,
          codeSnippet: '  }, []);',
          comment: '`useEffect` 依賴為空陣列，外部 `users` 於非同步載入完成後不會觸發更新。',
          suggestion: '請將 `users` 加入依賴陣列，或直接使用 `useMemo` 計算選項清單。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 16, oldLine: null, lineVerified: true });
    });

    it('短片段唯一命中但 AI 行號指向別行時仍未驗證', () => {
      const result = resolveReviewLine(
        {
          file: companyFilter,
          line: 14,
          codeSnippet: '  }, []);',
          comment: '`useEffect` 依賴為空陣列，外部 `users` 於非同步載入完成後不會觸發更新。',
          suggestion: '請將 `users` 加入依賴陣列。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 16, oldLine: null, lineVerified: false });
    });

    // OpenRouter（nemotron）把同兩則意見標在 hook 開頭那行：L13 `useEffect(() => {`、L17 `useCallback(...)`；
    // 與 Gemini 的 L16／L23（依賴陣列那行）同屬一個 hook 呼叫，兩者都應驗證通過
    it('OpenRouter CompanyFilter L13：codeSnippet 為 useEffect 開頭行時已驗證', () => {
      const result = resolveReviewLine(
        {
          file: companyFilter,
          line: 13,
          codeSnippet: '  useEffect(() => {',
          comment: '`useEffect` 依賴陣列為空，當傳入的 `users` 變更時不會重新計算選項清單。',
          suggestion: '將 `users` 加入依賴陣列。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 13, oldLine: null, lineVerified: true });
    });

    it('OpenRouter useFavorites L17：codeSnippet 為 useCallback 開頭行時已驗證', () => {
      const result = resolveReviewLine(
        {
          file: favorites,
          line: 17,
          codeSnippet: '  const toggleFavorite = useCallback((id: number) => {',
          comment: '`useCallback` 缺少 `favorites` 依賴，回呼函式閉包永久捕獲初始陣列值。',
          suggestion: '改用 `setFavorites(prev => ...)`。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 17, oldLine: null, lineVerified: true });
    });

    it('codeSnippet 唯一命中但 AI 行號與 comment 唯一片段都指向別行時，不再單獨作證', () => {
      // comment 談 L9 的 `JSON.parse`，AI 行號也是 9，codeSnippet 卻抄到 L17
      const result = resolveReviewLine(
        {
          file: favorites,
          line: 9,
          codeSnippet: '  const toggleFavorite = useCallback((id: number) => {',
          comment: '`JSON.parse` 未進行例外處理，非法 JSON 會讓頁面崩潰。',
          suggestion: '以 try/catch 包住並回傳空陣列。',
        },
        diff
      );
      expect(result).toEqual({ newLine: 17, oldLine: null, lineVerified: false });
    });

    it('AI 行號偏離但沒有反證時，行號定到 codeSnippet 命中行並記錄 AI 原行號', () => {
      const [aligned] = alignReviewsWithDiff(
        [
          {
            groupId: 'g',
            category: 'bug',
            severity: 'high',
            file: favorites,
            line: 3,
            codeSnippet: '    return raw ? JSON.parse(raw) : [];',
            comment: '`JSON.parse` 未進行例外處理。',
            suggestion: '',
          } as MRReviewItem,
        ],
        diff
      );
      expect(aligned).toMatchObject({ line: 9, newLine: 9, lineVerified: true, aiLine: 3 });
      // 再對齊一次（例如套用快取）仍保留最初的 AI 行號
      expect(alignReviewsWithDiff([aligned], diff)[0]).toMatchObject({ line: 9, aiLine: 3 });
    });

    it('AI 行號與命中行一致時不記錄 aiLine', () => {
      const reviews = JSON.parse(fixture('playground-mr1.gemini-reviews.json')) as MRReviewItem[];
      for (const r of alignReviewsWithDiff(reviews, diff)) expect(r.aiLine).toBeUndefined();
    });
  });
});
