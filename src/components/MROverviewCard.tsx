import React, { useState } from 'react';
import {
  FileText,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { MRAnalysisResult } from '../types/review';

interface MROverviewCardProps {
  result: MRAnalysisResult;
  hasGitLabMr?: boolean;
  /** 分析時間（YYYY/MM/DD HH:mm）；無法保存歷史紀錄時不傳 */
  analyzedAtLabel?: string;
}

export const MROverviewCard: React.FC<MROverviewCardProps> = ({
  result,
  hasGitLabMr = false,
  analyzedAtLabel,
}) => {
  const [isAllSummaryOpen, setIsAllSummaryOpen] = useState(false);
  const [isTestsOpen, setIsTestsOpen] = useState(false);
  const [isDescOpen, setIsDescOpen] = useState(false);
  const [checkedTests, setCheckedTests] = useState<Record<number, boolean>>({});

  const toggleTestCheck = (index: number) => {
    setCheckedTests((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const highReviewsCount = result.reviews.filter((r) => r.severity === 'high').length;
  const mediumReviewsCount = result.reviews.filter((r) => r.severity === 'medium').length;
  const totalReviewsCount = result.reviews.length;

  const visibleSummaries = isAllSummaryOpen ? result.summary : result.summary.slice(0, 3);
  const hasMoreSummaries = result.summary.length > 3;

  return (
    <div className="bg-surface rounded-xl border border-surface-border shadow-xs overflow-hidden space-y-0">
      {/* 1. Header: MR Title & Stats */}
      <div className="p-4 bg-surface-subtle border-b border-surface-border space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-white px-1.5 py-0.5 rounded">
                MR 標題
              </span>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                {result.title}
              </h2>
              {analyzedAtLabel && (
                <span className="text-[11px] text-muted whitespace-nowrap shrink-0">
                  分析於 {analyzedAtLabel}
                </span>
              )}
            </div>
            {/* One-line statistics */}
            <div className="text-xs text-muted flex items-center gap-2">
              <span>
                <strong className="text-slate-800 font-semibold">{totalReviewsCount}</strong> 則意見
              </span>
              <span>·</span>
              <span className="text-rose-700 font-medium">
                {highReviewsCount} 重大
              </span>
              <span>·</span>
              <span className="text-amber-700 font-medium">
                {mediumReviewsCount} 中等
              </span>
            </div>
          </div>
        </div>

        {/* Notice when not connected to GitLab MR */}
        {!hasGitLabMr && (
          <div className="pt-1 text-[11px] text-muted flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
            <span>連結 GitLab MR 後即可發布意見</span>
          </div>
        )}
      </div>

      {/* 2. Core Summaries: Top 3 items, rest folded */}
      <div className="p-4 space-y-2 border-b border-surface-border">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>核心變更摘要</span>
          </div>
          {hasMoreSummaries && (
            <button
              type="button"
              onClick={() => setIsAllSummaryOpen(!isAllSummaryOpen)}
              className="text-[11px] text-primary hover:underline font-medium flex items-center gap-0.5"
            >
              <span>{isAllSummaryOpen ? '收合摘要' : `查看全部 (${result.summary.length} 條)`}</span>
              {isAllSummaryOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        <ul className="space-y-1.5 text-xs text-slate-700">
          {visibleSummaries.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 leading-relaxed">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 3. Test Suggestions Accordion (Default Collapsed) */}
      <div className="border-b border-surface-border">
        <button
          type="button"
          onClick={() => setIsTestsOpen(!isTestsOpen)}
          className="w-full px-4 py-2.5 bg-surface hover:bg-surface-subtle flex items-center justify-between text-xs text-slate-700 font-medium transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <FlaskConical className="w-3.5 h-3.5 text-emerald-600" />
            <span>測試建議（{result.testSuggestions.length} 項）</span>
          </span>
          {isTestsOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>

        {isTestsOpen && (
          <div className="p-4 pt-1 space-y-1.5 bg-surface-subtle/50 text-xs">
            {result.testSuggestions.map((testItem, idx) => {
              const isChecked = !!checkedTests[idx];
              return (
                <label
                  key={idx}
                  onClick={() => toggleTestCheck(idx)}
                  className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors border ${
                    isChecked
                      ? 'bg-emerald-50/70 border-emerald-200 text-slate-500 line-through'
                      : 'bg-surface border-slate-200/80 text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    readOnly
                    className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="leading-snug">{testItem}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. MR Description Markdown Accordion (Default Collapsed) */}
      <div>
        <button
          type="button"
          onClick={() => setIsDescOpen(!isDescOpen)}
          className="w-full px-4 py-2.5 bg-surface hover:bg-surface-subtle flex items-center justify-between text-xs text-slate-700 font-medium transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>完整 MR 描述（Markdown）</span>
          </span>
          {isDescOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>

        {isDescOpen && (
          <div className="p-4 bg-slate-900/[0.02] text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed border-t border-surface-border max-h-56 overflow-y-auto">
            {result.description}
          </div>
        )}
      </div>
    </div>
  );
};
