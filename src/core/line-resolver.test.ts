import { describe, it, expect } from 'vitest';
import {
  extractBacktickSnippets,
  resolveReviewLine,
  alignReviewsWithDiff,
} from './line-resolver';
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

    it('情境 4: 找不到 snippet 時，退回 AI 給的行號並標記為未驗證', () => {
      const review = {
        file: 'src/components/ItemList.tsx',
        line: 42,
        codeSnippet: 'nonExistentFunctionCall("test");',
        comment: '這個函式呼叫有問題',
        suggestion: '請修正',
      };

      const result = resolveReviewLine(review, sampleParsedDiff);
      expect(result.newLine).toBe(42);
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
});
