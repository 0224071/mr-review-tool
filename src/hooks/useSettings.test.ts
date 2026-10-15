// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, actAsync } from './test-utils';
import { useSettings } from './useSettings';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { AiGateway, SettingsGateway } from '../app/app-services';
import type { AppSettings } from '../types/settings';

const makeGateway = (initial: AppSettings = DEFAULT_SETTINGS) => {
  const cleared: AppSettings = { ...initial, geminiApiKey: '' };
  const gateway: SettingsGateway = {
    load: vi.fn(() => initial),
    save: vi.fn(),
    clearKey: vi.fn(() => cleared),
    Dialog: () => null,
  };
  return { gateway, cleared };
};

/** 沒有 Gemini 金鑰時回提示，其餘視為可用 */
const ai: AiGateway = {
  setupNotice: (s) => (s.llmProvider === 'gemini' && !s.geminiApiKey ? '請先設定 Gemini 金鑰' : null),
  createProvider: () => {
    throw new Error('not used');
  },
};

describe('useSettings', () => {
  it('初始設定由 gateway.load() 讀取，只讀一次；provider 狀態由 ai.setupNotice 判斷', () => {
    const { gateway } = makeGateway({ ...DEFAULT_SETTINGS, geminiModel: '  gemini-x  ' });
    const { result, rerender } = renderHook(() => useSettings(gateway, ai), undefined);
    rerender(undefined);
    expect(gateway.load).toHaveBeenCalledTimes(1);
    expect(result.current.providerSetupNotice).toBe('請先設定 Gemini 金鑰');
    expect(result.current.providerReady).toBe(false);
    expect(result.current.currentProviderModel).toEqual({ provider: 'gemini', model: 'gemini-x' });
    expect(result.current.isSettingsOpen).toBe(false);
    expect(result.current.isSetupGuideOpen).toBe(false);
  });

  it('handleSaveSettings 更新狀態並交給 gateway 保存', async () => {
    const { gateway } = makeGateway();
    const { result } = renderHook(() => useSettings(gateway, ai), undefined);
    const next = { ...DEFAULT_SETTINGS, geminiApiKey: 'k' };
    await actAsync(() => result.current.handleSaveSettings(next));
    expect(gateway.save).toHaveBeenCalledWith(next);
    expect(result.current.settings).toBe(next);
    expect(result.current.providerReady).toBe(true);
  });

  it('handleClearProviderKey 以目前設定呼叫 clearKey，並套用回傳的設定', async () => {
    const withKey = { ...DEFAULT_SETTINGS, geminiApiKey: 'k' };
    const { gateway, cleared } = makeGateway(withKey);
    const { result } = renderHook(() => useSettings(gateway, ai), undefined);
    await actAsync(() => result.current.handleClearProviderKey('gemini'));
    expect(gateway.clearKey).toHaveBeenCalledWith(withKey, 'gemini');
    expect(result.current.settings).toBe(cleared);
    expect(result.current.providerReady).toBe(false);
  });

  it('openSettingsFromGuide 關閉引導並開啟設定', async () => {
    const { gateway } = makeGateway();
    const { result } = renderHook(() => useSettings(gateway, ai), undefined);
    await actAsync(() => result.current.setIsSetupGuideOpen(true));
    expect(result.current.isSetupGuideOpen).toBe(true);
    await actAsync(() => result.current.openSettingsFromGuide());
    expect(result.current.isSetupGuideOpen).toBe(false);
    expect(result.current.isSettingsOpen).toBe(true);
  });
});
