/** 以使用者所在時區顯示日期，格式 YYYY/M/D（月、日不補零），例如 2026/10/1；無法解析時原樣回傳 */
export function formatYmd(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
