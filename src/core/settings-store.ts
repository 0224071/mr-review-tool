/**
 * 設定的 localStorage 讀寫與 provider 設定存取（純函式，storage 可注入以便測試）。
 * 金鑰只寫入使用者瀏覽器 localStorage，不送往其他地方。
 */
import { PROVIDER_META } from '../providers/registry';
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
  return getProviderSetupNotice(settings, id) === null;
}

/**
 * 目前所選 provider 尚缺的設定，作為「分析」按鈕下方的提示文字；已可呼叫時回傳 null。
 * 不需要 key 的自訂 OpenAI 相容服務（Ollama）只檢查 Base URL 與模型。
 */
export function getProviderSetupNotice(settings: AppSettings, id: ProviderId = settings.llmProvider): string | null {
  const meta = PROVIDER_META[id];
  const cfg = getProviderSettings(settings, id);
  if (!meta.keyOptional && !cfg.apiKey?.trim()) return `尚未設定 ${meta.label} API Key`;
  if (meta.editableBaseUrl && !cfg.baseUrl?.trim()) return `尚未設定 ${meta.label} Base URL`;
  if (!cfg.model?.trim()) return `尚未設定 ${meta.label} 模型`;
  return null;
}
