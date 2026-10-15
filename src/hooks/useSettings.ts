/**
 * 設定狀態：目前設定、provider 是否可用，以及設定對話框與「尚未設定金鑰」引導的開關。
 * 讀寫透過注入的 SettingsGateway／AiGateway，不分辨正式或示範模式。
 */
import { useState } from 'react';
import { getProviderSettings } from '../core/settings-store';
import { ProviderId } from '../providers/types';
import { AppSettings } from '../types/settings';
import type { AiGateway, SettingsGateway } from '../app/app-services';

export function useSettings(settingsGateway: SettingsGateway, ai: AiGateway) {
  const [settings, setSettings] = useState<AppSettings>(() => settingsGateway.load());
  const providerSetupNotice = ai.setupNotice(settings);
  const providerReady = providerSetupNotice === null;
  /** 目前所選 provider / model，作為快取 key 的一部分 */
  const currentProviderModel = {
    provider: settings.llmProvider,
    model: getProviderSettings(settings).model.trim(),
  };

  /** 尚未設定金鑰就按「分析」時顯示的引導 */
  const [isSetupGuideOpen, setIsSetupGuideOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    settingsGateway.save(newSettings);
  };

  /** 「清除 key」：立即移除該 provider 的金鑰 */
  const handleClearProviderKey = (id: ProviderId) => {
    setSettings(settingsGateway.clearKey(settings, id));
  };

  const openSettingsFromGuide = () => {
    setIsSetupGuideOpen(false);
    setIsSettingsOpen(true);
  };

  return {
    settings,
    providerSetupNotice,
    providerReady,
    currentProviderModel,
    isSetupGuideOpen,
    setIsSetupGuideOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    handleSaveSettings,
    handleClearProviderKey,
    openSettingsFromGuide,
  };
}

export type SettingsState = ReturnType<typeof useSettings>;
