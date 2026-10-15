/**
 * 示範模式服務：AI 與 GitLab 皆為假實作（零網路請求），設定只放記憶體（不讀寫 localStorage），
 * 歷史紀錄為 no-op（不寫 IndexedDB）。左欄預先載入範例 diff。
 */
import React from 'react';
import type { AppServices } from '../app/app-services';
import { setProviderSettings } from '../core/settings-store';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { DEFAULT_SETTINGS } from '../types/settings';
import { DemoBanner } from './DemoBanner';
import { createDemoSettingsDialog } from './DemoSettingsDialog';
import { createDemoProvider } from './fake-provider';
import { createDemoGitLabGateway } from './fake-publisher';
import { createNoopHistoryStore } from './noop-history-store';

export interface DemoServicesOptions {
  /** 「離開示範」 */
  onExit: () => void;
  /** 「用範例試試看」：重新開始示範 */
  onRestart: () => void;
  /** 測試用：縮短假分析／假發布的等待 */
  analysisDelayMs?: number;
  publishDelayMs?: number;
}

export function createDemoServices(options: DemoServicesOptions): AppServices {
  const { onExit, onRestart, analysisDelayMs, publishDelayMs } = options;
  return {
    settings: {
      load: () => structuredClone(DEFAULT_SETTINGS),
      save: () => {},
      clearKey: (settings, id) => setProviderSettings(settings, id, { apiKey: '' }),
      Dialog: createDemoSettingsDialog(onExit),
    },
    ai: {
      setupNotice: () => null,
      createProvider: () => createDemoProvider({ delayMs: analysisDelayMs }),
    },
    gitlab: createDemoGitLabGateway({ delayMs: publishDelayMs }),
    openHistoryStore: async () => createNoopHistoryStore(),
    initialRawDiff: SAMPLE_GIT_DIFF,
    homeHint: '左側已載入購物車範例 diff，按「分析」看看審查結果，再試著模擬發布到 MR。',
    banner: React.createElement(DemoBanner, { onExit }),
    onTryDemo: onRestart,
  };
}
