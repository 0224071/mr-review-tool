import { DiffPayload, IDiffSource } from '../../types/sources';

export class ManualDiffSource implements IDiffSource {
  readonly id = 'manual' as const;
  readonly name = '手動輸入 / 上傳檔案';
  readonly description = '直接貼上 git diff 內容，或拖曳上傳 .diff / .patch 檔案';

  async getDiff(options?: { text?: string; fileName?: string; fileSize?: number }): Promise<DiffPayload> {
    const rawDiff = options?.text || '';
    return {
      rawDiff,
      sourceType: 'manual',
      metadata: {
        fileName: options?.fileName,
        fileSize: options?.fileSize,
      },
    };
  }
}
