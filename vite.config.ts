import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/**
 * GitHub Pages 專案頁面部署於 /mr-review-tool/ 子路徑；本機 dev/build 維持 /。
 * 刻意不使用 define 注入任何金鑰，Gemini API Key 由使用者在 UI 設定中輸入。
 */
export function resolveBase(env: Record<string, string | undefined> = process.env): string {
  return env.GITHUB_PAGES === 'true' ? '/mr-review-tool/' : '/';
}

export default defineConfig(() => {
  return {
    base: resolveBase(),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
