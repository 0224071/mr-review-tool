import dagre from 'dagre';
import { MRGraph, MRGraphEdge, MRGraphNode } from '../types/review';

export interface LayoutedNode extends MRGraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutedEdge extends MRGraphEdge {
  points: Array<{ x: number; y: number }>;
}

export interface LayoutedGraph {
  nodes: LayoutedNode[];
  edges: LayoutedEdge[];
  width: number;
  height: number;
}

/**
 * Pure function to calculate coordinates of nodes and edges using dagre.
 * Decoupled from rendering so it can run anywhere (SVG, canvas, SSR).
 */
export function computeDagreLayout(
  graph: MRGraph,
  options: {
    direction?: 'LR' | 'TB';
    nodeWidth?: number;
    nodeHeight?: number;
  } = {}
): LayoutedGraph {
  const { direction = 'LR', nodeWidth = 180, nodeHeight = 56 } = options;

  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return { nodes: [], edges: [], width: 300, height: 150 };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 70,
    marginx: 30,
    marginy: 30,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Ensure all node IDs exist in graph
  const validNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    validNodeIds.add(node.id);
    g.setNode(node.id, {
      label: node.label,
      width: nodeWidth,
      height: nodeHeight,
    });
  }

  // Filter valid edges to prevent dagre crashes on orphan/mistyped IDs
  const validEdges: MRGraphEdge[] = [];
  if (graph.edges) {
    for (const edge of graph.edges) {
      if (validNodeIds.has(edge.from) && validNodeIds.has(edge.to)) {
        g.setEdge(edge.from, edge.to, { label: edge.label || '' });
        validEdges.push(edge);
      }
    }
  }

  dagre.layout(g);

  const layoutedNodes: LayoutedNode[] = graph.nodes.map((node) => {
    const dagreNode = g.node(node.id);
    return {
      ...node,
      // dagre gives center (x, y)
      x: dagreNode ? dagreNode.x : 0,
      y: dagreNode ? dagreNode.y : 0,
      width: dagreNode ? dagreNode.width : nodeWidth,
      height: dagreNode ? dagreNode.height : nodeHeight,
    };
  });

  const layoutedEdges: LayoutedEdge[] = validEdges.map((edge) => {
    const dagreEdge = g.edge(edge.from, edge.to);
    return {
      ...edge,
      points: dagreEdge && dagreEdge.points ? dagreEdge.points : [],
    };
  });

  const graphInfo = g.graph();
  const width = Math.max((graphInfo && graphInfo.width) || 400, 300);
  const height = Math.max((graphInfo && graphInfo.height) || 200, 150);

  return {
    nodes: layoutedNodes,
    edges: layoutedEdges,
    width: width + 60,
    height: height + 60,
  };
}
