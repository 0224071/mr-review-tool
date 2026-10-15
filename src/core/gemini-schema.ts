/**
 * Structured Output Schema for Google GenAI / Gemini API
 * Strictly adheres to the required JSON output specifications.
 */

export const MR_ANALYSIS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    schemaVersion: {
      type: 'INTEGER',
      description: 'Must always be 1',
    },
    title: {
      type: 'STRING',
      description: '簡明扼要的 MR 標題，繁體中文，清楚表達此次變更核心意圖',
    },
    description: {
      type: 'STRING',
      description: 'Markdown 格式的完整 MR 描述，只描述這次變更的內容與目的，不得包含審查發現的任何問題、bug 或「注意事項」；所有問題一律只放在 reviews',
    },
    summary: {
      type: 'ARRAY',
      items: {
        type: 'STRING',
      },
      description: '整體變更重點摘要項目清單，條列式說明',
    },
    testSuggestions: {
      type: 'ARRAY',
      items: {
        type: 'STRING',
      },
      description: '建議測試與驗證項目，例如單元測試、邊界條件測試、手動操作驗證清單',
    },
    groups: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: {
            type: 'STRING',
            description: '群組唯一識別碼，例如 core-logic, ui-components, refactor, tests',
          },
          name: {
            type: 'STRING',
            description: '意圖群組名稱，例如「購物車折價核心邏輯」「折價券輸入 UI 元件」「單元與邊界測試」',
          },
          summary: {
            type: 'STRING',
            description: '該群組變更內容與目的的精簡摘要',
          },
          files: {
            type: 'ARRAY',
            items: {
              type: 'STRING',
            },
            description: '屬於此群組的檔案路徑清單（與 diff 內檔案路徑完全一致）',
          },
        },
        required: ['id', 'name', 'summary', 'files'],
      },
      description: '依變更意圖將檔案分組（例如功能核心邏輯、UI 元件、重構、測試、文件與依賴）',
    },
    graph: {
      type: 'OBJECT',
      properties: {
        nodes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: {
                type: 'STRING',
                description: '節點唯一 ID，通常為模組或元件名稱，例如 CouponInput, useCoupon, couponApi',
              },
              label: {
                type: 'STRING',
                description: '節點顯示標籤',
              },
              groupId: {
                type: 'STRING',
                description: '對應的 groups[].id，讓節點可上色與聯動點選',
              },
              kind: {
                type: 'STRING',
                enum: ['component', 'hook', 'store', 'api', 'util', 'test', 'other'],
                description: '節點類型：component (UI 元件), hook (邏輯封裝如 React Hook 或 Vue Composable), store (狀態/Store), api (API 接口), util (工具函式), test (測試案例), other (模組)',
              },
            },
            required: ['id', 'label', 'groupId', 'kind'],
          },
          description: '變更涉及的核心模組、元件或函式節點',
        },
        edges: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              from: {
                type: 'STRING',
                description: '呼叫方或依賴來源節點 ID',
              },
              to: {
                type: 'STRING',
                description: '被呼叫方或目標節點 ID',
              },
              label: {
                type: 'STRING',
                nullable: true,
                description: '關係或呼叫動作說明，例如 calls, consumes, imports, tests',
              },
            },
            required: ['from', 'to'],
          },
          description: '節點間的呼叫、依賴或引用關聯',
        },
      },
      required: ['nodes', 'edges'],
      description: 'MR 涉及模組之呼叫與依賴關係結構圖資料',
    },
    checklistCoverage: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: {
            type: 'STRING',
            description: '檢查清單項目的唯一識別碼 (id)，如 hook-deps, stale-closure 等',
          },
          hit: {
            type: 'BOOLEAN',
            description: '該檢查項目在本次 diff 中是否命中（發現問題）',
          },
          files: {
            type: 'ARRAY',
            items: {
              type: 'STRING',
            },
            description: '命中的檔案路徑清單（未命中則為空陣列 []）',
          },
        },
        required: ['id', 'hit', 'files'],
      },
      description: '檢查清單覆蓋率狀態陣列，必須涵蓋清單中所有項目，不可省略',
    },
    reviews: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          groupId: {
            type: 'STRING',
            description: '對應的 groups[].id',
          },
          checklistId: {
            type: 'STRING',
            nullable: true,
            description: '對應的 checklistCoverage 項目 id（例如 hook-deps, stale-closure, list-key 等）',
          },
          category: {
            type: 'STRING',
            enum: ['bug', 'performance', 'a11y', 'readability', 'style', 'test', 'config'],
            description: '審查分類：bug (邏輯錯誤/崩潰風險), performance (效能問題), a11y (無障礙), readability (命名與可讀性), style (寫死色碼/尺寸/樣式問題), test (測試覆蓋不足或寫法錯誤), config (設定檔/依賴/建置設定問題)',
          },
          severity: {
            type: 'STRING',
            enum: ['high', 'medium', 'low'],
            description: '嚴重程度：high (會造成錯誤結果、資料遺失、功能失效或白畫面), medium (特定情況下會出錯、無障礙問題、缺少錯誤處理、或因連鎖影響引發 effect 重跑), low (可讀性、命名、風格)',
          },
          file: {
            type: 'STRING',
            description: '具體對應的檔案路徑',
          },
          line: {
            type: 'INTEGER',
            nullable: true,
            description: '具體對應的行號（僅供參考值，若無特定行號則為 null）',
          },
          codeSnippet: {
            type: 'STRING',
            description: '出問題的那一行程式碼原始內容（原封不動複製 diff 中的內容，不含開頭的 + / - / 空白標記，只放一行，不可改寫、不可省略、不可加註解）',
          },
          comment: {
            type: 'STRING',
            description: '審查意見：句子簡短、一則意見只講一件事，避免模糊用語',
          },
          suggestion: {
            type: 'STRING',
            description: '具體可執行的修改動作與範例代碼建議',
          },
        },
        required: ['groupId', 'category', 'severity', 'file', 'codeSnippet', 'comment', 'suggestion'],
      },
      description: '細部程式碼審查意見清單',
    },
  },
  required: [
    'schemaVersion',
    'title',
    'description',
    'summary',
    'testSuggestions',
    'groups',
    'graph',
    'checklistCoverage',
    'reviews',
  ],
};

/**
 * Targeted re-check response schema for missing checklist items.
 */
export const RECHECK_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    checklistCoverage: MR_ANALYSIS_RESPONSE_SCHEMA.properties.checklistCoverage,
    reviews: MR_ANALYSIS_RESPONSE_SCHEMA.properties.reviews,
  },
  required: ['checklistCoverage', 'reviews'],
};
