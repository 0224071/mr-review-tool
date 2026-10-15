import { DiffPayload, IDiffSource } from '../../types/sources';
import { fetchGitLabMergeRequest, fetchGitLabMrRawDiff, parseGitLabMrUrl } from '../gitlab-api';

export interface GitLabSourceOptions {
  mrUrl: string;
  baseUrl?: string;
  token?: string;
}

export class GitLabDiffSource implements IDiffSource {
  readonly id = 'gitlab' as const;
  readonly name = 'GitLab MR 網址';
  readonly description = '輸入 GitLab MR 網址，透過 REST API v4 取得變更 Diff 與資訊';

  async getDiff(options?: Record<string, unknown>): Promise<DiffPayload> {
    const mrUrl = typeof options?.mrUrl === 'string' ? options.mrUrl : '';
    if (!mrUrl) {
      throw new Error('請提供 GitLab MR 網址');
    }

    const customBaseUrl = typeof options?.baseUrl === 'string' ? options.baseUrl : 'https://gitlab.com';
    const token = typeof options?.token === 'string' ? options.token : '';

    const { baseUrl, projectPath, mrIid } = parseGitLabMrUrl(
      mrUrl,
      customBaseUrl
    );

    // Fetch MR metadata
    const mrInfo = await fetchGitLabMergeRequest(baseUrl, token, projectPath, mrIid);

    // Fetch raw diff
    const rawDiff = await fetchGitLabMrRawDiff(baseUrl, token, projectPath, mrIid);

    return {
      rawDiff,
      sourceType: 'gitlab',
      metadata: {
        title: mrInfo.title,
        description: mrInfo.description,
        projectId: mrInfo.project_id || projectPath,
        mrIid: mrInfo.iid,
        mrUrl: mrInfo.web_url || mrUrl,
        branch: `${mrInfo.source_branch} → ${mrInfo.target_branch}`,
      },
    };
  }
}
