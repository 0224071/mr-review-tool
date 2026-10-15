/**
 * Diff Source abstraction interface for multi-source extensibility:
 * - Manual paste / drag-and-drop / file upload (Stage 1)
 * - GitLab MR REST API v4 (Stage 2)
 * - CLI local git working directory / commit (Stage 4)
 */

export type DiffSourceType = 'manual' | 'file' | 'gitlab' | 'local_git';

export interface DiffPayload {
  rawDiff: string;
  sourceType: DiffSourceType;
  metadata?: {
    title?: string;
    description?: string;
    fileName?: string;
    fileSize?: number;
    projectId?: string | number;
    mrIid?: number;
    mrUrl?: string;
    branch?: string;
    commitSha?: string;
  };
}

export interface IDiffSource {
  readonly id: DiffSourceType;
  readonly name: string;
  readonly description: string;
  getDiff(options?: Record<string, unknown>): Promise<DiffPayload>;
}
