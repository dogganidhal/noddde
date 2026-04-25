/**
 * Logical category for a graph node. Drives styling, shape, and subgraph
 * assignment in emitters.
 */
export type GraphNodeKind =
  | "command"
  | "event"
  | "query"
  | "aggregate"
  | "projection"
  | "saga";

/**
 * Which top-level model a node belongs to. `external` is reserved for
 * commands that a saga dispatches but no aggregate handles.
 */
export type GraphNodeModel = "write" | "read" | "process" | "external";

/** A node in the domain flow graph. */
export interface GraphNode {
  /** Stable, unique key. Format: `<kind>:<name>` (e.g. `command:PlaceBid`). */
  id: string;
  /** Human-readable display name. */
  label: string;
  kind: GraphNodeKind;
  model: GraphNodeModel;
}

/** Origin of an edge — runtime introspection or TypeScript-level resolution. */
export type GraphEdgeSource = "runtime" | "static";

/** A directed edge between two nodes. */
export interface GraphEdge {
  from: string;
  to: string;
  source: GraphEdgeSource;
}

/** Output graph consumed by emitters. */
export interface DomainGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

export type DiagramFormat = "mermaid" | "dot" | "json";

export type DiagramScope = "write" | "read" | "process" | "all";

export interface DiagramOptions {
  format?: DiagramFormat;
  scope?: DiagramScope;
  hideIsolated?: boolean;
  tsconfigPath?: string;
}

/** Build a node id from kind + name. Always use this — never concatenate. */
export function nodeId(kind: GraphNodeKind, name: string): string {
  return `${kind}:${name}`;
}
