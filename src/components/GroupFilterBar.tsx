import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Layers, Check } from 'lucide-react';
import { MRGroup } from '../types/review';
import { getGroupColor } from '../utils/group-colors';

interface GroupFilterBarProps {
  groups: MRGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  reviewCountsByGroup: Record<string, number>;
}

export const GroupFilterBar: React.FC<GroupFilterBarProps> = ({
  groups,
  selectedGroupId,
  onSelectGroup,
  reviewCountsByGroup,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasMore = el.scrollWidth - el.clientWidth - el.scrollLeft > 6;
    setCanScrollRight(hasMore);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [checkScroll, groups]);

  const totalAdditions = groups.reduce((acc, g) => acc + (g.additions || 0), 0);
  const totalDeletions = groups.reduce((acc, g) => acc + (g.deletions || 0), 0);
  const totalReviews = Object.values(reviewCountsByGroup).reduce((acc, c) => acc + c, 0);

  return (
    <div className="bg-surface rounded-xl border border-surface-border p-3 shadow-xs space-y-2">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1.5 font-semibold text-slate-700">
          <Layers className="w-3.5 h-3.5 text-primary" />
          依意圖分組篩選
        </span>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin"
        >
        {/* All option chip */}
        <button
          type="button"
          onClick={() => onSelectGroup(null)}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all shrink-0 ${
            selectedGroupId === null
              ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
              : 'bg-surface-subtle text-slate-700 border-slate-200 hover:bg-slate-100'
          }`}
          title="檢視全部變更與意見"
        >
          <span className="font-semibold flex items-center gap-1">
            全部
            {selectedGroupId === null && <Check className="w-3 h-3 text-emerald-400" />}
          </span>
          <span className="font-mono text-[10px] opacity-80">
            +{totalAdditions} / -{totalDeletions}
          </span>
          <span className="text-[10px] px-1 py-0.2 rounded bg-white/20 font-medium">
            {totalReviews} 則
          </span>
        </button>

        {/* Individual Groups */}
        {groups.map((group, index) => {
          const isSelected = selectedGroupId === group.id;
          const colorTheme = getGroupColor(group.id, index);
          const reviewCount = reviewCountsByGroup[group.id] || 0;

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelectGroup(group.id)}
              title={`${group.name}\n${group.summary}\n包含檔案：\n${group.files.join('\n')}`}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all shrink-0 ${
                isSelected
                  ? `bg-surface ${colorTheme.border} ${colorTheme.text} shadow-xs ring-2 ring-primary-border`
                  : 'bg-surface text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: colorTheme.svgStroke }}
              />
              <span className="font-semibold text-slate-800 truncate max-w-[140px]">{group.name}</span>
              {isSelected && <Check className="w-3 h-3 text-primary shrink-0" />}

              <span className="font-mono text-[10px] text-muted shrink-0">
                +{group.additions} / -{group.deletions}
              </span>

              {reviewCount > 0 && (
                <span className="text-[10px] px-1 py-0.2 rounded font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  {reviewCount} 則
                </span>
              )}
            </button>
          );
        })}
        </div>
        {canScrollRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-12 bg-gradient-to-l from-surface to-transparent transition-opacity duration-200" />
        )}
      </div>
    </div>
  );
};
