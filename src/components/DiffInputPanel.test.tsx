import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiffInputPanel } from './DiffInputPanel';
import { getProviderSetupNotice, setProviderSettings } from '../core/settings-store';
import { AppSettings, DEFAULT_SETTINGS } from '../types/settings';

const render = (settings: AppSettings) =>
  renderToStaticMarkup(
    <DiffInputPanel
      rawDiff=""
      onDiffChange={() => {}}
      parsedDiff={{ files: [], totalAdditions: 0, totalDeletions: 0, fileCount: 0 }}
      onAnalyze={() => {}}
      onLoadSampleDiff={() => {}}
      onLoadSampleAnalysis={() => {}}
      isLoading={false}
      setupNotice={getProviderSetupNotice(settings)}
      onOpenSettings={() => {}}
      gitlabMrUrl=""
      onGitlabMrUrlChange={() => {}}
      onFetchGitLabMr={async () => {}}
      isFetchingGitLab={false}
      currentGitLabMr={null}
      staleSharedAnalysis={null}
      hasGitLabToken={false}
      gitlabError={null}
    />
  );

describe('DiffInputPanel 設定提示橫幅', () => {
  it('選 OpenRouter 未填 key：顯示 OpenRouter 而不是 Gemini', () => {
    const html = render({ ...DEFAULT_SETTINGS, llmProvider: 'openrouter', geminiApiKey: 'g' });
    expect(html).toContain('尚未設定 OpenRouter API Key');
    expect(html).not.toContain('Gemini');
  });

  it('預設 Gemini 未填 key 時仍提示 Gemini', () => {
    expect(render(DEFAULT_SETTINGS)).toContain('尚未設定 Google Gemini API Key');
  });

  it('OpenRouter 已填 key、或自訂 provider 不需 key 時不顯示橫幅', () => {
    const or = setProviderSettings({ ...DEFAULT_SETTINGS, llmProvider: 'openrouter' }, 'openrouter', { apiKey: 'k' });
    expect(render(or)).not.toContain('尚未設定');
    expect(render({ ...DEFAULT_SETTINGS, llmProvider: 'custom' })).not.toContain('尚未設定');
  });
});
