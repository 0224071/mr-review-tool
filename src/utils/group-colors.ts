/**
 * Synchronized group color palette for GroupFilterBar and Dagre StructuralGraphView.
 */

export interface GroupColorTheme {
  border: string;
  bg: string;
  bgLight: string;
  text: string;
  badge: string;
  svgFill: string;
  svgStroke: string;
  svgText: string;
}

const PALETTE: GroupColorTheme[] = [
  {
    border: 'border-indigo-500',
    bg: 'bg-indigo-600',
    bgLight: 'bg-indigo-50',
    text: 'text-indigo-700',
    badge: 'bg-indigo-100 text-indigo-800',
    svgFill: 'var(--color-group-1-bg)',
    svgStroke: 'var(--color-group-1)',
    svgText: 'var(--color-group-1-text)',
  },
  {
    border: 'border-emerald-500',
    bg: 'bg-emerald-600',
    bgLight: 'bg-emerald-50',
    text: 'text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-800',
    svgFill: 'var(--color-group-2-bg)',
    svgStroke: 'var(--color-group-2)',
    svgText: 'var(--color-group-2-text)',
  },
  {
    border: 'border-sky-500',
    bg: 'bg-sky-600',
    bgLight: 'bg-sky-50',
    text: 'text-sky-700',
    badge: 'bg-sky-100 text-sky-800',
    svgFill: 'var(--color-group-3-bg)',
    svgStroke: 'var(--color-group-3)',
    svgText: 'var(--color-group-3-text)',
  },
  {
    border: 'border-purple-500',
    bg: 'bg-purple-600',
    bgLight: 'bg-purple-50',
    text: 'text-purple-700',
    badge: 'bg-purple-100 text-purple-800',
    svgFill: 'var(--color-group-4-bg)',
    svgStroke: 'var(--color-group-4)',
    svgText: 'var(--color-group-4-text)',
  },
  {
    border: 'border-amber-500',
    bg: 'bg-amber-600',
    bgLight: 'bg-amber-50',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-800',
    svgFill: 'var(--color-group-5-bg)',
    svgStroke: 'var(--color-group-5)',
    svgText: 'var(--color-group-5-text)',
  },
  {
    border: 'border-rose-500',
    bg: 'bg-rose-600',
    bgLight: 'bg-rose-50',
    text: 'text-rose-700',
    badge: 'bg-rose-100 text-rose-800',
    svgFill: 'var(--color-group-6-bg)',
    svgStroke: 'var(--color-group-6)',
    svgText: 'var(--color-group-6-text)',
  },
  {
    border: 'border-cyan-500',
    bg: 'bg-cyan-600',
    bgLight: 'bg-cyan-50',
    text: 'text-cyan-700',
    badge: 'bg-cyan-100 text-cyan-800',
    svgFill: 'var(--color-group-7-bg)',
    svgStroke: 'var(--color-group-7)',
    svgText: 'var(--color-group-7-text)',
  },
  {
    border: 'border-violet-500',
    bg: 'bg-violet-600',
    bgLight: 'bg-violet-50',
    text: 'text-violet-700',
    badge: 'bg-violet-100 text-violet-800',
    svgFill: 'var(--color-group-8-bg)',
    svgStroke: 'var(--color-group-8)',
    svgText: 'var(--color-group-8-text)',
  },
];

export function getGroupColor(groupId: string, index: number = 0): GroupColorTheme {
  if (!groupId) return PALETTE[0];
  // Stable hash based on groupId
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash << 5) - hash + groupId.charCodeAt(i);
    hash |= 0;
  }
  const colorIndex = Math.abs(hash + index) % PALETTE.length;
  return PALETTE[colorIndex];
}
