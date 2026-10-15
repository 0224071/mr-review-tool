import { DiffFile, DiffHunk, DiffLine, ParsedDiff } from '../types/diff';

/**
 * Pure TypeScript parser for Unified Git Diff format.
 * Completely decoupled from browser/DOM APIs so it can be reused in CLI or offline reports.
 */
export function parseGitDiff(rawDiff: string): ParsedDiff {
  if (!rawDiff || typeof rawDiff !== 'string') {
    return { files: [], totalAdditions: 0, totalDeletions: 0, fileCount: 0 };
  }

  const lines = rawDiff.split(/\r?\n/);
  const files: DiffFile[] = [];

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let rawFileLines: string[] = [];
  let oldLineCounter = 0;
  let newLineCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for git diff file header
    // e.g.: diff --git a/src/App.tsx b/src/App.tsx
    if (line.startsWith('diff --git ')) {
      // Commit previous file
      if (currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
          currentHunk = null;
        }
        currentFile.rawContent = rawFileLines.join('\n');
        files.push(currentFile);
      }

      rawFileLines = [line];
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const oldPath = match ? match[1] : '';
      const newPath = match ? match[2] : '';

      currentFile = {
        oldPath: oldPath || 'unknown',
        newPath: newPath || 'unknown',
        status: 'modified',
        additions: 0,
        deletions: 0,
        hunks: [],
        rawContent: '',
      };
      continue;
    }

    if (!currentFile) {
      // If no "diff --git" header found yet, check if line starts with --- a/ or +++ b/
      if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
        const filePath = line.slice(6);
        currentFile = {
          oldPath: filePath,
          newPath: filePath,
          status: 'modified',
          additions: 0,
          deletions: 0,
          hunks: [],
          rawContent: '',
        };
        rawFileLines = [line];
        continue;
      }
      continue;
    }

    rawFileLines.push(line);

    // File status detection
    if (line.startsWith('new file mode')) {
      currentFile.status = 'added';
    } else if (line.startsWith('deleted file mode')) {
      currentFile.status = 'deleted';
    } else if (line.startsWith('similarity index')) {
      currentFile.status = 'renamed';
    } else if (line.startsWith('--- ')) {
      const p = line.replace(/^---\s+(a\/)?/, '').trim();
      if (p && p !== '/dev/null') currentFile.oldPath = p;
    } else if (line.startsWith('+++ ')) {
      const p = line.replace(/^\+\+\+\s+(b\/)?/, '').trim();
      if (p && p !== '/dev/null') currentFile.newPath = p;
    } else if (line.startsWith('@@ ')) {
      // Hunk header e.g.: @@ -15,7 +15,9 @@ function foo()
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1], 10);
        const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
        const newStart = parseInt(hunkMatch[3], 10);
        const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

        oldLineCounter = oldStart;
        newLineCounter = newStart;

        currentHunk = {
          header: line,
          oldStart,
          oldLines,
          newStart,
          newLines,
          lines: [],
        };
      }
    } else if (currentHunk) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        // File header, not an addition or deletion
        continue;
      } else if (line.startsWith('+')) {
        currentFile.additions++;
        currentHunk.lines.push({
          type: 'add',
          content: line.slice(1),
          newLineNumber: newLineCounter++,
        });
      } else if (line.startsWith('-')) {
        currentFile.deletions++;
        currentHunk.lines.push({
          type: 'delete',
          content: line.slice(1),
          oldLineNumber: oldLineCounter++,
        });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line.slice(1),
          oldLineNumber: oldLineCounter++,
          newLineNumber: newLineCounter++,
        });
      } else if (line.startsWith('\\ No newline at end of file')) {
        // diff metadata comment, skip
      }
    }
  }

  if (currentFile) {
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    currentFile.rawContent = rawFileLines.join('\n');
    files.push(currentFile);
  }

  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

  return {
    files,
    totalAdditions,
    totalDeletions,
    fileCount: files.length,
  };
}

/**
 * Re-calculates and binds exact additions and deletions for MRGroups using the parsed diff.
 * Fulfills rule: "增刪行數由前端自己解析 diff 計算，不採用 AI 回傳的數字。"
 */
export function enrichGroupsWithParsedDiff(
  groups: Array<{
    id: string;
    name: string;
    summary: string;
    files: string[];
    additions?: number;
    deletions?: number;
  }>,
  parsedDiff: ParsedDiff
): Array<{
  id: string;
  name: string;
  summary: string;
  files: string[];
  additions: number;
  deletions: number;
}> {
  // Build lookup map for file additions & deletions
  const fileStats = new Map<string, { additions: number; deletions: number }>();
  for (const file of parsedDiff.files) {
    fileStats.set(file.newPath, { additions: file.additions, deletions: file.deletions });
    fileStats.set(file.oldPath, { additions: file.additions, deletions: file.deletions });
  }

  const assignedFiles = new Set<string>();

  const enrichedGroups = groups.map((grp) => {
    let grpAdds = 0;
    let grpDels = 0;

    const normalizedFiles = grp.files.map((f) => f.replace(/^[ab]\//, ''));

    for (const filePath of normalizedFiles) {
      assignedFiles.add(filePath);
      const stats = fileStats.get(filePath);
      if (stats) {
        grpAdds += stats.additions;
        grpDels += stats.deletions;
      }
    }

    return {
      id: grp.id || `group-${Math.random().toString(36).slice(2, 7)}`,
      name: grp.name,
      summary: grp.summary,
      files: normalizedFiles,
      additions: grpAdds,
      deletions: grpDels,
    };
  });

  // Check if there are any unassigned files in parsedDiff; if so, create an "其他變更" group
  const unassignedFiles: string[] = [];
  let unassignedAdds = 0;
  let unassignedDels = 0;

  for (const file of parsedDiff.files) {
    const targetPath = file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
    if (!assignedFiles.has(targetPath)) {
      unassignedFiles.push(targetPath);
      unassignedAdds += file.additions;
      unassignedDels += file.deletions;
    }
  }

  if (unassignedFiles.length > 0) {
    enrichedGroups.push({
      id: 'other-changes',
      name: '其他變更',
      summary: '未歸類在主要意圖群組的關聯檔案變更',
      files: unassignedFiles,
      additions: unassignedAdds,
      deletions: unassignedDels,
    });
  }

  return enrichedGroups;
}
