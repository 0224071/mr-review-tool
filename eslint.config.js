import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import importX, { createNodeResolver } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// 暫時做法（追蹤於 #77）：typescript-eslint 目前不支援 TypeScript 7.0（載入時直接丟錯），
// 因此改用 @babel/eslint-parser 只做語法解析，不使用型別資訊。
// 型別檢查仍由 `npm run typecheck`（tsc）負責。
// Babel 設定只寫在這裡（babelrc/configFile 皆關閉），不放 babel.config.* 檔，
// 避免 vite / vitest 讀到；Babel 套件只用於 lint，不參與 build。
const babelTsParserOptions = {
  requireConfigFile: false,
  babelOptions: {
    babelrc: false,
    configFile: false,
    presets: ['@babel/preset-typescript'],
    // JSX 只在 .tsx 開啟，避免 .ts 裡的 `<T>value` 型別斷言被當成 JSX
    overrides: [{ test: /\.tsx$/, presets: ['@babel/preset-react'] }],
  },
};

export default [
  {
    ignores: ['dist/', 'coverage/', 'playwright-report/', 'test-results/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: babelTsParserOptions,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'import-x': importX,
    },
    settings: {
      'import-x/resolver-next': [createNodeResolver({ extensions: ['.ts', '.tsx', '.js'] })],
    },
    rules: {
      // 未定義與未使用變數交給 tsc 檢查：Babel 的 scope 分析不認得型別名稱與 JSX 用法，
      // 開著只會產生大量誤報（例如只在型別或 JSX 用到的 import 會被當成未使用）
      'no-undef': 'off',
      'no-unused-vars': 'off',

      // React Compiler 相關規則先設 warn，留待後續逐一處理
      ...Object.fromEntries(
        Object.keys(reactHooks.configs['recommended-latest'].rules).map((rule) => [rule, 'warn']),
      ),
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // 依賴方向：非 UI 層不得 import UI 層
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: [
                './src/core',
                './src/utils',
                './src/services',
                './src/providers',
                './src/types',
              ],
              from: ['./src/components', './src/hooks', './src/app', './src/demo'],
              message: '非 UI 層（core/utils/services/providers/types）不得依賴 UI 層。',
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright fixture 的 `use` 不是 React Hook，且 fixture 參數必須用解構（含空物件）
    files: ['e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
];
