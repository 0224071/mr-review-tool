/**
 * 示範模式服務：AI 與 GitLab 皆為假實作（零網路請求），設定只放記憶體（不讀寫 localStorage），
 * 歷史紀錄為 no-op（不寫 IndexedDB）。輸入區預先載入範例 diff；已在示範中，空白首頁不顯示「用範例試試看」。
 */
import React from 'react';
import type { AppServices } from '../app/app-services';
import { setProviderSettings } from '../core/settings-store';
import { SAMPLE_GIT_DIFF } from '../services/diff-sources/sample-diffs';
import { DEFAULT_SETTINGS } from '../types/settings';
import { DemoBanner } from './DemoBanner';
import { DEMO_HOME_HINT } from './demo-mode';
import { createDemoSettingsDialog } from './DemoSettingsDialog';
import { createDemoProvider } from './fake-provider';
import { createDemoGitLabGateway } from './fake-publisher';
import { createNoopHistoryStore } from './noop-history-store';

export interface DemoServicesOptions {
  /** 「離開示範」 */
  onExit: () => void;
  /** 測試用：縮短假分析／假發布的等待 */
  analysisDelayMs?: number;
  publishDelayMs?: number;
}

export function createDemoServices(options: DemoServicesOptions): AppServices {
  const { onExit, analysisDelayMs, publishDelayMs } = options;
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
    homeHint: DEMO_HOME_HINT,
    banner: React.createElement(DemoBanner, { onExit }),
  };
}
