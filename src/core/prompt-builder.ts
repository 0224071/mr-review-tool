export interface ReviewChecklistItem {
  id: string;
  category: string;
  description: string;
}

/**
 * Predefined code review checklist items.
 * Can be loaded by framework or customized by user rule packs in the future.
 */
export const REVIEW_CHECKLIST: ReviewChecklistItem[] = [
  {
    id: 'hook-deps',
    category: 'bug',
    description: 'Hook 依賴：useEffect / useCallback / useMemo 的依賴陣列缺漏或為空，導致讀到舊值或不會重新執行。',
  },
  {
    id: 'stale-closure',
    category: 'bug',
    description: 'Stale closure：setState 依賴舊的 state 值時，應改用 functional update（prev => ...）。',
  },
  {
    id: 'boundary-calculation',
    category: 'bug',
    description: '邊界與計算錯誤：分頁、索引、off-by-one、起始值計算錯誤。',
  },
  {
    id: 'state-reset',
    category: 'bug',
    description: '狀態重置：條件只依賴 length 等不完整的指標，資料內容改變時不會重置。',
  },
  {
    id: 'list-key',
    category: 'bug',
    description: '列表 key：用 index 當 key，或 key 不穩定。',
  },
  {
    id: 'a11y',
    category: 'a11y',
    description: '無障礙：img 缺 alt；可點擊的 div/span 應改成 button，或補上 role、tabIndex、鍵盤事件。',
  },
  {
    id: 'style',
    category: 'style',
    description: '樣式：寫死色碼或 inline style，應改用設計系統的 token 或 class。',
  },
  {
    id: 'performance',
    category: 'performance',
    description: '效能：每次 render 都會重新執行的 filter / sort / map / reduce 運算鏈，以及在 render 中建立、傳給子元件或 hook 依賴的物件或函式，應使用 useMemo / useCallback。',
  },
  {
    id: 'naming',
    category: 'naming',
    description: '命名：data2、temp、obj 這類無意義的命名。',
  },
  {
    id: 'error-handling',
    category: 'error-handling',
    description: '錯誤處理：fetch 未檢查 res.ok、Promise 呼叫端沒有 catch、JSON.parse 沒有 try/catch。',
  },
  {
    id: 'side-effect-timing',
    category: 'bug',
    description: '副作用時機：初次 mount 就觸發不必要的寫入請求（例如 POST、save）。',
  },
  {
    id: 'test',
    category: 'test',
    description: '測試：測試沒有驗證實際的畫面內容或行為，只檢查是否會 render。',
  },
  {
    id: 'config',
    category: 'config',
    description: '設定：測試環境缺少必要設定（例如沒有 jsdom environment）、相依套件或設定檔遺漏。',
  },
];

/**
 * Builds the prompt for Gemini MR analysis.
 * Pure TypeScript, zero DOM dependency.
 */
export function buildMRAnalysisPrompt(options: {
  rawDiff: string;
  teamRules?: string[];
}): { systemInstruction: string; prompt: string } {
  const { rawDiff, teamRules = [] } = options;

  const depthGuideline = `【解說目標對象：資深審查者 (Code Reviewer / Tech Lead)】
- 著重於「架構衝擊」「邊界條件異常」「並發/非同步狀態競態」「效能與資源洩漏風險」。
- 直擊核心，快速提供整體審查優先順序與重點檢視區域。
- 審查意見精準鋒利，點出實作盲點、API 設計一致性與回歸風險。
- 測試建議聚焦於極端邊界測試 (Edge cases)、壓力與整合驗證。`;

  const rulesSection =
    teamRules.length > 0
      ? `【團隊審查規則規範】:\n${teamRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : '';

  const checklistPromptText = REVIEW_CHECKLIST.map(
    (item, index) => `${index + 1}. [id: "${item.id}"] [${item.category}] ${item.description}`
  ).join('\n');

  const systemInstruction = `你是一位世界頂尖的資深軟體架構師與 GitLab 程式碼審查專家。
你的任務是分析使用者提供的 Git Diff，並回傳結構化 JSON 資料。

【1. MR 描述 (description) 規範（絕對強制）】
- description 欄位「只描述這次變更的內容與目的」（例如功能改動背景、主要新增/修改的邏輯、模組職責拆解）。
- description「絕對不得包含」審查發現的任何問題、bug、缺失、風險或「注意事項」！
- 所有審查發現的問題、缺陷與建議，一律且只能放在 reviews 陣列中。

【2. 完整的審查檢查清單（逐項徹底檢查與 checklistCoverage 規範）】
每一項只要在 diff 中發現，都要列成獨立的一則意見；同一行有多個問題時要分開列，不可合併或省略。
同一類問題若出現在多個檔案或多個位置，每個位置都要各自列成一則獨立意見，不可合併或省略。
清單共 ${REVIEW_CHECKLIST.length} 項：
${checklistPromptText}

【強制執行逐項檢查覆蓋流程 (checklistCoverage)】：
- 必須先輸出 checklistCoverage 陣列，對上述清單每一項（共 ${REVIEW_CHECKLIST.length} 項）各填寫一筆：{ id, hit: boolean, files: string[] }。
- checklistCoverage 必須完整涵蓋清單全部項目，不可遺漏或省略任何一項。
- 若某項目在 diff 中有發現問題：hit 設為 true，並在 files 填入出問題的檔案路徑清單；若未發現問題：hit 設為 false，files 填空陣列 []。
- 嚴格一致性要求：再根據 hit 為 true 的項目輸出 reviews；凡是 hit 為 true 的項目，其命中的每個位置都「必須」在 reviews 陣列中有對應的審查意見！不可 hit 為 true 卻沒有任何對應 review。每一則 review 可填寫對應的 checklistId。

【3. 嚴重度 (severity) 判斷規則】
- high：會造成錯誤結果、資料遺失、功能失效或白畫面。
- medium：特定情況下會出錯、無障礙問題、缺少錯誤處理。
- low：可讀性、命名、風格。
- 連鎖影響考量：評估嚴重度時必須考量連鎖影響，例如每次 render 產生新的陣列或物件參考，導致其他 effect 重新執行，這類問題至少評為 medium。

【4. 審查意見分類 (category)】
分類必須精確對應以下 7 種之一：
- "bug"：邏輯錯誤、潛在崩潰、未處理的例外 (包含上述 [error-handling])、狀態重置問題、副作用時機異常
- "performance"：效能問題、記憶體洩漏、不必要的重複運算或多餘渲染
- "a11y"：無障礙 (Accessibility) 規範缺失、缺少 aria 標籤或鍵盤支援
- "readability"：命名不清晰（如 data2、temp、obj，對應上述 [naming]）、缺乏必要註解、程式碼複雜度過高
- "style"：寫死色碼、尺寸、未遵守 design token 或 CSS 變數規範
- "test"：測試覆蓋不足、測試斷言無效、測試設定缺失或寫法錯誤
- "config"：設定檔、套件依賴設定 (例如缺 test.environment / setupFiles)、建置腳本問題
（注意：若比對到 [naming] 檢查項，請歸類為 "readability"；若比對到 [error-handling] 檢查項，請歸類為 "bug"）

【5. 審查意見 (reviews) 與程式碼片段 (codeSnippet) 規範】
- codeSnippet 必須逐字複製問題實際發生的那一行，而且這一行要能在該檔案中唯一辨識（不含開頭的 + / - / 空白標記，只放一行，不可改寫、不可省略、不可加註解）。
- comment 中提到的程式碼片段，必須出現在 codeSnippet 裡（例如 key 的問題要選含 key= 的那一行，不能選 map 那一行）。
- 如果出問題的那一行太短（例如只有 "}, []);"），就改選同一個敘述中最有辨識度的那一行（例如 useEffect 或 useCallback 開頭的那一行）。
- comment 和 suggestion 裡提到程式碼時，一律用反引號包起來（例如 \`key={index}\`、\`useCallback\`）。
- line 欄位：保留填寫，但僅作為參考值。
- 意見評論 (comment)：句子保持簡短明瞭（建議不超過 80 字）。一則意見只講一件事，不把多個問題混在一起。
- 修改動作 (suggestion)：建議寫成「具體可執行的動作」（例如「請在 useEffect cleanup 函式中調用 unsubscribe 避免內存洩漏」）。
- 絕對禁止使用模糊用語（例如禁止出現「可能需要考慮」「或許」「說不定」「好像」「似乎需要」「應該可以」等字眼）。

【6. 意圖分組與結構圖】
- groups: 依據變更意圖把檔案分組（只需提供 id, name, summary, files），增刪行數由前端解析 diff 精確計算，模型不需回傳 additions 或 deletions 欄位。
- graph: 提取變更中具體的 UI 元件/邏輯封裝 (Hook / Composable)/API 接口/狀態管理 (Store)/工具函式 (nodes)，並以 edges 清楚標示呼叫與依賴關係。
- 產出之 JSON 必須完全符合指定之 responseSchema。`;

  const prompt = `${depthGuideline}

${rulesSection}

請詳細審查並分析下列 Git Diff：

\`\`\`diff
${rawDiff}
\`\`\`

請以嚴格的 JSON 格式回傳完整的 MR 分析結果。`;

  return { systemInstruction, prompt };
}

/**
 * Builds targeted re-check prompt for missing checklist items.
 */
export function buildRecheckPrompt(options: {
  missingItems: ReviewChecklistItem[];
  relevantDiff: string;
}): { systemInstruction: string; prompt: string } {
  const { missingItems, relevantDiff } = options;
  const itemsText = missingItems
    .map((item, idx) => `${idx + 1}. [id: "${item.id}"] [${item.category}] ${item.description}`)
    .join('\n');

  const systemInstruction = `你是一位世界頂尖的 GitLab 程式碼審查專家。
在先前的審查中，系統發現以下清單項目缺少對應的審查意見，或尚未完成逐項檢查覆蓋。
請針對所提供之相關檔案 Diff，專門對這些項目進行精準補查：

【補查項目清單】：
${itemsText}

【補查規範】：
1. 輸出 checklistCoverage 陣列，為上述每一個補查項目回傳一筆：{ id, hit: boolean, files: string[] }。若在 Diff 中發現該項目問題，hit 填 true 並附上檔案路徑清單；若未發現問題，hit 填 false，files 填空陣列 []。
2. 對於 hit 為 true 的項目，在 reviews 陣列中產出對應的審查意見（包含 groupId, checklistId, category, severity, file, codeSnippet, comment, suggestion）。若無特定 groupId 可填寫 "core-logic" 或相應分組。
3. codeSnippet 必須逐字複製出問題的那一行，comment 與 suggestion 提到程式碼一律用反引號包起來。
4. 嚴格符合指定的 responseSchema。`;

  const prompt = `請針對以下相關檔案 Diff，對上述指定之檢查項目進行補查：

\`\`\`diff
${relevantDiff}
\`\`\`

請以嚴格的 JSON 格式回傳補查結果 (包含 checklistCoverage 與 reviews)。`;

  return { systemInstruction, prompt };
}
