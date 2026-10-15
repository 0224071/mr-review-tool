/**
 * 設定的 localStorage 讀寫與 provider 設定存取（純函式，storage 可注入以便測試）。
 * 金鑰只寫入使用者瀏覽器 localStorage，不送往其他地方。
 */
import { PROVIDER_IDS, ProviderId, ProviderSettings } from '../providers/types';
import { AppSettings, DEFAULT_SETTINGS, NonGeminiProviderId } from '../types/settings';

export const SETTINGS_STORAGE_KEY = 'gitlab_mr_reviewer_settings';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): StorageLike | undefined =>
  typeof localStorage !== 'undefined' ? localStorage : undefined;

/** 舊版設定（只有 Gemini 欄位）或部分欄位缺漏時補上預設值 */
export function normalizeSettings(raw: unknown): AppSettings {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppSettings>;
  const storedProviders = (stored.providerSettings ?? {}) as Partial<Record<NonGeminiProviderId, Partial<ProviderSettings>>>;
  const providerSettings = { ...DEFAULT_SETTINGS.providerSettings };
  for (const id of Object.keys(providerSettings) as NonGeminiProviderId[]) {
    providerSettings[id] = { ...DEFAULT_SETTINGS.providerSettings[id], ...(storedProviders[id] ?? {}) };
  }
  const llmProvider = PROVIDER_IDS.includes(stored.llmProvider as ProviderId)
    ? (stored.llmProvider as ProviderId)
    : 'gemini';
  return { ...DEFAULT_SETTINGS, ...stored, llmProvider, providerSettings };
}

export function loadSettings(storage: StorageLike | undefined = defaultStorage()): AppSettings {
  try {
    const stored = storage?.getItem(SETTINGS_STORAGE_KEY);
    if (stored) return normalizeSettings(JSON.parse(stored));
  } catch {
    // ignore
  }
  return normalizeSettings({});
}

export function saveSettings(settings: AppSettings, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function getProviderSettings(settings: AppSettings, id: ProviderId = settings.llmProvider): ProviderSettings {
  if (id === 'gemini') return { apiKey: settings.geminiApiKey || '', model: settings.geminiModel || '' };
  return settings.providerSettings[id];
}

export function setProviderSettings(
  settings: AppSettings,
  id: ProviderId,
  patch: Partial<ProviderSettings>
): AppSettings {
  if (id === 'gemini') {
    return {
      ...settings,
      ...(patch.apiKey !== undefined ? { geminiApiKey: patch.apiKey } : {}),
      ...(patch.model !== undefined ? { geminiModel: patch.model } : {}),
    };
  }
  return {
    ...settings,
    providerSettings: { ...settings.providerSettings, [id]: { ...settings.providerSettings[id], ...patch } },
  };
}

/** 清除某個 provider 的 key 並立即寫回 localStorage */
export function clearProviderKey(
  settings: AppSettings,
  id: ProviderId,
  storage: StorageLike | undefined = defaultStorage()
): AppSettings {
  const next = setProviderSettings(settings, id, { apiKey: '' });
  saveSettings(next, storage);
  return next;
}

/** 目前所選 provider 是否已可呼叫（自訂 OpenAI 相容服務可不填 key） */
export function isProviderReady(settings: AppSettings, id: ProviderId = settings.llmProvider): boolean {
  const cfg = getProviderSettings(settings, id);
  if (!cfg.model?.trim()) return false;
  if (id === 'custom') return Boolean(cfg.baseUrl?.trim());
  return Boolean(cfg.apiKey?.trim());
}
