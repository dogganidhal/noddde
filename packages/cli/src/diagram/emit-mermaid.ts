import type { DomainGraph, GraphNode, GraphNodeKind } from "./types.js";

const MODEL_ORDER: Array<{
  model: GraphNode["model"];
  title: string;
}> = [
  { model: "write", title: "Write Model" },
  { model: "read", title: "Read Model" },
  { model: "process", title: "Process Model" },
  { model: "external", title: "External" },
];

/**
 * Emits a Mermaid `flowchart LR` diagram. Solid arrows mark runtime-derived
 * edges; dashed arrows mark statically-resolved (saga → command) edges.
 *
 * Canonical `DomainGraph` ids contain `:` (e.g. `command:PlaceBid`); Mermaid
 * parsers reject the colon in identifier position, so we sanitize to `_` for
 * Mermaid output only — the JSON / DOT emitters keep the original ids.
 */
export function emitMermaid(graph: DomainGraph): string {
  const lines: string[] = ["flowchart LR"];

  const styleHeader = renderClassDefs();
  if (styleHeader.length > 0) lines.push(...styleHeader);

  for (const { model, title } of MODEL_ORDER) {
    const nodes = graph.nodes.filter((n) => n.model === model);
    if (nodes.length === 0) continue;
    lines.push(`  subgraph ${subgraphId(model)}["${title}"]`);
    for (const node of nodes) {
      lines.push(`    ${renderNode(node)}`);
    }
    lines.push(`  end`);
  }

  for (const edge of graph.edges) {
    const arrow = edge.source === "static" ? "-.->" : "-->";
    lines.push(`  ${mermaidId(edge.from)} ${arrow} ${mermaidId(edge.to)}`);
  }

  for (const node of graph.nodes) {
    lines.push(
      `  class ${mermaidId(node.id)} ${classFor(node.kind, node.model)};`,
    );
  }

  return lines.join("\n");
}

function renderNode(node: GraphNode): string {
  const id = mermaidId(node.id);
  switch (node.kind) {
    case "command":
    case "event":
    case "query":
      return `${id}(["${node.label}"])`;
    case "aggregate":
    case "projection":
    case "saga":
      return `${id}[["${node.label}"]]`;
  }
}

/** Mermaid forbids `:` in node identifiers — replace with `_`. */
function mermaidId(canonicalId: string): string {
  return canonicalId.replace(/:/g, "_");
}

function classFor(kind: GraphNodeKind, model: GraphNode["model"]): string {
  if (model === "external") return "externalCmd";
  return kind;
}

function renderClassDefs(): string[] {
  return [
    "  classDef command fill:#dbeafe,stroke:#1e40af,color:#1e3a8a;",
    "  classDef event fill:#fef3c7,stroke:#a16207,color:#713f12;",
    "  classDef query fill:#dcfce7,stroke:#166534,color:#14532d;",
    "  classDef aggregate fill:#e0e7ff,stroke:#3730a3,color:#312e81,stroke-width:2px;",
    "  classDef projection fill:#ccfbf1,stroke:#115e59,color:#134e4a,stroke-width:2px;",
    "  classDef saga fill:#fce7f3,stroke:#9d174d,color:#831843,stroke-width:2px;",
    "  classDef externalCmd fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d,stroke-dasharray:4 4;",
  ];
}

function subgraphId(model: GraphNode["model"]): string {
  return `model_${model}`;
}
