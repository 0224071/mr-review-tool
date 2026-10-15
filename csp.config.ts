/**
 * Content-Security-Policy 單一來源：vercel.json 的 header 與 GitHub Pages build 注入的 <meta> 都以此為準
 * （vercel.json 無法 import，由 csp.config.test.ts 斷言兩者一致）。
 * - style-src 'unsafe-inline'：React 的 style={{...}} 屬性需要
 * - connect-src https: / localhost：GitLab 與各模型服務的 base URL 由使用者自訂；Ollama 等本機服務走 http://localhost
 * - img-src https:：GitLab 頭像等外部圖片
 */
export const CSP_DIRECTIVES: ReadonlyArray<readonly [string, string]> = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob: https:"],
  ['font-src', "'self' data:"],
  ['connect-src', "'self' https: http://localhost:* http://127.0.0.1:*"],
  ['worker-src', "'self' blob:"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'none'"],
];

/** <meta http-equiv> 不支援的指令（瀏覽器會忽略並在 console 警告） */
const META_UNSUPPORTED = new Set(['frame-ancestors', 'report-uri', 'sandbox']);

/** 完整 CSP（HTTP header 用） */
export const CSP_HEADER = CSP_DIRECTIVES.map(([name, value]) => `${name} ${value}`).join('; ');

/** <meta> 版本：去掉 meta 不支援的指令 */
export const CSP_META = CSP_DIRECTIVES.filter(([name]) => !META_UNSUPPORTED.has(name))
  .map(([name, value]) => `${name} ${value}`)
  .join('; ');
