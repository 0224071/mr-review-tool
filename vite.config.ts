/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {configDefaults} from 'vitest/config';
import {CSP_META} from './csp.config';

/**
 * GitHub Pages 專案頁面部署於 /mr-review-tool/ 子路徑；本機 dev/build 維持 /。
 * 刻意不使用 define 注入任何金鑰，Gemini API Key 由使用者在 UI 設定中輸入。
 */
export function resolveBase(env: Record<string, string | undefined> = process.env): string {
  return env.GITHUB_PAGES === 'true' ? '/mr-review-tool/' : '/';
}

/**
 * GitHub Pages 無法設定 HTTP header，build 時以 <meta http-equiv> 注入 CSP（Vercel 另由 vercel.json 送 header）。
 * 只在 build 生效：dev 的 React refresh preamble 是 inline script、HMR 走 ws，套用 CSP 會被擋。
 */
export function cspMetaPlugin(content: string = CSP_META): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [{tag: 'meta', attrs: {'http-equiv': 'Content-Security-Policy', content}, injectTo: 'head-prepend'}];
    },
  };
}

export default defineConfig(() => {
  return {
    base: resolveBase(),
    plugins: [react(), tailwindcss(), cspMetaPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      // e2e/ 由 Playwright 執行（npm run test:e2e），vitest 不收
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  };
});
