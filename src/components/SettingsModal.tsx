import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Key,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AppSettings } from '../types/settings';
import { getLlmMixedContentWarning, getMixedContentWarning } from '../core/mixed-content';
import { getProviderSettings, setProviderSettings } from '../core/settings-store';
import { createProvider, PROVIDER_META } from '../providers/registry';
import { describeOpenRouterCredit } from '../providers/openai-compatible';
import { verifyGitlabToken } from '../services/gitlab-api';
import { ModelInfo, OpenRouterKeyInfo, PROVIDER_IDS, ProviderId, ProviderSettings } from '../providers/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
  /** 立即從 localStorage 清除某個 provider 的金鑰 */
  onClearKey: (id: ProviderId) => void;
}

type TestStatus = { state: 'idle' | 'testing' | 'success' | 'error'; message: string };
const IDLE: TestStatus = { state: 'idle', message: '' };

const inputClass =
  'w-full px-3 py-1.5 text-xs border border-surface-border rounded-md bg-surface text-ink focus:border-primary focus:ring-2 focus:ring-primary-border focus:outline-none';
const secondaryButtonClass =
  'text-xs px-2.5 py-1.5 rounded bg-surface-muted hover:bg-surface-border text-muted-dark disabled:opacity-50 transition-colors font-medium inline-flex items-center gap-1';

const StatusLine: React.FC<{ status: TestStatus }> = ({ status }) => {
  if (status.state === 'success') {
    return (
      <p className="text-xs text-success-text flex items-start gap-1">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {status.message}
      </p>
    );
  }
  if (status.state === 'error') {
    return (
      <p className="text-xs text-danger-text flex items-start gap-1 break-all">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {status.message}
      </p>
    );
  }
  if (status.state === 'testing') return <p className="text-xs text-muted">{status.message}</p>;
  return null;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
  onClearKey,
}) => {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [modelLists, setModelLists] = useState<Partial<Record<ProviderId, ModelInfo[]>>>({});
  const [keyInfos, setKeyInfos] = useState<Partial<Record<ProviderId, OpenRouterKeyInfo>>>({});
  const [freeOnly, setFreeOnly] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>(IDLE);
  const [gitlabTestStatus, setGitlabTestStatus] = useState<TestStatus>(IDLE);

  // 每次開啟時以目前設定為草稿
  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setTestStatus(IDLE);
      setGitlabTestStatus(IDLE);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const providerId = draft.llmProvider;
  const meta = PROVIDER_META[providerId];
  const cfg = getProviderSettings(draft, providerId);
  const models = modelLists[providerId] ?? [];
  const freeCount = models.filter((m) => m.free).length;
  const visibleModels = freeOnly && freeCount > 0 ? models.filter((m) => m.free) : models;
  const currentModelFree =
    providerId === 'openrouter' &&
    (cfg.model.trim().endsWith(':free') || models.some((m) => m.id === cfg.model.trim() && m.free));
  const keyInfo = providerId === 'openrouter' ? keyInfos.openrouter : undefined;
  const credit = keyInfo ? describeOpenRouterCredit(keyInfo) : null;
  const llmMixedContentWarning = meta.editableBaseUrl ? getLlmMixedContentWarning(cfg.baseUrl ?? '') : null;
  const gitlabMixedContentWarning = getMixedContentWarning(draft.gitlabBaseUrl);

  const updateProvider = (patch: Partial<ProviderSettings>) => {
    setDraft((prev) => setProviderSettings(prev, providerId, patch));
    setTestStatus(IDLE);
  };

  const handleSelectProvider = (id: ProviderId) => {
    setDraft((prev) => ({ ...prev, llmProvider: id }));
    setTestStatus(IDLE);
  };

  const handleClearKey = () => {
    updateProvider({ apiKey: '' });
    onClearKey(providerId);
    setTestStatus({ state: 'success', message: `已從此瀏覽器清除 ${meta.label} 的 API Key。` });
  };

  /** 測試連線：打需要驗證 key 的 endpoint（不耗用生成額度），成功時順便更新模型下拉清單 */
  const handleTestConnection = async () => {
    if (!meta.keyOptional && !cfg.apiKey.trim()) {
      setTestStatus({ state: 'error', message: `請先填入 ${meta.label} API Key` });
      return;
    }
    setTestStatus({ state: 'testing', message: '連線測試中...' });
    try {
      const { models: list, keyVerified, keyInfo: info } = await createProvider(providerId, cfg).testConnection();
      setModelLists((prev) => ({ ...prev, [providerId]: list }));
      if (info) setKeyInfos((prev) => ({ ...prev, [providerId]: info }));
      const hasModel = !cfg.model.trim() || list.length === 0 || list.some((m) => m.id === cfg.model.trim());
      setTestStatus({
        state: 'success',
        message: `${
          keyVerified ? '連線成功，API Key 有效' : '已連線（此服務的 /models 不一定檢查 API Key，無法確認 key 是否正確）'
        }，取得 ${list.length} 個模型。${
          hasModel ? '' : `注意：清單中沒有目前填寫的「${cfg.model}」，請確認 model id。`
        }`,
      });
    } catch (err: unknown) {
      setKeyInfos((prev) => ({ ...prev, [providerId]: undefined }));
      setTestStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleTestGitLabConnection = async () => {
    if (!draft.gitlabToken.trim()) {
      setGitlabTestStatus({ state: 'error', message: '請先填入 Personal Access Token' });
      return;
    }
    if (gitlabMixedContentWarning) {
      setGitlabTestStatus({ state: 'error', message: gitlabMixedContentWarning });
      return;
    }
    setGitlabTestStatus({ state: 'testing', message: '連線驗證中...' });
    try {
      const user = await verifyGitlabToken(draft.gitlabBaseUrl, draft.gitlabToken);
      setGitlabTestStatus({ state: 'success', message: `驗證成功！已連接帳號 @${user.username} (${user.name})` });
    } catch (err: unknown) {
      setGitlabTestStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSave = () => {
    const trimmed = setProviderSettings(draft, providerId, {
      apiKey: cfg.apiKey.trim(),
      model: cfg.model.trim() || meta.defaultModel,
      ...(meta.editableBaseUrl ? { baseUrl: (cfg.baseUrl ?? '').trim() || meta.defaultBaseUrl } : {}),
    });
    onSave({
      ...trimmed,
      gitlabBaseUrl: draft.gitlabBaseUrl.trim() || 'https://gitlab.com',
      gitlabToken: draft.gitlabToken.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-surface rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-surface-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border bg-surface-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary-subtle text-primary">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">偏好與整合設定</h2>
              <p className="text-xs text-muted">所有金鑰僅保存在本機瀏覽器 localStorage，不經後端</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="text-muted-light hover:text-muted-dark p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Provider selection */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-dark flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary" />
              AI 模型供應商
            </span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="AI 模型供應商">
              {PROVIDER_IDS.map((id) => {
                const active = id === providerId;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleSelectProvider(id)}
                    className={`text-xs px-2.5 py-1.5 rounded-md border font-medium transition-colors ${
                      active
                        ? 'bg-primary-subtle border-primary-border text-primary'
                        : 'bg-surface border-surface-border text-muted-dark hover:bg-surface-subtle'
                    }`}
                  >
                    {PROVIDER_META[id].label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted">只會呼叫所選的供應商；失敗時不會自動改用其他家。</p>
          </div>

          {/* Provider config */}
          <div className="space-y-3 p-3 rounded-lg border border-surface-border bg-surface-subtle">
            {/* API Key */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="llm-api-key" className="text-xs font-medium text-muted-dark">
                  {meta.label} API Key{meta.keyOptional ? '（選填）' : <span className="text-danger"> *</span>}
                </label>
                {meta.keyUrl && (
                  <a
                    href={meta.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary hover:text-primary-hover underline"
                  >
                    取得 API Key
                  </a>
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  id="llm-api-key"
                  type="password"
                  autoComplete="off"
                  value={cfg.apiKey}
                  onChange={(e) => updateProvider({ apiKey: e.target.value })}
                  placeholder={meta.keyPlaceholder}
                  className={`${inputClass} font-mono`}
                />
                <button
                  type="button"
                  onClick={handleClearKey}
                  disabled={!cfg.apiKey}
                  className="shrink-0 text-xs px-2 rounded-md border border-surface-border text-danger-text hover:bg-danger-subtle disabled:opacity-40 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  清除 key
                </button>
              </div>
            </div>

            {/* Base URL：只有 OpenAI 相容自訂可改 */}
            {meta.editableBaseUrl && (
              <div className="space-y-1">
                <label htmlFor="llm-base-url" className="text-xs font-medium text-muted-dark">
                  Base URL（OpenAI 相容）
                </label>
                <input
                  id="llm-base-url"
                  type="text"
                  value={cfg.baseUrl ?? ''}
                  onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                  placeholder={meta.defaultBaseUrl}
                  className={`${inputClass} font-mono`}
                />
                <p className="text-[11px] text-muted">
                  Ollama 需以 <code className="font-mono">OLLAMA_ORIGINS</code> 允許此網頁來源，例如{' '}
                  <code className="font-mono">OLLAMA_ORIGINS=&quot;*&quot; ollama serve</code>。
                </p>
                {llmMixedContentWarning && (
                  <p className="text-[11px] text-warning-text flex items-start gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    {llmMixedContentWarning}
                  </p>
                )}
              </div>
            )}

            {/* OpenRouter optional headers */}
            {providerId === 'openrouter' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="or-referer" className="text-xs text-muted-dark">HTTP-Referer（選填）</label>
                  <input
                    id="or-referer"
                    type="text"
                    value={cfg.referer ?? ''}
                    onChange={(e) => updateProvider({ referer: e.target.value })}
                    placeholder="https://your-site.example"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="or-title" className="text-xs text-muted-dark">X-Title（選填，限英數）</label>
                  <input
                    id="or-title"
                    type="text"
                    value={cfg.title ?? ''}
                    onChange={(e) => updateProvider({ title: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {/* Model */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="llm-model" className="text-xs font-medium text-muted-dark flex items-center gap-1.5">
                  模型
                  {currentModelFree && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success-subtle text-success-text border border-success-border font-medium">
                      免費
                    </span>
                  )}
                </label>
                {freeCount > 0 && (
                  <label className="text-[11px] text-muted-dark flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
                    只看免費（{freeCount}）
                  </label>
                )}
              </div>
              {models.length > 0 && (
                <select
                  aria-label="從清單選擇模型"
                  value={visibleModels.some((m) => m.id === cfg.model) ? cfg.model : ''}
                  onChange={(e) => e.target.value && updateProvider({ model: e.target.value })}
                  className={inputClass}
                >
                  <option value="">
                    從 /models 清單選擇（{visibleModels.length} 個{freeCount > 0 ? `，其中免費 ${freeCount} 個` : ''}）
                  </option>
                  {visibleModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.free ? `【免費】${m.id}` : m.id}
                    </option>
                  ))}
                </select>
              )}
              <input
                id="llm-model"
                type="text"
                value={cfg.model}
                onChange={(e) => updateProvider({ model: e.target.value })}
                placeholder={`手動輸入 model id，例如 ${meta.defaultModel}`}
                className={`${inputClass} font-mono`}
              />
              {models.length === 0 && (
                <p className="text-[11px] text-muted">按「測試連線」可從 /models 取得模型清單，或直接手動輸入 model id。</p>
              )}
              {currentModelFree && (
                <p className="text-[11px] text-muted">
                  免費模型有每分鐘／每日請求上限，部分供應商可能記錄 prompt；送出公司程式碼前請確認 OpenRouter 的隱私設定。
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testStatus.state === 'testing'}
                className={secondaryButtonClass}
              >
                <RefreshCw className={`w-3 h-3 ${testStatus.state === 'testing' ? 'animate-spin' : ''}`} />
                {testStatus.state === 'testing' ? '測試中...' : '測試連線'}
              </button>
            </div>
            {meta.editableBaseUrl && (
              <p className="text-[11px] text-muted">
                自訂服務的「測試連線」只呼叫 /models（best-effort），Ollama 等服務通常不檢查 API Key，成功不代表 key 正確。
              </p>
            )}
            <StatusLine status={testStatus} />
            {credit && testStatus.state === 'success' && (
              <p
                className={`text-xs flex items-start gap-1 ${credit.warn ? 'text-warning-text' : 'text-muted'}`}
                data-testid="openrouter-credit"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {credit.message}
              </p>
            )}
          </div>

          {/* Security Notice */}
          <div className="p-3 bg-success-subtle border border-success-border rounded-lg flex items-start gap-2 text-xs text-success-text">
            <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">完全本機隱私保護：</span>
              API Key 與 GitLab Token 只存於此瀏覽器的 localStorage；金鑰只會直接送往你所選的模型服務，不經過任何自建後端。
            </div>
          </div>

          {/* GitLab Settings */}
          <div className="border-t border-surface-border pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-gitlab" />
                GitLab 連線設定 (第二階段生效)
              </span>
              <span className="text-[10px] bg-success-subtle text-success-text border border-success-border px-2 py-0.5 rounded-full font-medium">
                REST API v4 & Discussions
              </span>
            </div>

            <div className="space-y-2.5">
              <div>
                <label htmlFor="gitlab-base-url" className="text-xs text-muted-dark block mb-1">
                  GitLab Base URL
                </label>
                <input
                  id="gitlab-base-url"
                  type="text"
                  value={draft.gitlabBaseUrl}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, gitlabBaseUrl: e.target.value }));
                    setGitlabTestStatus(IDLE);
                  }}
                  placeholder="https://gitlab.com 或公司自建 GitLab 域名"
                  className={inputClass}
                />
                {gitlabMixedContentWarning && (
                  <p className="mt-1 text-[11px] text-warning-text flex items-start gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    {gitlabMixedContentWarning}
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="gitlab-token" className="text-xs text-muted-dark">
                    Personal Access Token (PAT)
                  </label>
                  <a
                    href={`${draft.gitlabBaseUrl.replace(/\/$/, '')}/-/user_settings/personal_access_tokens`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary hover:text-primary-hover underline"
                  >
                    前往 GitLab 產生 Token
                  </a>
                </div>
                <input
                  id="gitlab-token"
                  type="password"
                  autoComplete="off"
                  value={draft.gitlabToken}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, gitlabToken: e.target.value }));
                    setGitlabTestStatus(IDLE);
                  }}
                  placeholder="glpat-..."
                  className={`${inputClass} font-mono`}
                />
                <p className="text-[11px] text-muted-light mt-1">
                  用於抓取私有 MR Diff、讀取共享分析筆記，以及直接將審查意見透過 Discussions API 發布至 MR。
                </p>
                <p className="text-[11px] text-muted-light mt-1">
                  權限：只做分析給 <code>read_api</code> 即可；要把審查意見發布成 MR 留言才需要 <code>api</code>。
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleTestGitLabConnection}
                  disabled={gitlabTestStatus.state === 'testing' || !draft.gitlabToken.trim()}
                  className={secondaryButtonClass}
                >
                  {gitlabTestStatus.state === 'testing' ? '驗證中...' : '測試 GitLab 連線'}
                </button>
              </div>
              <StatusLine status={gitlabTestStatus} />
            </div>
          </div>

          {/* About / System Info */}
          <div className="border-t border-surface-border pt-4 space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-dark flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              關於本工具
            </span>
            <div className="p-3 bg-surface-subtle border border-surface-border rounded-lg text-xs space-y-1">
              <div className="font-semibold text-ink flex items-center gap-2">
                <span>GitLab MR 講解與審查工具</span>
                <span className="text-[10px] bg-gitlab-subtle text-gitlab-hover px-1.5 py-0.5 rounded font-bold">Phase 2</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                GitLab REST API v4 · 意圖分組 · Dagre 結構圖 · Discussions 行內審查發布 · 免 Key 共享
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-surface-subtle border-t border-surface-border flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-dark hover:text-ink rounded-lg transition-colors font-medium"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 text-sm bg-primary hover:bg-primary-hover text-surface rounded-lg shadow-xs font-medium transition-colors"
          >
            儲存設定
          </button>
        </div>
      </div>
    </div>
  );
};
