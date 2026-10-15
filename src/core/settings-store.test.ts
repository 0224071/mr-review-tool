import { describe, expect, it } from 'vitest';
import {
  clearProviderKey,
  getProviderSettings,
  getProviderSetupNotice,
  isProviderReady,
  loadSettings,
  saveSettings,
  setProviderSettings,
  SETTINGS_STORAGE_KEY,
} from './settings-store';
import { DEFAULT_SETTINGS } from '../types/settings';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('settings-store（localStorage 讀寫清除）', () => {
  it('沒有設定時預設 Gemini 且尚未就緒（與舊版行為相同）', () => {
    const s = loadSettings(memoryStorage());
    expect(s.llmProvider).toBe('gemini');
    expect(s.geminiModel).toBe('gemini-3.8-flash');
    expect(isProviderReady(s)).toBe(false);
  });

  it('舊版只有 Gemini 欄位的設定可直接讀取並補齊其他 provider 預設值', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ geminiApiKey: 'AIza-old', geminiModel: 'gemini-3.1-pro-preview', gitlabToken: 't' }),
    });
    const s = loadSettings(storage);
    expect(s.llmProvider).toBe('gemini');
    expect(getProviderSettings(s)).toEqual({ apiKey: 'AIza-old', model: 'gemini-3.1-pro-preview' });
    expect(s.providerSettings.anthropic.model).toBe(DEFAULT_SETTINGS.providerSettings.anthropic.model);
    expect(isProviderReady(s)).toBe(true);
  });

  it('不認得的 provider 值回到 gemini；壞掉的 JSON 回到預設值', () => {
    expect(loadSettings(memoryStorage({ [SETTINGS_STORAGE_KEY]: '{"llmProvider":"nope"}' })).llmProvider).toBe('gemini');
    expect(loadSettings(memoryStorage({ [SETTINGS_STORAGE_KEY]: '{oops' })).llmProvider).toBe('gemini');
  });

  it('寫入後可讀回各 provider 設定，部分欄位缺漏時補預設', () => {
    const storage = memoryStorage();
    let s = setProviderSettings(loadSettings(storage), 'openrouter', { apiKey: 'sk-or-1', model: 'x/y' });
    s = { ...s, llmProvider: 'openrouter' };
    saveSettings(s, storage);
    const back = loadSettings(storage);
    expect(back.llmProvider).toBe('openrouter');
    expect(getProviderSettings(back)).toMatchObject({ apiKey: 'sk-or-1', model: 'x/y', title: 'GitLab MR Review Tool' });
  });

  it('清除 key 只清掉該 provider，並立即寫回 storage', () => {
    const storage = memoryStorage();
    let s = setProviderSettings(DEFAULT_SETTINGS, 'anthropic', { apiKey: 'sk-ant-1' });
    s = setProviderSettings(s, 'gemini', { apiKey: 'AIza-1' });
    saveSettings(s, storage);
    const cleared = clearProviderKey(s, 'anthropic', storage);
    expect(cleared.providerSettings.anthropic.apiKey).toBe('');
    expect(cleared.geminiApiKey).toBe('AIza-1');
    const raw = storage.data.get(SETTINGS_STORAGE_KEY)!;
    expect(raw).not.toContain('sk-ant-1');
    expect(raw).toContain('AIza-1');
    expect(clearProviderKey(cleared, 'gemini', storage).geminiApiKey).toBe('');
    expect(storage.data.get(SETTINGS_STORAGE_KEY)).not.toContain('AIza-1');
  });

  it('自訂 OpenAI 相容（Ollama）可不填 key，但需要 base URL 與 model', () => {
    const s = { ...DEFAULT_SETTINGS, llmProvider: 'custom' as const };
    expect(isProviderReady(s)).toBe(true);
    expect(isProviderReady(setProviderSettings(s, 'custom', { baseUrl: ' ' }))).toBe(false);
    expect(isProviderReady({ ...DEFAULT_SETTINGS, llmProvider: 'openai' })).toBe(false);
  });
});

describe('getProviderSetupNotice（分析按鈕下方的設定提示依目前 provider 顯示）', () => {
  it('預設 Gemini 未填 key', () => {
    expect(getProviderSetupNotice(DEFAULT_SETTINGS)).toBe('尚未設定 Google Gemini API Key');
  });

  it('選 OpenRouter 時顯示 OpenRouter，不再提 Gemini；即使 Gemini 已有 key', () => {
    const s = { ...DEFAULT_SETTINGS, llmProvider: 'openrouter' as const, geminiApiKey: 'gemini-key' };
    expect(getProviderSetupNotice(s)).toBe('尚未設定 OpenRouter API Key');
    expect(getProviderSetupNotice(setProviderSettings(s, 'openrouter', { apiKey: 'or-key' }))).toBeNull();
  });

  it('OpenAI／Anthropic 各自顯示自己的名稱', () => {
    expect(getProviderSetupNotice({ ...DEFAULT_SETTINGS, llmProvider: 'openai' })).toBe('尚未設定 OpenAI API Key');
    expect(getProviderSetupNotice({ ...DEFAULT_SETTINGS, llmProvider: 'anthropic' })).toBe('尚未設定 Anthropic Claude API Key');
  });

  it('有 key 但模型空白時提示模型', () => {
    const s = setProviderSettings({ ...DEFAULT_SETTINGS, llmProvider: 'openai' }, 'openai', { apiKey: 'k', model: ' ' });
    expect(getProviderSetupNotice(s)).toBe('尚未設定 OpenAI 模型');
  });

  it('自訂 provider 不需 key：預設設定即不顯示；Base URL 空白時才提示', () => {
    const s = { ...DEFAULT_SETTINGS, llmProvider: 'custom' as const };
    expect(getProviderSetupNotice(s)).toBeNull();
    expect(isProviderReady(s)).toBe(true);
    expect(getProviderSetupNotice(setProviderSettings(s, 'custom', { baseUrl: '' }))).toBe(
      '尚未設定 Ollama／自訂 OpenAI 相容 Base URL'
    );
  });
});
