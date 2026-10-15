import React, { useState } from 'react';
import {
  ListChecks,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  FileCode,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { ChecklistCoverageItem, MRReviewItem } from '../types/review';
import { REVIEW_CHECKLIST } from '../core/prompt-builder';

interface ChecklistCoverageBannerProps {
  checklistCoverage?: ChecklistCoverageItem[];
  reviews?: MRReviewItem[];
  onSelectFile?: (file: string) => void;
}

const CATEGORY_TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  bug: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  performance: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  a11y: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  readability: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  naming: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  style: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200' },
  test: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  config: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  'error-handling': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
};

export const ChecklistCoverageBanner: React.FC<ChecklistCoverageBannerProps> = ({
  checklistCoverage = [],
  reviews = [],
  onSelectFile,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'hit' | 'clean'>('all');

  const coverageMap = new Map<string, ChecklistCoverageItem>();
  for (const cov of checklistCoverage) {
    coverageMap.set(cov.id, cov);
  }

  // Calculate coverage stats
  const totalItems = REVIEW_CHECKLIST.length;
  let hitCount = 0;

  for (const item of REVIEW_CHECKLIST) {
    const cov = coverageMap.get(item.id);
    if (cov?.hit) {
      hitCount++;
    }
  }

  const cleanCount = totalItems - hitCount;

  const filteredItems = REVIEW_CHECKLIST.filter((item) => {
    const cov = coverageMap.get(item.id);
    const isHit = cov?.hit ?? false;
    if (filterMode === 'hit') return isHit;
    if (filterMode === 'clean') return !isHit;
    return true;
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden transition-all duration-200">
      {/* Header Bar */}
      <div className="p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-slate-50 via-white to-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
              hitCount > 0
                ? 'bg-amber-50 border-amber-200 text-amber-600'
                : 'bg-emerald-50 border-emerald-200 text-emerald-600'
            }`}
          >
            {hitCount > 0 ? (
              <ShieldAlert className="w-5 h-5" />
            ) : (
              <ShieldCheck className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-800 text-sm">審查清單覆蓋率</span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {totalItems} 項中命中 {hitCount} 項
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              已對 {totalItems} 項架構與品質規則進行逐項檢驗；
              {hitCount > 0 ? (
                <span className="text-amber-700 font-medium">
                  {hitCount} 項發現問題需要注意
                </span>
              ) : (
                <span className="text-emerald-700 font-medium">全部項目均無違規</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hitCount > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
              <AlertTriangle className="w-3 h-3" />
              {hitCount} 項命中
            </span>
          )}
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" />
            {cleanCount} 項無異常
          </span>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors shadow-2xs"
          >
            <span>{isExpanded ? '收合狀態' : '展開看每一項狀態'}</span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded Details Section */}
      {isExpanded && (
        <div className="p-3.5 sm:p-4 bg-slate-50/50 space-y-3">
          {/* Filter Pills */}
          <div className="flex items-center justify-between flex-wrap gap-2 pb-1">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium text-[11px]">篩選項目：</span>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  filterMode === 'all'
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                全部 ({totalItems})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('hit')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  filterMode === 'hit'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
                }`}
              >
                已命中 ({hitCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('clean')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  filterMode === 'clean'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
                }`}
              >
                無異常 ({cleanCount})
              </button>
            </div>
            <span className="text-[11px] text-slate-400">
              點選檔案名稱可快速定位 Diff 區塊
            </span>
          </div>

          {/* Checklist Items List */}
          <div className="grid grid-cols-1 gap-2">
            {filteredItems.map((item, idx) => {
              const cov = coverageMap.get(item.id);
              const isHit = cov?.hit ?? false;
              const files = cov?.files || [];
              const colors = CATEGORY_TAG_COLORS[item.category] || {
                bg: 'bg-slate-100',
                text: 'text-slate-700',
                border: 'border-slate-300',
              };

              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border transition-all text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                    isHit
                      ? 'bg-amber-50/40 border-amber-200/80 shadow-2xs'
                      : 'bg-white border-slate-200/70'
                  }`}
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-slate-400 font-semibold">
                        #{idx + 1}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${colors.bg} ${colors.text} ${colors.border}`}
                      >
                        {item.category}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {item.id}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          isHit
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                      >
                        {isHit ? (
                          <>
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            <span>命中 (發現問題)</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>未命中 (合規)</span>
                          </>
                        )}
                      </span>
                    </div>

                    <p className="text-slate-700 leading-relaxed font-medium">
                      {item.description}
                    </p>

                    {/* Affected files tags */}
                    {isHit && files.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[11px] text-amber-900 font-semibold">
                          相關檔案：
                        </span>
                        {files.map((file, fIdx) => (
                          <button
                            key={fIdx}
                            type="button"
                            onClick={() => onSelectFile && onSelectFile(file)}
                            className="inline-flex items-center gap-1 font-mono text-[10px] bg-white hover:bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300 transition-colors shadow-2xs"
                            title={`點擊跳轉至 ${file}`}
                          >
                            <FileCode className="w-3 h-3 text-amber-600" />
                            <span>{file}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
