/**
 * Application Settings Schema
 * Pre-configured for Stage 1 (Gemini API key) and prepared for Stage 2 (GitLab config) & Stage 3 (Team rules).
 */
export interface AppSettings {
  // Gemini AI configuration
  geminiApiKey: string;
  geminiModel: string;

  // GitLab integration (Stage 2 preparation)
  gitlabBaseUrl: string;
  gitlabToken: string;

  // Custom team review guidelines / rules (Stage 3 preparation)
  teamRules: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  gitlabBaseUrl: 'https://gitlab.com',
  gitlabToken: '',
  teamRules: [
    '一則意見只講一件事',
    '建議寫成具體可執行的動作',
    '避免模糊用語（例如「可能需要考慮」）',
    '句子保持簡短明瞭（建議不超過 80 字）',
  ],
};
