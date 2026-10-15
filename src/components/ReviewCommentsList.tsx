import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Bug,
  Zap,
  Eye,
  BookOpen,
  Copy,
  Check,
  FileCode,
  AlertCircle,
  Sparkles,
  Palette,
  FlaskConical,
  SlidersHorizontal,
  Send,
  Edit3,
  RotateCcw,
  CheckSquare,
  Square,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { checkReviewComment } from '../core/writing-linter';
import {
  MRAnalysisResult,
  MRGroup,
  MRReviewItem,
  ReviewCategory,
  ReviewSeverity,
} from '../types/review';
import { ReviewPublishState } from '../types/gitlab';
import { DiffFile } from '../types/diff';
import { PublishedMatch } from '../core/publish-dedup';
import { formatHistoryTime } from '../core/history-store';
import {
  deselectIfCommentEmpty,
  EMPTY_COMMENT_MESSAGE,
  formatReviewForCopy,
  hasCommentText,
  resolveEffectiveComment,
  resolveEffectiveSuggestion,
} from '../core/review-text';

interface ReviewCommentsListProps {
  reviews: MRReviewItem[];
  groups: MRGroup[];
  selectedGroupId: string | null;
  onSelectFile?: (file: string, line?: number | null) => void;
  fullResult?: MRAnalysisResult;
  diffFiles?: DiffFile[];
  onPublishSingle?: (
    review: MRReviewItem,
    customComment?: string,
    customSuggestion?: string,
    index?: number
  ) => void;
  publishStates?: Record<number, ReviewPublishState>;
  /** 有發布作業進行中時停用發布／重試按鈕 */
  isPublishing?: boolean;
  /** 依本地紀錄與 MR 現有留言判斷的已發布意見 */
  publishedMatches?: Record<number, PublishedMatch>;
  isGitLabConfigured?: boolean;
  selectedIndices?: Set<number>;
  onSelectIndicesChange?: (next: Set<number>) => void;
  draftEdits?: Record<number, { comment: string; suggestion: string }>;
  onDraftEditsChange?: (drafts: Record<number, { comment: string; suggestion: string }>) => void;
}

const CATEGORY_META: Record<
  ReviewCategory,
  { label: string; icon: React.FC<{ className?: string }> }
> = {
  bug: { label: 'Bug 風險', icon: Bug },
  performance: { label: '效能優化', icon: Zap },
  a11y: { label: '無障礙 (a11y)', icon: Eye },
  readability: { label: '命名與可讀性', icon: BookOpen },
  style: { label: '樣式規範', icon: Palette },
  test: { label: '測試覆蓋', icon: FlaskConical },
  config: { label: '設定與依賴', icon: SlidersHorizontal },
};

const SEVERITY_META: Record<
  ReviewSeverity,
  { label: string; badge: string; dot: string; weight: number }
> = {
  high: {
    label: '重大',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    dot: 'bg-rose-500',
    weight: 1,
  },
  medium: {
    label: '中等',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    weight: 2,
  },
  low: {
    label: '輕微',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    dot: 'bg-slate-400',
    weight: 3,
  },
};

/** 單則發布與重試入口：有發布作業進行中（或此則發送中）時忽略點擊 */
export const runUnlessPublishing = (blocked: boolean, action: () => void) => {
  if (!blocked) action();
};

export const ReviewCommentsList: React.FC<ReviewCommentsListProps> = ({
  reviews,
  groups,
  selectedGroupId,
  onSelectFile,
  diffFiles = [],
  onPublishSingle,
  publishStates = {},
  isPublishing = false,
  publishedMatches = {},
  selectedIndices: controlledSelectedIndices,
  onSelectIndicesChange,
  draftEdits: controlledDraftEdits,
  onDraftEditsChange,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<ReviewCategory | 'all'>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<ReviewSeverity | 'all'>('all');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedCodeIndices, setExpandedCodeIndices] = useState<Set<number>>(new Set());

  const toggleCodeExpanded = (index: number) => {
    setExpandedCodeIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const getFileSnippet = (
    file: string,
    targetLine: number | null,
    codeSnippet: string
  ) => {
    const matchingFile = diffFiles.find(
      (df) => df.newPath === file || df.oldPath === file
    );
    if (!matchingFile || !matchingFile.hunks || matchingFile.hunks.length === 0) {
      return null;
    }

    const allLines = matchingFile.hunks.flatMap((h) => h.lines);
    if (allLines.length === 0) return null;

    let targetIndex = -1;
    if (targetLine != null) {
      targetIndex = allLines.findIndex(
        (l) => l.newLineNumber === targetLine || l.oldLineNumber === targetLine
      );
    }

    if (targetIndex === -1 && codeSnippet && codeSnippet.trim()) {
      const trimmed = codeSnippet.trim();
      targetIndex = allLines.findIndex((l) => l.content.includes(trimmed));
    }

    if (targetIndex === -1) {
      return {
        file: matchingFile,
        targetIndex: -1,
        lines: allLines.slice(0, 10),
      };
    }

    const start = Math.max(0, targetIndex - 5);
    const end = Math.min(allLines.length, targetIndex + 6);
    return {
      file: matchingFile,
      targetIndex,
      lines: allLines.slice(start, end),
    };
  };

  // Fallback internal states if not controlled
  // 預設全部不勾，與 App 受控時的 defaultSelectedIndices 一致（#18）
  const [internalSelectedIndices, setInternalSelectedIndices] = useState<Set<number>>(() => new Set());
  const selectedIndices = controlledSelectedIndices ?? internalSelectedIndices;
  const setSelectedIndices = (next: Set<number>) => {
    if (onSelectIndicesChange) {
      onSelectIndicesChange(next);
    } else {
      setInternalSelectedIndices(next);
    }
  };

  const [internalDraftEdits, setInternalDraftEdits] = useState<
    Record<number, { comment: string; suggestion: string }>
  >({});
  const draftEdits = controlledDraftEdits ?? internalDraftEdits;
  const setDraftEdits = (updater: (prev: Record<number, { comment: string; suggestion: string }>) => Record<number, { comment: string; suggestion: string }>) => {
    const updated = updater(draftEdits);
    if (onDraftEditsChange) {
      onDraftEditsChange(updated);
    } else {
      setInternalDraftEdits(updated);
    }
  };

  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const groupLookup = useMemo(() => {
    const map = new Map<string, MRGroup>();
    groups.forEach((g) => map.set(g.id, g));
    return map;
  }, [groups]);

  // Categories present in reviews with count
  const categoriesWithCounts = useMemo(() => {
    const counts: Partial<Record<ReviewCategory, number>> = {};
    for (const r of reviews) {
      counts[r.category] = (counts[r.category] || 0) + 1;
    }
    return (Object.keys(CATEGORY_META) as ReviewCategory[])
      .filter((cat) => counts[cat] && counts[cat]! > 0)
      .map((cat) => ({ cat, count: counts[cat]! }));
  }, [reviews]);

  // Map original indices to items
  const indexedReviews = useMemo(() => {
    return reviews.map((review, originalIndex) => ({
      review,
      originalIndex,
    }));
  }, [reviews]);

  // Filter and sort: Default sorting is High -> Medium -> Low
  const filteredAndSortedReviews = useMemo(() => {
    const filtered = indexedReviews.filter(({ review }) => {
      if (selectedGroupId && review.groupId !== selectedGroupId) return false;
      if (selectedCategory !== 'all' && review.category !== selectedCategory) return false;
      if (selectedSeverity !== 'all' && review.severity !== selectedSeverity) return false;
      return true;
    });

    // Default sorting: High (1) -> Medium (2) -> Low (3)
    return filtered.sort((a, b) => {
      const weightA = SEVERITY_META[a.review.severity]?.weight ?? 99;
      const weightB = SEVERITY_META[b.review.severity]?.weight ?? 99;
      return weightA - weightB;
    });
  }, [indexedReviews, selectedGroupId, selectedCategory, selectedSeverity]);

  /** 內文（草稿優先）是空的，不能勾選、複製或發布 */
  const isCommentEmpty = (index: number) =>
    !hasCommentText(resolveEffectiveComment(draftEdits[index]?.comment, reviews[index]?.comment));

  const handleToggleSelect = (index: number) => {
    if (isCommentEmpty(index)) return;
    const next = new Set(selectedIndices);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedIndices(next);
  };

  /** 「全選」的對象：目前篩選下所有可發布的意見（行號未驗證、會改以一般留言發出的也算），只排除內文是空的 */
  const selectableFiltered = filteredAndSortedReviews.filter((item) => !isCommentEmpty(item.originalIndex));
  const allSelectableSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((item) => selectedIndices.has(item.originalIndex));

  const handleSelectAllFiltered = () => {
    const targetIndices = selectableFiltered.map((item) => item.originalIndex);
    const next = new Set(selectedIndices);
    if (allSelectableSelected) {
      targetIndices.forEach((idx) => next.delete(idx));
    } else {
      targetIndices.forEach((idx) => next.add(idx));
    }
    setSelectedIndices(next);
  };

  const handleStartEdit = (index: number, review: MRReviewItem) => {
    setEditingIndex(index);
    if (!draftEdits[index]) {
      setDraftEdits((prev) => ({
        ...prev,
        [index]: { comment: review.comment, suggestion: review.suggestion },
      }));
    }
  };

  const handleResetEdit = (index: number, _review: MRReviewItem) => {
    setDraftEdits((prev) => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
    setEditingIndex(null);
  };

  const handleCopyReview = (review: MRReviewItem, index: number) => {
    if (isCommentEmpty(index)) return;
    const comment = resolveEffectiveComment(draftEdits[index]?.comment, review.comment);
    const suggestion = resolveEffectiveSuggestion(draftEdits[index]?.suggestion, review.suggestion);
    const formatted = formatReviewForCopy(
      SEVERITY_META[review.severity].label,
      CATEGORY_META[review.category].label,
      comment,
      suggestion
    );
    navigator.clipboard.writeText(formatted);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const highCount = reviews.filter((r) => r.severity === 'high').length;
  const mediumCount = reviews.filter((r) => r.severity === 'medium').length;
  const lowCount = reviews.filter((r) => r.severity === 'low').length;

  return (
    <div className="bg-surface rounded-xl border border-surface-border overflow-hidden shadow-xs space-y-0">
      {/* 1. Filter Bar: Dropdowns only */}
      <div className="p-3 bg-surface-subtle border-b border-surface-border flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          {/* Select all checkbox button */}
          <button
            type="button"
            onClick={handleSelectAllFiltered}
            className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-slate-200 rounded-md text-slate-700 hover:bg-slate-50 transition-colors text-xs font-medium cursor-pointer"
            title="全選 / 取消全選可發布的意見（含行號未驗證、改以一般留言發出者；內文是空的不勾）"
          >
            {allSelectableSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Square className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>全選</span>
          </button>

          <span className="font-semibold text-slate-800">
            審查意見 ({filteredAndSortedReviews.length} / {reviews.length} 則)
          </span>
        </div>

        {/* Category & Severity Filter Dropdowns */}
        <div className="flex items-center gap-2">
          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as ReviewCategory | 'all')}
            className="text-xs bg-surface border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 focus:outline-none focus:border-primary"
          >
            <option value="all">全部分類 ({reviews.length})</option>
            {categoriesWithCounts.map(({ cat, count }) => (
              <option key={cat} value={cat}>
                {CATEGORY_META[cat].label} ({count})
              </option>
            ))}
          </select>

          {/* Severity Dropdown */}
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value as ReviewSeverity | 'all')}
            className="text-xs bg-surface border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 focus:outline-none focus:border-primary"
          >
            <option value="all">所有嚴重度</option>
            <option value="high">重大 ({highCount})</option>
            <option value="medium">中等 ({mediumCount})</option>
            <option value="low">輕微 ({lowCount})</option>
          </select>
        </div>
      </div>

      {/* 2. Review Items List */}
      {/* 底部留出浮動發布列的高度（--publish-bar-space 由 AnalysisResultView 量測），清單內捲到底時最後一則不會被蓋住 */}
      <div className="divide-y divide-surface-border max-h-[620px] overflow-y-auto pb-[var(--publish-bar-space,0px)] scroll-pb-[var(--publish-bar-space,0px)]">
        {filteredAndSortedReviews.length === 0 ? (
          <div className="p-8 text-center text-muted text-xs">
            目前篩選條件下無任何審查意見
          </div>
        ) : (
          filteredAndSortedReviews.map(({ review, originalIndex }) => {
            const catMeta = CATEGORY_META[review.category];
            const sevMeta = SEVERITY_META[review.severity];
            const CatIcon = catMeta.icon;
            const violations = checkReviewComment(review);
            const group = groupLookup.get(review.groupId);

            const isSelected = selectedIndices.has(originalIndex);
            const isEditing = editingIndex === originalIndex;
            const currentDraft = draftEdits[originalIndex] || {
              comment: review.comment,
              suggestion: review.suggestion,
            };
            const isDraftModified = !!draftEdits[originalIndex];
            const commentEmpty = isCommentEmpty(originalIndex);

            const pubState = publishStates[originalIndex];
            const publishedMatch = publishedMatches[originalIndex];
            const isPublished = pubState?.status === 'published' || !!publishedMatch;
            const isSending = pubState?.status === 'sending';
            const isError = pubState?.status === 'error';

            return (
              <div
                key={`review-${originalIndex}`}
                tabIndex={0}
                className={`group p-3.5 transition-colors space-y-2 text-xs focus:outline-none focus-within:bg-slate-50/80 ${
                  isSelected ? 'bg-primary-subtle/25' : 'hover:bg-surface-subtle'
                } ${isPublished ? 'opacity-85' : ''}`}
              >
                {/* Header Row: Checkbox, Severity, File:Line；右側為操作按鈕 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-start gap-2 flex-1 min-w-0">
                    {/* Item Checkbox */}
                    <button
                      type="button"
                      onClick={() => handleToggleSelect(originalIndex)}
                      disabled={isSending || commentEmpty}
                      className="text-slate-400 hover:text-primary disabled:opacity-40 transition-colors mt-0.5 shrink-0 cursor-pointer"
                      title={commentEmpty ? EMPTY_COMMENT_MESSAGE : isPublished ? '已發布過，勾選將重複發布' : '勾選此意見'}
                      aria-pressed={isSelected}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>

                    {/* Severity Badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-[10px] border shrink-0 mt-0.5 ${sevMeta.badge}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${sevMeta.dot}`} />
                      {sevMeta.label}
                    </span>

                    {isPublished && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-[10px] border shrink-0 mt-0.5 text-success-text bg-success-subtle border-success-border"
                        title={
                          publishedMatch?.source === 'remote'
                            ? 'MR 上已有相同內容的留言'
                            : '已發布至 GitLab'
                        }
                      >
                        <CheckCircle2 className="w-3 h-3 text-success" />
                        已發布
                      </span>
                    )}

                    {/* File and Line: Toggles inline code diff */}
                    <button
                      type="button"
                      onClick={() => toggleCodeExpanded(originalIndex)}
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded border border-slate-200 transition-colors shrink-0 max-w-full mt-0.5 cursor-pointer"
                      title={expandedCodeIndices.has(originalIndex) ? '收合程式碼片段' : '展開前後 5 行程式碼片段'}
                    >
                      <FileCode className="w-3 h-3 text-slate-500" />
                      <span className="font-semibold text-slate-800 truncate min-w-0">{review.file}</span>
                      {review.line !== null ? (
                        <span className="text-primary font-bold">:L{review.line}</span>
                      ) : review.lineVerified === false && (
                        <span className="text-amber-700 font-bold">:行號未驗證</span>
                      )}
                      {review.aiLine != null && review.aiLine !== review.line && (
                        <span
                          className="text-slate-500 font-normal"
                          title={`AI 原本標示 L${review.aiLine}，已依程式碼片段在 diff 中的位置修正`}
                        >
                          （AI 標 L{review.aiLine}）
                        </span>
                      )}
                      {expandedCodeIndices.has(originalIndex) ? (
                        <ChevronUp className="w-3 h-3 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-slate-400" />
                      )}
                    </button>
                  </div>

                  {/* Actions Toolbar: Only visible on hover or focus */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {/* Writing guideline warning */}
                    {violations.length > 0 && (
                      <div className="relative group/tip inline-flex items-center gap-0.5 text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 text-[10px] cursor-help">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <div className="absolute right-0 bottom-full mb-1 hidden group-hover/tip:block z-20 w-64 bg-slate-900 text-white p-2.5 rounded-lg shadow-xl text-[11px] font-sans leading-normal pointer-events-none">
                          <div className="font-semibold text-amber-300 flex items-center gap-1 mb-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            寫作規範提示
                          </div>
                          <p>{violations[0].message}</p>
                        </div>
                      </div>
                    )}

                    {/* Edit Draft Button */}
                    {!isPublished && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingIndex(null);
                          } else {
                            handleStartEdit(originalIndex, review);
                          }
                        }}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
                        title={isEditing ? '完成編輯' : '編輯草稿'}
                        aria-label={isEditing ? '完成編輯' : '編輯草稿'}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Reset edits button */}
                    {isDraftModified && !isPublished && (
                      <button
                        type="button"
                        onClick={() => handleResetEdit(originalIndex, review)}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
                        title="還原原始意見"
                        aria-label="還原原始意見"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Copy Button */}
                    <button
                      type="button"
                      onClick={() => handleCopyReview(review, originalIndex)}
                      disabled={commentEmpty}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-40"
                      title={commentEmpty ? EMPTY_COMMENT_MESSAGE : '複製意見'}
                      aria-label="複製意見"
                    >
                      {copiedIndex === originalIndex ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Single Publish Button */}
                    {onPublishSingle && (
                      <button
                        type="button"
                        onClick={() =>
                          runUnlessPublishing(isSending || isPublishing, () =>
                            onPublishSingle(
                              review,
                              draftEdits[originalIndex]?.comment,
                              draftEdits[originalIndex]?.suggestion,
                              originalIndex
                            )
                          )
                        }
                        disabled={isSending || isPublishing || commentEmpty}
                        className="p-1 rounded text-gitlab hover:text-gitlab-hover hover:bg-gitlab-subtle transition-colors disabled:opacity-40"
                        title={isPublished ? '已發布過，再次發布會重複' : '發布此則至 GitLab'}
                        aria-label="發布單則"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Comment text：獨立一行佔滿卡片寬度，不和檔名、操作按鈕搶寬度；內文空了時改顯示提示 */}
                {((!isEditing && currentDraft.comment) || commentEmpty) && (
                  <div className="sm:pl-6 space-y-1.5">
                    {!isEditing && currentDraft.comment && (
                      <p className="text-slate-800 font-medium leading-relaxed break-words">
                        {currentDraft.comment}
                      </p>
                    )}
                    {commentEmpty && (
                      <span
                        role="status"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium text-[11px] text-danger-text bg-danger-subtle"
                      >
                        <AlertCircle className="w-3 h-3 text-danger shrink-0" />
                        {EMPTY_COMMENT_MESSAGE}
                      </span>
                    )}
                  </div>
                )}

                {/* Editable comment input when editing */}
                {isEditing && (
                  <div className="space-y-2 pt-1">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                        意見評論內文 (Comment)：
                      </label>
                      <textarea
                        value={currentDraft.comment}
                        onChange={(e) => {
                          setDraftEdits((prev) => ({
                            ...prev,
                            [originalIndex]: {
                              ...currentDraft,
                              comment: e.target.value,
                            },
                          }));
                          // 清空時自動取消勾選；補上內文後不自動勾回
                          const next = deselectIfCommentEmpty(selectedIndices, originalIndex, e.target.value);
                          if (next !== selectedIndices) setSelectedIndices(next);
                        }}
                        rows={2}
                        className="w-full p-2 border border-slate-300 rounded-md font-sans text-xs focus:ring-1 focus:ring-primary focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-primary block mb-0.5">
                        修改動作與建議 (Suggestion)：
                      </label>
                      <textarea
                        value={currentDraft.suggestion}
                        onChange={(e) =>
                          setDraftEdits((prev) => ({
                            ...prev,
                            [originalIndex]: {
                              ...currentDraft,
                              suggestion: e.target.value,
                            },
                          }))
                        }
                        rows={3}
                        className="w-full p-2 border border-slate-300 rounded-md font-mono text-xs focus:ring-1 focus:ring-primary focus:outline-none bg-white"
                      />
                    </div>
                  </div>
                )}

                {/* Suggestion Callout：建議為空時整段不顯示 */}
                {!isEditing && currentDraft.suggestion.trim() !== '' && (
                  <div className="bg-primary-subtle/30 border border-primary-border/60 rounded-lg p-2.5 space-y-1">
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-primary">
                      <Sparkles className="w-3.5 h-3.5" />
                      修改建議：
                    </div>
                    <div className="text-slate-700 leading-normal pl-4 font-mono text-[11px] whitespace-pre-wrap">
                      {currentDraft.suggestion}
                    </div>
                  </div>
                )}

                {/* Inline Collapsible Code Diff Section */}
                {expandedCodeIndices.has(originalIndex) && (() => {
                  const targetLineNumber = review.newLine ?? review.oldLine ?? review.line;
                  const snippetData = getFileSnippet(
                    review.file,
                    targetLineNumber,
                    review.codeSnippet
                  );

                  return (
                    <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden text-xs font-mono shadow-xs mt-2">
                      <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between text-[11px] text-slate-300">
                        <span className="font-semibold flex items-center gap-1.5">
                          <FileCode className="w-3.5 h-3.5 text-slate-400" />
                          <span>{review.file}</span>
                          {review.line !== null ? (
                            <span className="text-amber-400 font-bold">:L{review.line}</span>
                          ) : review.lineVerified === false && (
                            <span className="text-amber-400 font-bold">:行號未驗證</span>
                          )}
                        </span>
                        <span className="text-slate-400 text-[10px]">問題行前後各 5 行變更</span>
                      </div>

                      <div className="p-2 overflow-x-auto divide-y divide-slate-800/60 text-[11px]">
                        {snippetData && snippetData.lines.length > 0 ? (
                          snippetData.lines.map((line, lIdx) => {
                            const isTarget =
                              targetLineNumber !== null
                                ? (line.newLineNumber === targetLineNumber || line.oldLineNumber === targetLineNumber)
                                : (review.codeSnippet && line.content.includes(review.codeSnippet.trim()));

                            let lineBg = 'hover:bg-slate-800/60';
                            let lineText = 'text-slate-300';
                            let sign = ' ';

                            if (line.type === 'add') {
                              lineBg = 'bg-emerald-950/40 text-emerald-300';
                              sign = '+';
                            } else if (line.type === 'delete') {
                              lineBg = 'bg-rose-950/40 text-rose-300';
                              sign = '-';
                            }

                            if (isTarget) {
                              lineBg = 'bg-amber-950/80 text-amber-200 ring-1 ring-amber-400 border-l-2 border-amber-400 font-semibold';
                            }

                            return (
                              <div
                                key={lIdx}
                                className={`flex items-start px-2 py-0.5 rounded-xs transition-colors ${lineBg} ${lineText}`}
                              >
                                <span className="w-9 shrink-0 text-slate-500 text-right pr-2 select-none text-[10px]">
                                  {line.oldLineNumber || ''}
                                </span>
                                <span className="w-9 shrink-0 text-slate-500 text-right pr-2 select-none text-[10px]">
                                  {line.newLineNumber || ''}
                                </span>
                                <span className="w-4 shrink-0 text-center select-none opacity-60">
                                  {sign}
                                </span>
                                <span className="flex-1 whitespace-pre-wrap break-all">
                                  {line.content}
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-3 text-slate-400">
                            <div className="text-[11px] text-amber-300 font-semibold mb-1">問題程式碼：</div>
                            <pre className="text-slate-200 whitespace-pre-wrap">{review.codeSnippet || '無程式碼片段'}</pre>
                          </div>
                        )}
                      </div>

                      {/* Bottom action bar with '查看完整檔案' on bottom right */}
                      <div className="px-3 py-1.5 bg-slate-800/90 border-t border-slate-700 flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => toggleCodeExpanded(originalIndex)}
                          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          <ChevronUp className="w-3 h-3" />
                          <span>收合程式碼</span>
                        </button>

                        {onSelectFile && (
                          <button
                            type="button"
                            onClick={() => onSelectFile(review.file, review.line)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-white bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded transition-colors cursor-pointer"
                            title="開啟完整檔案檢視視窗並捲到該行"
                          >
                            <span>查看完整檔案</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Card Footer: Category, Group, Verified, and Status badges */}
                <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[10px] text-muted">
                  <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    <CatIcon className="w-2.5 h-2.5" />
                    {catMeta.label}
                  </span>

                  {group && (
                    <span className="text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {group.name}
                    </span>
                  )}

                  {review.lineVerified === false && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold bg-amber-100 text-amber-900 border border-amber-300"
                      title="Diff 中未找到完全符合的程式碼行，行號僅供參考"
                    >
                      <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>行號未驗證</span>
                    </span>
                  )}

                  {isPublished && publishedMatch && publishedMatch.publishedAt > 0 && (
                    <span className="text-muted">
                      發布於 {formatHistoryTime(publishedMatch.publishedAt)}
                    </span>
                  )}

                  {pubState?.status === 'published' && pubState.mode === 'general' && (
                    <span className="px-1.5 py-0.5 rounded font-medium bg-surface-muted text-muted-dark">
                      以一般留言發布
                    </span>
                  )}

                  {pubState?.status === 'published' && pubState.fallbackReason && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium bg-warning-subtle text-warning-text border border-warning-border"
                      title={pubState.fallbackReason}
                    >
                      <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
                      <span>{pubState.fallbackReason}</span>
                    </span>
                  )}

                  {pubState?.status === 'published' && pubState.notice && (
                    <span className="px-1.5 py-0.5 rounded font-semibold bg-warning-subtle text-warning-text border border-warning-border">
                      {pubState.notice}
                    </span>
                  )}

                  {isSending && (
                    <span role="status" className="text-warning-text bg-warning-subtle px-1.5 py-0.5 rounded font-medium">
                      發布中...
                    </span>
                  )}

                  {isError && (
                    <span
                      role="alert"
                      className="text-danger-text bg-danger-subtle px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 max-w-full"
                    >
                      <XCircle className="w-3 h-3 text-danger shrink-0" />
                      <span className="break-all">發布失敗：{pubState?.errorMessage || '未知錯誤'}</span>
                    </span>
                  )}

                  {isError && onPublishSingle && (
                    <button
                      type="button"
                      onClick={() =>
                        runUnlessPublishing(isPublishing, () =>
                          onPublishSingle(
                            review,
                            draftEdits[originalIndex]?.comment,
                            draftEdits[originalIndex]?.suggestion,
                            originalIndex
                          )
                        )
                      }
                      disabled={isPublishing || commentEmpty}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold text-gitlab border border-gitlab-border bg-gitlab-subtle hover:bg-surface disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                      重試
                    </button>
                  )}

                  {isDraftModified && !isPublished && (
                    <span className="text-primary bg-primary-subtle px-1.5 py-0.5 rounded font-medium">
                      草稿已修改
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
