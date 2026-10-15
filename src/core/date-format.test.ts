import { describe, expect, it } from 'vitest';
import { formatYmd } from './date-format';

describe('formatYmd', () => {
  it('YYYY/M/D，月、日不補零', () => {
    expect(formatYmd(new Date(2026, 9, 1, 12))).toBe('2026/10/1');
    expect(formatYmd(new Date(2026, 0, 9, 12))).toBe('2026/1/9');
  });

  it('接受 ISO 字串；無法解析時原樣回傳', () => {
    expect(formatYmd('2026-10-01T08:00:00Z')).toMatch(/^2026\/(9\/30|10\/[12])$/);
    expect(formatYmd('FAKE-not-a-date')).toBe('FAKE-not-a-date');
  });
});
