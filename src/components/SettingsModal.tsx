import React, { useState } from 'react';
import { Key, ShieldCheck, Server, Sparkles, CheckCircle2, AlertCircle, X, HelpCircle } from 'lucide-react';
import { AppSettings } from '../types/settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (newSettings: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [apiKey, setApiKey] = useState(settings.geminiApiKey);
  const [model, setModel] = useState(settings.geminiModel || 'gemini-3.8-flash');
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState(settings.gitlabBaseUrl || 'https://gitlab.com');
  const [gitlabToken, setGitlabToken] = useState(settings.gitlabToken || '');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [gitlabTestStatus, setGitlabTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [gitlabTestMsg, setGitlabTestMsg] = useState('');

  if (!isOpen) return null;

  const handleTestGitLabConnection = async () => {
    if (!gitlabToken.trim()) {
      setGitlabTestStatus('error');
      setGitlabTestMsg('請先填入 Personal Access Token');
      return;
    }
    setGitlabTestStatus('testing');
    setGitlabTestMsg('連線驗證中...');
    try {
      const cleanBase = (gitlabBaseUrl.trim() || 'https://gitlab.com').replace(/\/$/, '');
      const res = await fetch(`${cleanBase}/api/v4/user`, {
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': gitlabToken.trim(),
        },
      });

      if (res.ok) {
        const user = await res.json();
        setGitlabTestStatus('success');
        setGitlabTestMsg(`驗證成功！已連接帳號 @${user.username} (${user.name})`);
      } else {
        const err = await res.text();
        setGitlabTestStatus('error');
        setGitlabTestMsg(`連線失敗 (${res.status})：Token 無效或無權限`);
      }
    } catch {
      setGitlabTestStatus('error');
      setGitlabTestMsg('連線失敗：請檢查 Base URL 與網路');
    }
  };

  const handleSave = () => {
    onSave({
      ...settings,
      geminiApiKey: apiKey.trim(),
      geminiModel: model,
      gitlabBaseUrl: gitlabBaseUrl.trim() || 'https://gitlab.com',
      gitlabToken: gitlabToken.trim(),
    });
    onClose();
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestStatus('error');
      setTestMessage('請先填入 Gemini API Key');
      return;
    }
    setTestStatus('testing');
    setTestMessage('連線測試中...');
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'ping' }] }],
          }),
        }
      );
      if (res.ok) {
        setTestStatus('success');
        setTestMessage('金鑰驗證成功！可正常呼叫 Gemini API。');
      } else {
        const errorText = await res.text();
        setTestStatus('error');
        setTestMessage(`驗證失敗 (${res.status})：請檢查金鑰是否有誤。`);
      }
    } catch (e: unknown) {
      setTestStatus('error');
      setTestMessage('網路請求失敗，請檢查網路連線。');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">偏好與整合設定</h2>
              <p className="text-xs text-slate-500">所有金鑰僅保存在本機瀏覽器 localStorage，不經後端</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Gemini API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                Gemini API Key <span className="text-rose-500">*</span>
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-600 hover:text-indigo-700 underline flex items-center gap-0.5"
              >
                取得免費 API Key
              </a>
            </div>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestStatus('idle');
                }}
                placeholder="貼上 AI Studio API Key (AIzaSy...)"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestKey}
                disabled={testStatus === 'testing' || !apiKey.trim()}
                className="text-xs px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50 transition-colors font-medium"
              >
                {testStatus === 'testing' ? '測試中...' : '測試金鑰連線'}
              </button>
              {testStatus === 'success' && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {testMessage}
                </span>
              )}
              {testStatus === 'error' && (
                <span className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {testMessage}
                </span>
              )}
            </div>
          </div>

          {/* Model Selection */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">選擇 Gemini 模型</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              <option value="gemini-3.8-flash">gemini-3.8-flash（速度極快、品質優異，推薦）</option>
              <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview（深度程式碼架構推理）</option>
            </select>
          </div>

          {/* Security Notice */}
          <div className="p-3 bg-emerald-50/70 border border-emerald-200/60 rounded-lg flex items-start gap-2 text-xs text-emerald-800">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">完全本機隱私保護：</span>
              您的 API Key、GitLab Token 與 Git Diff 僅存於此瀏覽器的 LocalStorage，絕不經過任何自建後端伺服器。
            </div>
          </div>

          {/* GitLab Settings */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-orange-500" />
                GitLab 連線設定 (第二階段生效)
              </span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                REST API v4 & Discussions
              </span>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="text-xs text-slate-600 block mb-1">GitLab Base URL</label>
                <input
                  type="text"
                  value={gitlabBaseUrl}
                  onChange={(e) => {
                    setGitlabBaseUrl(e.target.value);
                    setGitlabTestStatus('idle');
                  }}
                  placeholder="https://gitlab.com 或公司自建 GitLab 域名"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-600">Personal Access Token (PAT)</label>
                  <a
                    href={`${gitlabBaseUrl.replace(/\/$/, '')}/-/user_settings/personal_access_tokens`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 underline"
                  >
                    前往 GitLab 產生 Token (需 api 權限)
                  </a>
                </div>
                <input
                  type="password"
                  value={gitlabToken}
                  onChange={(e) => {
                    setGitlabToken(e.target.value);
                    setGitlabTestStatus('idle');
                  }}
                  placeholder="glpat-..."
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:border-indigo-500 focus:outline-none font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  用於抓取私有 MR Diff、讀取共享分析筆記，以及直接將審查意見透過 Discussions API 發布至 MR。
                </p>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleTestGitLabConnection}
                  disabled={gitlabTestStatus === 'testing' || !gitlabToken.trim()}
                  className="text-xs px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50 transition-colors font-medium"
                >
                  {gitlabTestStatus === 'testing' ? '驗證中...' : '測試 GitLab 連線'}
                </button>
                {gitlabTestStatus === 'success' && (
                  <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {gitlabTestMsg}
                  </span>
                )}
                {gitlabTestStatus === 'error' && (
                  <span className="text-xs text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {gitlabTestMsg}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* About / System Info */}
          <div className="border-t border-slate-100 pt-4 space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              關於本工具
            </span>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-slate-800 flex items-center gap-2">
                <span>GitLab MR 講解與審查工具</span>
                <span className="text-[10px] bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded font-bold">Phase 2</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                GitLab REST API v4 · 意圖分組 · Dagre 結構圖 · Discussions 行內審查發布 · 免 Key 共享
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-lg transition-colors font-medium"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-xs font-medium transition-colors"
          >
            儲存設定
          </button>
        </div>
      </div>
    </div>
  );
};
