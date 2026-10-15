import { MRAnalysisResult } from '../../types/review';

export const SAMPLE_ANALYSIS_RESULT: MRAnalysisResult = {
  schemaVersion: 1,
  title: 'feat(cart): 新增購物車折價券兌換與折抵計算功能',
  description: `## 變更摘要
本 MR 引入購物車折價券（優惠代碼）功能，涵蓋後端驗證呼叫、狀態管理 Hook、輸入 UI 元件與折扣計算工具函式。

### 主要改動
- **API 模組**：新增 \`validateCouponCode\` 進行遠端優惠代碼合法性與門檻驗證。
- **狀態管理**：新增 \`useCouponRedemption\` Hook 管理兌換中狀態、錯誤處理與折扣後總額計算。
- **UI 元件**：新增 \`CouponInput\` 元件支援鍵盤 Enter 提交與即時錯誤提示。
- **核心工具**：新增 \`calculateFinalTotal\` 支援百分比與固定面額折扣並防範負數金額。
- **單元測試**：為折扣計算邏輯新增邊界條件測試覆蓋。`,
  summary: [
    '新增優惠券遠端驗證 API 接口與資料型別定義',
    '封裝 useCouponRedemption 自訂 Hook 統一管理套用邏輯與折扣後金額',
    '實作 CouponInput 互動元件，支援 Enter 快速觸發與非同步禁用狀態',
    '擴充 discountCalculator 工具函式，支援百分比與固定扣抵',
    '補充折扣邏輯之單元測試，確保邊界數值不出現負數',
  ],
  testSuggestions: [
    '執行 npm test 確認 discountCalculator 單元測試全數通過',
    '輸入無效優惠碼驗證錯誤提示訊息是否如期顯示在輸入框下方',
    '測試結帳金額為 0 時套用固定面額折價券是否維持 0 元',
    '模擬 API 延遲 2 秒情境，確認套用按鈕處於 Disabled 狀態避免重複發送請求',
  ],
  groups: [
    {
      id: 'core-logic',
      name: '功能核心邏輯',
      summary: '折價券兌換狀態管理與結帳總額運算核心函式',
      files: ['src/hooks/useCouponRedemption.ts', 'src/utils/discountCalculator.ts'],
      additions: 70,
      deletions: 2,
    },
    {
      id: 'api-layer',
      name: 'API 服務層',
      summary: '遠端折價券有效性驗證接口封裝',
      files: ['src/api/couponApi.ts'],
      additions: 38,
      deletions: 0,
    },
    {
      id: 'ui-components',
      name: 'UI 元件',
      summary: '提供使用者輸入代碼並觸發套用的優惠券輸入控制項',
      files: ['src/components/CouponInput.tsx'],
      additions: 48,
      deletions: 0,
    },
    {
      id: 'tests',
      name: '測試與驗證',
      summary: '折扣計算邏輯單元測試與邊界覆蓋',
      files: ['src/tests/discountCalculator.test.ts'],
      additions: 32,
      deletions: 0,
    },
  ],
  graph: {
    nodes: [
      {
        id: 'CouponInput',
        label: 'CouponInput',
        groupId: 'ui-components',
        kind: 'component',
      },
      {
        id: 'useCouponRedemption',
        label: 'useCouponRedemption',
        groupId: 'core-logic',
        kind: 'hook',
      },
      {
        id: 'validateCouponCode',
        label: 'validateCouponCode',
        groupId: 'api-layer',
        kind: 'api',
      },
      {
        id: 'calculateFinalTotal',
        label: 'calculateFinalTotal',
        groupId: 'core-logic',
        kind: 'util',
      },
      {
        id: 'discountCalculatorTest',
        label: 'discountCalculator.test',
        groupId: 'tests',
        kind: 'test',
      },
    ],
    edges: [
      {
        from: 'CouponInput',
        to: 'useCouponRedemption',
        label: '觸發套用',
      },
      {
        from: 'useCouponRedemption',
        to: 'validateCouponCode',
        label: '驗證代碼',
      },
      {
        from: 'useCouponRedemption',
        to: 'calculateFinalTotal',
        label: '計算折扣',
      },
      {
        from: 'discountCalculatorTest',
        to: 'calculateFinalTotal',
        label: '測試驗證',
      },
    ],
  },
  checklistCoverage: [
    { id: 'hook-deps', hit: false, files: [] },
    { id: 'stale-closure', hit: false, files: [] },
    { id: 'boundary-calculation', hit: false, files: [] },
    { id: 'state-reset', hit: false, files: [] },
    { id: 'list-key', hit: false, files: [] },
    { id: 'a11y', hit: true, files: ['src/components/CouponInput.tsx'] },
    { id: 'style', hit: true, files: ['src/components/CouponInput.tsx'] },
    { id: 'performance', hit: true, files: ['src/hooks/useCouponRedemption.ts'] },
    { id: 'naming', hit: false, files: [] },
    { id: 'error-handling', hit: true, files: ['src/api/couponApi.ts'] },
    { id: 'side-effect-timing', hit: false, files: [] },
    { id: 'test', hit: true, files: ['src/tests/discountCalculator.test.ts'] },
    { id: 'config', hit: false, files: [] },
  ],
  reviews: [
    {
      groupId: 'core-logic',
      category: 'bug',
      severity: 'high',
      file: 'src/hooks/useCouponRedemption.ts',
      line: 21,
      codeSnippet: 'const coupon = await validateCouponCode(codeToApply, cartTotal);',
      comment: '避免在非同步請求未完成前組件卸載造成狀態更新報錯。',
      suggestion: '請引入 AbortController 或 isMounted 檢查標記，並在組件卸載時中斷請求。',
    },
    {
      groupId: 'ui-components',
      category: 'a11y',
      severity: 'medium',
      file: 'src/components/CouponInput.tsx',
      line: 27,
      codeSnippet: 'type="text"',
      comment: '輸入框缺少 aria-label 與關聯的 label 標籤。',
      suggestion: '請為 input 加入 aria-label="優惠代碼" 或搭配 <label> 標籤以提升無障礙螢幕閱讀體驗。',
    },
    {
      groupId: 'core-logic',
      category: 'performance',
      severity: 'medium',
      file: 'src/hooks/useCouponRedemption.ts',
      line: 30,
      codeSnippet: 'const finalAmount = appliedCoupon',
      comment: '每次組件重新渲染時均重複計算 finalAmount。',
      suggestion: '請使用 useMemo 包裝 calculateFinalTotal 計算，僅在 cartTotal 或 appliedCoupon 變動時重新計算。',
    },
    {
      groupId: 'api-layer',
      category: 'bug',
      severity: 'high',
      file: 'src/api/couponApi.ts',
      line: 17,
      codeSnippet: 'const errorData = await response.json();',
      comment: '伺服器若回傳非 JSON 格式錯誤頁面（例如 502/504），response.json() 將拋出解析異常。',
      suggestion: '請改用 try-catch 包裝 response.json()，若解析失敗則回退至 response.statusText。',
    },
    {
      groupId: 'ui-components',
      category: 'style',
      severity: 'low',
      file: 'src/components/CouponInput.tsx',
      line: 39,
      codeSnippet: 'className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"',
      comment: '按鈕背景色寫死色碼 bg-indigo-600，未採用專案定義之 theme token。',
      suggestion: '請改用 primary 主題變數例如 bg-primary，以維持全站設計規範一致性。',
    },
    {
      groupId: 'tests',
      category: 'test',
      severity: 'medium',
      file: 'src/tests/discountCalculator.test.ts',
      // 刻意引用 diff 中不存在的程式碼與行號：示範「行號未驗證 → 改發一般留言」
      line: 45,
      codeSnippet: "expect(calculateFinalTotal(1000, 'percentage', 150)).toBe(0);",
      comment: '測試僅驗證正常數值，未覆蓋百分比大於 100% 的極端計算邏輯。',
      suggestion: '請新增百分比大於 100 時的測試案例，確保不會算出負數總額。',
    },
  ],
};
