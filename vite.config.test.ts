import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveBase } from './vite.config';

describe('resolveBase', () => {
  it('GITHUB_PAGES=true 時為 /mr-review-tool/', () => {
    expect(resolveBase({ GITHUB_PAGES: 'true' })).toBe('/mr-review-tool/');
  });

  it('未設定或其他值時為 /', () => {
    expect(resolveBase({})).toBe('/');
    expect(resolveBase({ GITHUB_PAGES: 'false' })).toBe('/');
  });
});

describe('vite.config 金鑰注入', () => {
  it('不以 define 注入 GEMINI_API_KEY 等環境變數', () => {
    const source = readFileSync(new URL('./vite.config.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bdefine\s*:/);
    expect(source).not.toMatch(/GEMINI_API_KEY/);
    expect(source).not.toMatch(/loadEnv/);
  });
});
