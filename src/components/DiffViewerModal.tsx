import React from 'react';
import { X, FileCode, CheckCircle } from 'lucide-react';
import { DiffFile } from '../types/diff';

interface DiffViewerModalProps {
  file: DiffFile | null;
  targetLine?: number | null;
  onClose: () => void;
}

export const DiffViewerModal: React.FC<DiffViewerModalProps> = ({
  file,
  targetLine,
  onClose,
}) => {
  if (!file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full h-[80vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-slate-600" />
            <span className="font-mono text-xs font-bold text-slate-800">{file.newPath}</span>
            <div className="flex items-center gap-1.5 font-mono text-[11px] ml-2">
              <span className="text-emerald-600 font-semibold">+{file.additions}</span>
              <span className="text-rose-600 font-semibold">-{file.deletions}</span>
            </div>
            {targetLine !== undefined && targetLine !== null && (
              <span className="bg-indigo-100 text-indigo-800 text-[10px] font-mono px-2 py-0.5 rounded font-bold">
                審查重點行: L{targetLine}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Diff Hunk Content */}
        <div className="flex-1 overflow-auto bg-slate-900 font-mono text-xs p-4 divide-y divide-slate-800">
          {file.hunks.length === 0 ? (
            <div className="p-8 text-center text-slate-500">無可顯示之代碼區塊</div>
          ) : (
            file.hunks.map((hunk, hIdx) => (
              <div key={hIdx} className="py-2">
                <div className="text-slate-500 text-[11px] py-1 select-none font-semibold">
                  {hunk.header}
                </div>
                <div className="space-y-0.5 mt-1">
                  {hunk.lines.map((line, lIdx) => {
                    const isTarget =
                      targetLine !== undefined &&
                      targetLine !== null &&
                      (line.newLineNumber === targetLine || line.oldLineNumber === targetLine);

                    let bgClass = 'hover:bg-slate-800/50';
                    let textClass = 'text-slate-300';
                    let sign = ' ';

                    if (line.type === 'add') {
                      bgClass = 'bg-emerald-950/40 text-emerald-300';
                      sign = '+';
                    } else if (line.type === 'delete') {
                      bgClass = 'bg-rose-950/40 text-rose-300';
                      sign = '-';
                    }

                    if (isTarget) {
                      bgClass = 'bg-indigo-900/80 text-yellow-200 ring-1 ring-yellow-400';
                    }

                    return (
                      <div
                        key={lIdx}
                        className={`flex items-start px-2 py-0.5 rounded-xs transition-colors ${bgClass} ${textClass}`}
                      >
                        <span className="w-10 shrink-0 text-slate-500 text-right pr-2 select-none text-[10px]">
                          {line.newLineNumber || line.oldLineNumber || ''}
                        </span>
                        <span className="w-4 shrink-0 text-center select-none opacity-60">
                          {sign}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap break-all">
                          {line.content}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>共 {file.hunks.reduce((a, h) => a + h.lines.length, 0)} 行程式碼變更</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 font-medium"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
