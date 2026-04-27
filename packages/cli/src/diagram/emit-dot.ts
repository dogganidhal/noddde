import type { DomainGraph, GraphNode } from "./types.js";

const MODEL_ORDER: Array<{ model: GraphNode["model"]; title: string }> = [
  { model: "write", title: "Write Model" },
  { model: "read", title: "Read Model" },
  { model: "process", title: "Process Model" },
  { model: "external", title: "External" },
];

/** Emits a Graphviz DOT digraph with one cluster per model. */
export function emitDot(graph: DomainGraph): string {
  const lines: string[] = [
    "digraph G {",
    "  rankdir=LR;",
    "  node [shape=box];",
  ];

  for (const { model, title } of MODEL_ORDER) {
    const nodes = graph.nodes.filter((n) => n.model === model);
    if (nodes.length === 0) continue;
    lines.push(`  subgraph cluster_${model} {`);
    lines.push(`    label="${title}";`);
    for (const node of nodes) {
      lines.push(
        `    "${node.id}" [label="${escapeLabel(node.label)}", shape=${shapeFor(node)}];`,
      );
    }
    lines.push("  }");
  }

  for (const edge of graph.edges) {
    const style = edge.source === "static" ? ' [style="dashed"]' : "";
    lines.push(`  "${edge.from}" -> "${edge.to}"${style};`);
  }

  lines.push("}");
  return lines.join("\n");
}

function shapeFor(node: GraphNode): string {
  switch (node.kind) {
    case "command":
    case "event":
    case "query":
      return "ellipse";
    case "aggregate":
    case "projection":
    case "saga":
      return "box3d";
  }
}

function escapeLabel(value: string): string {
  return value.replace(/"/g, '\\"');
}
