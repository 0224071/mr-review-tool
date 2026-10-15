// @vitest-environment happy-dom
/**
 * 共享報告 UX（#67）：確認視窗覆寫／新增的文案與「查看原留言」連結、讀取留言中的按鈕文字、
 * 過期共享報告卡片的日期格式、文案與「重新分析」按鈕。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PublishConfirmationModal } from './PublishConfirmationModal';
import { AnalysisResultView } from './AnalysisResultView';
import { DiffInputPanel } from './DiffInputPanel';
import type { StaleSharedAnalysis } from '../hooks/useAnalysis';
import { SAMPLE_ANALYSIS_RESULT } from '../services/diff-sources/sample-analysis';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { parseGitDiff } from '../core/diff-parser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MR_URL = 'https://gitlab.example.com/FAKE-grp/FAKE-proj/-/merge_requests/7';
/** 使用者時區的 2026/10/1 中午，避免時區造成日期跳動 */
const OCT_1 = new Date(2026, 9, 1, 12).toISOString();

const renderShareModal = (share: Parameters<typeof PublishConfirmationModal>[0]['share'], isPublishing = false) =>
  renderToStaticMarkup(
    <PublishConfirmationModal
      isOpen
      onClose={() => {}}
      onConfirm={() => {}}
      mrInfo={null}
      mrUrl={MR_URL}
      itemsToPublish={[]}
      share={share}
      isPublishing={isPublishing}
    />
  );

describe('共享確認視窗', () => {
  const overwriteShared = {
    overwrite: 'shared' as const,
    overwriteAuthor: 'fake-handle',
    overwriteCreatedAt: OCT_1,
    overwriteNoteUrl: `${MR_URL}#note_501`,
  };

  it('副標題說明會在 MR 留下一則大家看得到的留言', () => {
    expect(renderShareModal({ overwrite: null })).toContain('會在 MR 上留下一則留言，團隊成員都看得到');
  });

  it('覆寫既有共享報告：只有一個黃框，寫明作者 handle 與日期（YYYY/M/D），內容說明為小字', () => {
    const html = renderShareModal(overwriteShared);
    expect(html).toContain('會覆寫 @fake-handle 於 2026/10/1 發布的共享報告留言，不會另外新增留言');
    expect(html.match(/bg-warning-subtle/g)).toHaveLength(1);
    expect(html).not.toContain('bg-primary-subtle');
    expect(html).toMatch(/<p class="text-\[11px\][^"]*">留言包含分析摘要/);
    expect(html).toContain('確認共享（覆寫 1 則留言）');
  });

  it('覆寫時有「查看原留言」連結（新分頁、noopener noreferrer）與發布日期', () => {
    const container = document.createElement('div');
    container.innerHTML = renderShareModal(overwriteShared);
    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('查看原留言'));
    expect(link?.getAttribute('href')).toBe(`${MR_URL}#note_501`);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.parentElement?.textContent).toContain('發布於 2026/10/1');
  });

  it('覆寫整體摘要留言時寫明是整體摘要', () => {
    expect(renderShareModal({ ...overwriteShared, overwrite: 'summary' })).toContain(
      '會覆寫 @fake-handle 於 2026/10/1 發布的整體摘要留言，不會另外新增留言'
    );
  });

  it('新增留言：只有一個框、沒有覆寫字樣與原留言連結', () => {
    const html = renderShareModal({ overwrite: null });
    expect(html).toContain('會在 MR 新增一則共享報告留言');
    expect(html).not.toContain('會覆寫');
    expect(html).not.toContain('查看原留言');
    expect(html).not.toContain('bg-warning-subtle');
    expect(html.match(/bg-primary-subtle border/g)).toHaveLength(1);
    expect(html).toContain('確認共享（新增 1 則留言）');
  });

  it('寫入中按鈕顯示「共享中...」', () => {
    expect(renderShareModal({ overwrite: null }, true)).toContain('共享中...');
  });
});

describe('共享前讀取留言中', () => {
  const renderView = (isReadingShareNotes: boolean) =>
    renderToStaticMarkup(
      <AnalysisResultView
        result={SAMPLE_ANALYSIS_RESULT}
        mrUrl={MR_URL}
        onPublishSingleReview={() => {}}
        isSharingToMr={isReadingShareNotes}
        isReadingShareNotes={isReadingShareNotes}
        selectedIndices={new Set()}
        onSelectedIndicesChange={() => {}}
        draftEdits={{}}
        onDraftEditsChange={() => {}}
      />
    );

  it('GET 讀留言期間發布按鈕顯示「讀取留言中」，不是「共享中」', () => {
    const html = renderView(true);
    expect(html).toContain('讀取留言中...');
    expect(html).not.toContain('共享中');
  });

  it('平常顯示「發布至 MR ▾」', () => {
    const html = renderView(false);
    expect(html).toContain('發布至 MR ▾');
    expect(html).not.toContain('讀取留言中');
  });
});

describe('過期共享報告卡片', () => {
  const parsedDiff = parseGitDiff(SAMPLE_GIT_DIFF);
  const stale = (over: Partial<StaleSharedAnalysis> = {}): StaleSharedAnalysis => ({
    author: 'FAKE Reviewer',
    createdAt: OCT_1,
    sharedHeadSha: 'a1'.repeat(20),
    currentHeadSha: 'b2'.repeat(20),
    ...over,
  });

  const mount = (staleSharedAnalysis: StaleSharedAnalysis, { onAnalyze = vi.fn(), isLoading = false } = {}) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(
        <DiffInputPanel
          rawDiff={SAMPLE_GIT_DIFF}
          onDiffChange={() => {}}
          parsedDiff={parsedDiff}
          onAnalyze={onAnalyze}
          onLoadSampleDiff={() => {}}
          onLoadSampleAnalysis={() => {}}
          isLoading={isLoading}
          setupNotice={null}
          onOpenSettings={() => {}}
          gitlabMrUrl={MR_URL}
          onGitlabMrUrlChange={() => {}}
          onFetchGitLabMr={async () => {}}
          isFetchingGitLab={false}
          currentGitLabMr={null}
          staleSharedAnalysis={staleSharedAnalysis}
          hasGitLabToken
          gitlabError={null}
        />
      );
    });
    const card = container.querySelector('[role="status"]') as HTMLElement;
    const button = Array.from(card.querySelectorAll('button')).find((b) => b.textContent?.includes('重新分析'));
    return { card, button, onAnalyze, unmount: () => act(() => root.unmount()) };
  };

  it('日期為 YYYY/M/D，內文說明 MR 有新的 commit，commit hash 為小的灰字', () => {
    const { card, unmount } = mount(stale());
    expect(card.textContent).toContain('由 @FAKE Reviewer 於 2026/10/1 發布');
    expect(card.textContent).toContain('這份報告分析完後，MR 又有新的 commit，內容可能已經不準');
    const hashLine = Array.from(card.querySelectorAll('p')).find((p) => p.textContent?.includes('a1a1a1a1'));
    expect(hashLine?.textContent).toContain('b2b2b2b2');
    expect(hashLine?.className).toContain('text-muted');
    expect(hashLine?.className).toContain('text-[10px]');
    expect(card.textContent).not.toContain('需要重新分析');
    unmount();
  });

  it('舊版標記沒有 headSha：說明沒有記錄分析時的 commit，不顯示 hash 行', () => {
    const { card, unmount } = mount(stale({ sharedHeadSha: null }));
    expect(card.textContent).toContain('沒有記錄分析時的 commit');
    expect(card.textContent).not.toContain('又有新的 commit');
    expect(card.querySelector('p.font-mono')).toBeNull();
    unmount();
  });

  it('「重新分析」是可按的按鈕，觸發與「分析」相同的 onAnalyze', () => {
    const { button, onAnalyze, unmount } = mount(stale());
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(false);
    act(() => button!.click());
    expect(onAnalyze).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('分析中時「重新分析」停用', () => {
    const { button, unmount } = mount(stale(), { isLoading: true });
    expect(button?.disabled).toBe(true);
    unmount();
  });
});
