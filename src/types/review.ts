/**
 * Core type definitions for GitLab MR Analysis and Review
 */


export type ReviewCategory =
  | 'bug'
  | 'performance'
  | 'a11y'
  | 'readability'
  | 'style'
  | 'test'
  | 'config';

export type ReviewSeverity = 'high' | 'medium' | 'low';

export type NodeKind = 'component' | 'hook' | 'store' | 'api' | 'util' | 'test' | 'other';

export interface MRGroup {
  id: string;
  name: string;
  summary: string;
  files: string[];
  additions: number;
  deletions: number;
}

export interface MRGraphNode {
  id: string;
  label: string;
  groupId: string;
  kind: NodeKind;
}

export interface MRGraphEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface MRGraph {
  nodes: MRGraphNode[];
  edges: MRGraphEdge[];
}

export interface MRReviewItem {
  groupId: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  file: string;
  line: number | null;
  codeSnippet: string;
  comment: string;
  suggestion: string;
  newLine?: number | null;
  oldLine?: number | null;
  lineVerified?: boolean;
  checklistId?: string | null;
}

export interface ChecklistCoverageItem {
  id: string;
  hit: boolean;
  files: string[];
}

export interface MRAnalysisResult {
  schemaVersion: 1;
  title: string;
  description: string;
  summary: string[];
  testSuggestions: string[];
  groups: MRGroup[];
  graph: MRGraph;
  checklistCoverage?: ChecklistCoverageItem[];
  reviews: MRReviewItem[];
}

export interface WritingCheckViolation {
  type: 'too_long' | 'vague_wording';
  message: string;
  detail?: string;
}
