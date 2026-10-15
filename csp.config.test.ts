import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CSP_HEADER, CSP_META } from './csp.config';
import { cspMetaPlugin } from './vite.config';

const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const headerOf = (key: string) =>
  vercel.headers.find((h) => h.source === '/(.*)')?.headers.find((h) => h.key === key)?.value;

describe('CSP 單一來源', () => {
  it('vercel.json 對所有路徑送出的 CSP 等於 csp.config 的完整版本', () => {
    expect(headerOf('Content-Security-Policy')).toBe(CSP_HEADER);
  });

  it('vercel.json 另外帶有 nosniff、Referrer-Policy 與 X-Frame-Options', () => {
    expect(headerOf('X-Content-Type-Options')).toBe('nosniff');
    expect(headerOf('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerOf('X-Frame-Options')).toBe('DENY');
  });

  it('完整版本禁止 inline script 與被嵌入 iframe', () => {
    expect(CSP_HEADER).toContain("script-src 'self';");
    expect(CSP_HEADER).not.toMatch(/unsafe-eval/);
    expect(CSP_HEADER).toMatch(/frame-ancestors 'none'$/);
  });

  it('meta 版本只少了 meta 不支援的 frame-ancestors', () => {
    expect(CSP_META).not.toContain('frame-ancestors');
    expect(CSP_META).toBe(CSP_HEADER.replace("; frame-ancestors 'none'", ''));
  });
});

describe('cspMetaPlugin', () => {
  it('只在 build 套用（dev 不注入，避免擋到 HMR 的 inline preamble）', () => {
    expect(cspMetaPlugin().apply).toBe('build');
  });

  it('以 <meta http-equiv> 注入 head 最前面，內容為 meta 版本 CSP', () => {
    const hook = cspMetaPlugin().transformIndexHtml as () => unknown;
    expect(hook()).toEqual([
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_META }, injectTo: 'head-prepend' },
    ]);
  });
});
