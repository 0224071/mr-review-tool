/**
 * 正式版服務：設定存 localStorage、呼叫使用者所選的 provider 與 GitLab API、歷史紀錄存 IndexedDB。
 */
import { SettingsModal } from '../components/SettingsModal';
import { openHistoryStore } from '../core/history-store';
import {
  clearProviderKey,
  getProviderSettings,
  getProviderSetupNotice,
  loadSettings,
  saveSettings,
} from '../core/settings-store';
import { createProvider } from '../providers/registry';
import {
  createGitLabNote,
  fetchGitLabMergeRequest,
  fetchGitLabMrNotes,
  fetchGitLabMrRawDiff,
  parseGitLabMrUrl,
  postSharedAnalysisToMr,
  updateGitLabNote,
} from '../services/gitlab-api';
import { publishReviewBatch } from '../services/review-publisher';
import { AppServices, GitLabGateway } from './app-services';

export const liveGitLabGateway: GitLabGateway = {
  isConfigured: (settings) => !!settings.gitlabToken,
  resolveTarget: (mrUrl, settings) => {
    if (!mrUrl.trim()) throw new Error('請先輸入或指定目標 GitLab MR 網址');
    const parsed = parseGitLabMrUrl(mrUrl, settings.gitlabBaseUrl || 'https://gitlab.com');
    return { ...parsed, token: settings.gitlabToken };
  },
  fetchMergeRequest: (t) => fetchGitLabMergeRequest(t.baseUrl, t.token, t.projectPath, t.mrIid),
  fetchRawDiff: (t) => fetchGitLabMrRawDiff(t.baseUrl, t.token, t.projectPath, t.mrIid),
  fetchNotes: (t) => fetchGitLabMrNotes(t.baseUrl, t.token, t.projectPath, t.mrIid),
  createNote: (t, body) => createGitLabNote(t.baseUrl, t.token, t.projectPath, t.mrIid, body),
  updateNote: (t, noteId, body) => updateGitLabNote(t.baseUrl, t.token, t.projectPath, t.mrIid, noteId, body),
  shareAnalysis: (t, result, targetNoteId) =>
    postSharedAnalysisToMr(t.baseUrl, t.token, t.projectPath, t.mrIid, result, targetNoteId),
  publishBatch: publishReviewBatch,
};

export function createLiveServices(options: { onTryDemo: () => void }): AppServices {
  return {
    settings: {
      load: () => loadSettings(),
      save: (settings) => saveSettings(settings),
      clearKey: (settings, id) => clearProviderKey(settings, id),
      Dialog: SettingsModal,
    },
    ai: {
      setupNotice: (settings) => getProviderSetupNotice(settings),
      // 只建立使用者所選的 provider，失敗時不自動改用其他家
      createProvider: (settings) => createProvider(settings.llmProvider, getProviderSettings(settings)),
    },
    gitlab: liveGitLabGateway,
    openHistoryStore: () => openHistoryStore(),
    initialRawDiff: '',
    homeHint: '在輸入區填入 GitLab MR 網址抓取，或貼上 git diff；點擊「分析」開始。',
    banner: null,
    onTryDemo: options.onTryDemo,
  };
}
