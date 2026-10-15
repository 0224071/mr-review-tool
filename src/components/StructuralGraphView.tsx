import React, { useMemo, useState, useRef } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  Component,
  GitBranch,
  Database,
  Globe,
  Wrench,
  CheckCircle,
  Box,
  ArrowRight,
  Info,
} from 'lucide-react';
import { computeDagreLayout, LayoutedNode } from '../core/dagre-layout';
import { MRGraph, MRGroup, NodeKind } from '../types/review';
import { getGroupColor } from '../utils/group-colors';

interface StructuralGraphViewProps {
  graph: MRGraph;
  groups: MRGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
}

const KIND_LABELS: Record<NodeKind, { label: string; icon: React.FC<{ className?: string }> }> = {
  component: { label: 'UI 元件', icon: Component },
  hook: { label: '邏輯封裝（Hook / Composable）', icon: GitBranch },
  store: { label: '狀態/Store', icon: Database },
  api: { label: 'API 接口', icon: Globe },
  util: { label: '工具函式', icon: Wrench },
  test: { label: '測試案例', icon: CheckCircle },
  other: { label: '模組', icon: Box },
};

export const StructuralGraphView: React.FC<StructuralGraphViewProps> = ({
  graph,
  groups,
  selectedGroupId,
  onSelectGroup,
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeNode, setActiveNode] = useState<LayoutedNode | null>(null);

  const groupLookup = useMemo(() => {
    const map = new Map<string, MRGroup>();
    groups.forEach((g) => map.set(g.id, g));
    return map;
  }, [groups]);

  // Compute Dagre coordinates
  const layouted = useMemo(() => {
    return computeDagreLayout(graph, {
      direction: 'LR',
      nodeWidth: 170,
      nodeHeight: 60,
    });
  }, [graph]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag on canvas background
    if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).id === 'graph-canvas') {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (!graph.nodes || graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-slate-200 text-slate-400">
        <Layers className="w-10 h-10 stroke-1 mb-2 text-slate-300" />
        <p className="text-sm font-medium">此次變更無關聯模組或依賴結構圖</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
      {/* Top bar controls */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-600" />
          <span className="text-xs font-semibold text-slate-800">MR 模組呼叫與依賴結構圖</span>
          <span className="text-[11px] text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
            Dagre 自動排版 · 點選節點可直接切換意圖分組
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
            className="p-1.5 rounded-md hover:bg-slate-200 text-slate-600 transition-colors"
            title="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
            className="p-1.5 rounded-md hover:bg-slate-200 text-slate-600 transition-colors"
            title="縮小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={resetView}
            className="p-1.5 rounded-md hover:bg-slate-200 text-slate-600 transition-colors"
            title="重設視圖"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <div
        id="graph-canvas"
        className="relative h-[420px] bg-slate-900/[0.02] cursor-grab active:cursor-grabbing overflow-hidden select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(var(--color-surface-border)_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />

        <svg
          className="w-full h-full"
          viewBox={`0 0 ${layouted.width} ${layouted.height}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="var(--color-muted-light)" />
            </marker>
            <marker
              id="arrowhead-active"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="var(--color-primary)" />
            </marker>
            <filter id="node-shadow" x="-10%" y="-10%" width="125%" height="125%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08" />
            </filter>
          </defs>

          {/* Render Edges */}
          {layouted.edges.map((edge, index) => {
            if (!edge.points || edge.points.length < 2) return null;
            const pointsStr = edge.points.map((p) => `${p.x},${p.y}`).join(' ');

            // Calculate midpoint for label
            const midIndex = Math.floor(edge.points.length / 2);
            const midPoint = edge.points[midIndex] || edge.points[0];

            return (
              <g key={`edge-${index}`} className="group">
                <polyline
                  points={pointsStr}
                  fill="none"
                  stroke="var(--color-surface-border)"
                  strokeWidth="2"
                  strokeDasharray="none"
                  markerEnd="url(#arrowhead)"
                  className="transition-all hover:stroke-indigo-500 hover:stroke-[2.5]"
                />
                {edge.label && (
                  <g transform={`translate(${midPoint.x}, ${midPoint.y - 10})`}>
                    <rect
                      x={-(edge.label.length * 6 + 10) / 2}
                      y="-10"
                      width={edge.label.length * 6 + 10}
                      height="16"
                      rx="3"
                      fill="var(--color-surface)"
                      stroke="var(--color-surface-border)"
                      strokeWidth="1"
                    />
                    <text
                      textAnchor="middle"
                      y="1"
                      className="text-[10px] fill-slate-500 font-sans select-none"
                    >
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Render Nodes */}
          {layouted.nodes.map((node) => {
            const group = groupLookup.get(node.groupId);
            const colorTheme = getGroupColor(node.groupId);
            const isGroupSelected = selectedGroupId === node.groupId;
            const isNodeActive = activeNode?.id === node.id;

            const KindIcon = KIND_LABELS[node.kind]?.icon || Box;
            const kindLabel = KIND_LABELS[node.kind]?.label || '模組';

            const x = node.x - node.width / 2;
            const y = node.y - node.height / 2;

            return (
              <g
                key={node.id}
                transform={`translate(${x}, ${y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveNode(node);
                  onSelectGroup(node.groupId);
                }}
                className="cursor-pointer group"
              >
                {/* Node Box */}
                <rect
                  width={node.width}
                  height={node.height}
                  rx="8"
                  fill={isGroupSelected ? colorTheme.svgFill : 'var(--color-surface)'}
                  stroke={isGroupSelected ? colorTheme.svgStroke : 'var(--color-surface-border)'}
                  strokeWidth={isGroupSelected ? '2.5' : '1.5'}
                  filter="url(#node-shadow)"
                  className="transition-all group-hover:stroke-indigo-500 group-hover:scale-[1.02]"
                />

                {/* Group indicator top color stripe */}
                <path
                  d={`M 0 8 Q 0 0 8 0 L ${node.width - 8} 0 Q ${node.width} 0 ${node.width} 8 L ${node.width} 5 L 0 5 Z`}
                  fill={colorTheme.svgStroke}
                />

                {/* Node Title */}
                <text
                  x="12"
                  y="26"
                  className="font-mono text-[12px] font-bold fill-slate-900 group-hover:fill-indigo-600 transition-colors select-none"
                >
                  {node.label.length > 17 ? `${node.label.slice(0, 16)}…` : node.label}
                </text>

                {/* Node Kind Badge & Group Name */}
                <g transform="translate(12, 36)">
                  <rect
                    width="60"
                    height="16"
                    rx="3"
                    fill={colorTheme.svgFill}
                    stroke={colorTheme.svgStroke}
                    strokeWidth="0.8"
                  />
                  <text
                    x="30"
                    y="11"
                    textAnchor="middle"
                    className="text-[9px] font-sans font-medium select-none"
                    fill={colorTheme.svgText}
                  >
                    {kindLabel}
                  </text>

                  {/* Group Name badge */}
                  <text
                    x="68"
                    y="11"
                    className="text-[10px] font-sans fill-slate-500 select-none"
                  >
                    {group ? (group.name.length > 7 ? `${group.name.slice(0, 6)}…` : group.name) : ''}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* Selected Node Details Card Overlay */}
        {activeNode && (
          <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs p-3 rounded-lg border border-slate-200 shadow-md max-w-xs text-xs animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100 mb-1.5">
              <span className="font-semibold text-slate-800 font-mono">{activeNode.label}</span>
              <button
                type="button"
                onClick={() => setActiveNode(null)}
                className="text-slate-400 hover:text-slate-600 text-xs px-1"
              >
                ✕
              </button>
            </div>
            <div className="space-y-1 text-slate-600 text-[11px]">
              <div>
                類型：<span className="font-medium text-slate-800">{KIND_LABELS[activeNode.kind]?.label}</span>
              </div>
              <div>
                所屬分組：
                <span className="font-medium text-indigo-700">
                  {groupLookup.get(activeNode.groupId)?.name || activeNode.groupId}
                </span>
              </div>
              <p className="text-slate-500 italic mt-1">
                {groupLookup.get(activeNode.groupId)?.summary}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Legend & Instructions Footer */}
      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 space-y-2 text-[11px] text-slate-500">
        {/* Row 1: Groups legend */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-700 shrink-0">分組：</span>
          <div className="flex items-center gap-3 flex-wrap">
            {groups.map((grp) => {
              const theme = getGroupColor(grp.id);
              const isSelected = selectedGroupId === grp.id;
              return (
                <button
                  key={grp.id}
                  type="button"
                  onClick={() => onSelectGroup(grp.id)}
                  className={`inline-flex items-center gap-1.5 transition-colors cursor-pointer hover:text-slate-900 ${
                    isSelected ? 'font-bold text-slate-900' : 'text-slate-600'
                  }`}
                  title={grp.summary}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: theme.svgStroke }}
                  />
                  <span>{grp.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: Node classification legend & hint */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5 border-t border-slate-200/60">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-700 shrink-0">節點分類：</span>
            <div className="flex items-center gap-3 flex-wrap">
              {Object.entries(KIND_LABELS).map(([k, meta]) => {
                const Icon = meta.icon;
                return (
                  <span key={k} className="inline-flex items-center gap-1 text-slate-600">
                    <Icon className="w-3 h-3 text-slate-400" />
                    <span>{meta.label}</span>
                  </span>
                );
              })}
            </div>
          </div>

          <span className="text-slate-400 text-[10px]">
            滑鼠按住畫布可平移 · 點選任一節點切換到對應分組
          </span>
        </div>
      </div>
    </div>
  );
};
