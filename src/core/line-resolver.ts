import { DiffLine, ParsedDiff } from '../types/diff';
import { MRReviewItem } from '../types/review';

export interface ResolvedLineResult {
  newLine: number | null;
  oldLine: number | null;
  lineVerified: boolean;
}

/**
 * Normalizes file paths for matching by removing leading ./, a/, and b/ prefixes
 */
export function normalizeFilePath(path: string): string {
  if (!path) return '';
  return path
    .replace(/^\.\//, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '')
    .trim();
}

/**
 * Extracts all unique code snippets wrapped in backticks from review comment and suggestion.
 * E.g., "`key={index}`" -> ["key={index}"]
 */
export function extractBacktickSnippets(comment?: string, suggestion?: string): string[] {
  const combined = `${comment || ''}\n${suggestion || ''}`;
  const regex = /`([^`]+)`/g;
  const snippets: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(combined)) !== null) {
    const s = match[1].trim();
    if (s && !snippets.includes(s)) {
      snippets.push(s);
    }
  }

  return snippets;
}

/**
 * Resolves the precise line number for a review comment by matching its codeSnippet against the parsed diff.
 * Completely pure TypeScript, decoupled from browser/DOM APIs.
 *
 * Rules:
 * 1. Find file in parsedDiff matching review.file.
 * 2. Search added lines (+) matching codeSnippet (trimmed). If multiple matches, select closest to review.line.
 *    If nothing matches exactly and the snippet is long enough, retry with lines containing the snippet.
 * 3. If not found in added lines, search context lines (both new & old line), then deleted lines (-) (returning old_line).
 * 4. Snippet verification:
 *    - Extract backticked snippets from comment & suggestion; only snippets that appear in the file diff are used
 *      (suggested replacement code is not in the diff and can neither confirm nor refute the line).
 *    - Unless the candidate itself is a deleted line, deleted lines are ignored during verification.
 *    - If the matched line doesn't contain any snippet, search ±5 lines around it (only snippets that occur on
 *      a single line of the file diff may move the anchor).
 *    - If found in ±5 lines, switch to that line.
 *    - If not found in ±5 lines, keep original line and set lineVerified = false.
 *    - If comment has no backticked snippets, retain existing logic.
 * 5. Short / duplicate snippet reliability:
 *    - If codeSnippet (without spaces) < 8 characters or appears multiple times in the file diff,
 *      and did not pass backticked snippet verification, mark lineVerified = false.
 * 6. Fallback:
 *    - If codeSnippet cannot be found anywhere in the file diff, fallback to review.line with lineVerified = false.
 */
export function resolveReviewLine(
  review: {
    file: string;
    line: number | null;
    codeSnippet?: string;
    comment?: string;
    suggestion?: string;
  },
  parsedDiff: ParsedDiff
): ResolvedLineResult {
  const fallbackLine = review.line ?? null;
  const targetSnippet = (review.codeSnippet || '').trim();

  // 1. Locate corresponding file in parsedDiff
  const reviewFileNorm = normalizeFilePath(review.file);
  const matchedFile = parsedDiff.files.find((f) => {
    return (
      normalizeFilePath(f.newPath) === reviewFileNorm ||
      normalizeFilePath(f.oldPath) === reviewFileNorm ||
      f.newPath === review.file ||
      f.oldPath === review.file
    );
  });

  if (!matchedFile || !targetSnippet) {
    return {
      newLine: fallbackLine,
      oldLine: null,
      lineVerified: false,
    };
  }

  // Flatten all lines across hunks in the matched file
  const allLines: DiffLine[] = [];
  for (const hunk of matchedFile.hunks) {
    for (const l of hunk.lines) {
      allLines.push(l);
    }
  }

  const baseLine = fallbackLine ?? 0;

  // Reliability checks
  const isTooShort = targetSnippet.replace(/\s+/g, '').length < 8;
  const isExactMatch = (l: DiffLine): boolean => l.content.trim() === targetSnippet;
  // AI 偶爾給被截斷的 codeSnippet（例如 `<li key={index} className=`）；夠長時退回以「包含」比對
  const isPartialMatch = (l: DiffLine): boolean => l.content.includes(targetSnippet);

  // Find candidate line in diff
  const findCandidate = (matches: (l: DiffLine) => boolean): number => {
    let candidateIndex = -1;

    // 2. Search added lines (+) first
    const addedIndices: number[] = [];
    allLines.forEach((l, idx) => {
      if (l.type === 'add' && matches(l) && l.newLineNumber != null) {
        addedIndices.push(idx);
      }
    });

    if (addedIndices.length > 0) {
      candidateIndex = addedIndices.reduce((prevIdx, currIdx) => {
        const prevLine = allLines[prevIdx].newLineNumber ?? 0;
        const currLine = allLines[currIdx].newLineNumber ?? 0;
        return Math.abs(currLine - baseLine) < Math.abs(prevLine - baseLine) ? currIdx : prevIdx;
      });
    } else {
      // 3. Search unchanged context lines
      const contextIndices: number[] = [];
      allLines.forEach((l, idx) => {
        if (l.type === 'context' && matches(l)) {
          contextIndices.push(idx);
        }
      });

      if (contextIndices.length > 0) {
        candidateIndex = contextIndices.reduce((prevIdx, currIdx) => {
          const prevLine = allLines[prevIdx].newLineNumber ?? allLines[prevIdx].oldLineNumber ?? 0;
          const currLine = allLines[currIdx].newLineNumber ?? allLines[currIdx].oldLineNumber ?? 0;
          return Math.abs(currLine - baseLine) < Math.abs(prevLine - baseLine) ? currIdx : prevIdx;
        });
      } else {
        // Search deleted lines (-)
        const deletedIndices: number[] = [];
        allLines.forEach((l, idx) => {
          if (l.type === 'delete' && matches(l) && l.oldLineNumber != null) {
            deletedIndices.push(idx);
          }
        });

        if (deletedIndices.length > 0) {
          candidateIndex = deletedIndices.reduce((prevIdx, currIdx) => {
            const prevLine = allLines[prevIdx].oldLineNumber ?? 0;
            const currLine = allLines[currIdx].oldLineNumber ?? 0;
            return Math.abs(currLine - baseLine) < Math.abs(prevLine - baseLine) ? currIdx : prevIdx;
          });
        }
      }
    }

    return candidateIndex;
  };

  let candidateIndex = findCandidate(isExactMatch);
  let matchingLinesInFile = allLines.filter(isExactMatch);
  if (candidateIndex === -1 && !isTooShort) {
    candidateIndex = findCandidate(isPartialMatch);
    matchingLinesInFile = allLines.filter(isPartialMatch);
  }
  const isDuplicateInFile = matchingLinesInFile.length > 1;

  // If not found in any hunk lines, fallback to review.line with unverified
  if (candidateIndex === -1) {
    return {
      newLine: fallbackLine,
      oldLine: null,
      lineVerified: false,
    };
  }

  const candidateLine = allLines[candidateIndex];

  // 4. Strengthened snippet verification with backtick snippets
  // 候選行不是刪除行時，不把錨點移到刪除行（建議常寫「改回舊寫法」，會剛好命中被刪掉的那行）
  const isEligibleLine = (line: DiffLine): boolean => candidateLine.type === 'delete' || line.type !== 'delete';
  // 只用確實出現在 diff 中的片段驗證；修改建議裡的修正後程式碼不在 diff 裡，無法佐證也無法否定行號
  const backtickSnippets = extractBacktickSnippets(review.comment, review.suggestion).filter((snippet) =>
    allLines.some((l) => isEligibleLine(l) && l.content.includes(snippet))
  );
  const lineContainsSnippet = (line: DiffLine): boolean => {
    return isEligibleLine(line) && backtickSnippets.some((snippet) => line.content.includes(snippet));
  };
  // 只有在檔案中唯一出現的片段才能移動錨點；像 `favorites` 這種到處都有的識別字會把精準命中的行拉走
  const anchorSnippets = backtickSnippets.filter(
    (snippet) => allLines.filter((l) => isEligibleLine(l) && l.content.includes(snippet)).length === 1
  );
  const lineContainsAnchorSnippet = (line: DiffLine): boolean => {
    return isEligibleLine(line) && anchorSnippets.some((snippet) => line.content.includes(snippet));
  };

  let effectiveLine = candidateLine;
  let passedSnippetVerification = false;
  let lineVerifiedBase = true;

  if (backtickSnippets.length > 0) {
    if (lineContainsSnippet(candidateLine)) {
      // Candidate line directly contains one of the snippets mentioned in comment/suggestion
      passedSnippetVerification = true;
      lineVerifiedBase = true;
    } else {
      // Search ±5 lines around candidateIndex
      const windowStart = Math.max(0, candidateIndex - 5);
      const windowEnd = Math.min(allLines.length - 1, candidateIndex + 5);

      const candidateOffsets: number[] = [];
      for (let i = windowStart; i <= windowEnd; i++) {
        if (i !== candidateIndex && lineContainsAnchorSnippet(allLines[i])) {
          candidateOffsets.push(i);
        }
      }

      if (candidateOffsets.length > 0) {
        // Find best match in the ±5 window closest to candidateIndex
        const bestOffset = candidateOffsets.reduce((prevIdx, currIdx) => {
          const distPrev = Math.abs(prevIdx - candidateIndex);
          const distCurr = Math.abs(currIdx - candidateIndex);
          if (distCurr !== distPrev) {
            return distCurr < distPrev ? currIdx : prevIdx;
          }
          // If tie in distance, prefer add line
          const prevType = allLines[prevIdx].type;
          const currType = allLines[currIdx].type;
          if (currType === 'add' && prevType !== 'add') return currIdx;
          if (prevType === 'add' && currType !== 'add') return prevIdx;
          // Prefer forward index
          return currIdx > candidateIndex ? currIdx : prevIdx;
        });

        effectiveLine = allLines[bestOffset];
        passedSnippetVerification = true;
        lineVerifiedBase = true;
      } else {
        // "找不到就維持原本的結果，並把 lineVerified 標成 false。"
        effectiveLine = candidateLine;
        passedSnippetVerification = false;
        lineVerifiedBase = false;
      }
    }
  } else {
    // "如果 comment 裡沒有任何反引號片段，就維持現有的邏輯。"
    effectiveLine = candidateLine;
    passedSnippetVerification = false;
    lineVerifiedBase = true;
  }

  // 5. Short or duplicate snippet reliability
  // "codeSnippet 去掉空白後少於 8 個字元，或在同一個檔案的 diff 中出現不只一次，而且也沒有通過第 3 點的片段驗證時，就把 lineVerified 標成 false。"
  let finalLineVerified = lineVerifiedBase;
  if ((isTooShort || isDuplicateInFile) && !passedSnippetVerification) {
    finalLineVerified = false;
  }

  // Build resolved result
  if (effectiveLine.type === 'add') {
    return {
      newLine: effectiveLine.newLineNumber ?? null,
      oldLine: null,
      lineVerified: finalLineVerified,
    };
  }

  if (effectiveLine.type === 'delete') {
    return {
      newLine: null,
      oldLine: effectiveLine.oldLineNumber ?? null,
      lineVerified: finalLineVerified,
    };
  }

  return {
    newLine: effectiveLine.newLineNumber ?? null,
    oldLine: effectiveLine.oldLineNumber ?? null,
    lineVerified: finalLineVerified,
  };
}

/**
 * Aligns and enriches all reviews using parsed diff.
 * Updates review.line with the resolved line number, attaches newLine, oldLine, and lineVerified.
 */
export function alignReviewsWithDiff(
  reviews: MRReviewItem[],
  parsedDiff: ParsedDiff
): MRReviewItem[] {
  return reviews.map((review) => {
    const resolved = resolveReviewLine(review, parsedDiff);
    return {
      ...review,
      line: resolved.newLine ?? resolved.oldLine ?? review.line,
      newLine: resolved.newLine,
      oldLine: resolved.oldLine,
      lineVerified: resolved.lineVerified,
    };
  });
}
