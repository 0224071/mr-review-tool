import { describe, expect, it } from 'vitest';
import { getMixedContentWarning, MIXED_CONTENT_MESSAGE } from './mixed-content';

describe('getMixedContentWarning', () => {
  it('https 頁面 + http GitLab 回傳提示', () => {
    expect(getMixedContentWarning('http://gitlab.example.com', 'https:')).toBe(MIXED_CONTENT_MESSAGE);
    expect(getMixedContentWarning('  HTTP://gitlab.example.com/a/-/merge_requests/1', 'https:')).toBe(
      MIXED_CONTENT_MESSAGE
    );
  });

  it('https 頁面 + https GitLab 不提示', () => {
    expect(getMixedContentWarning('https://gitlab.com', 'https:')).toBeNull();
  });

  it('http 頁面（本機 localhost）不提示', () => {
    expect(getMixedContentWarning('http://gitlab.example.com', 'http:')).toBeNull();
  });

  it('非完整網址（group/project!1）不提示', () => {
    expect(getMixedContentWarning('group/project!1', 'https:')).toBeNull();
    expect(getMixedContentWarning('', 'https:')).toBeNull();
  });

  it('訊息不宣稱內網', () => {
    expect(MIXED_CONTENT_MESSAGE).not.toMatch(/內網|內部網路|intranet/i);
  });
});
