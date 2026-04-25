import type { DomainDefinition } from "@noddde/engine";
import { introspectDomain } from "./introspect.js";
import { analyzeSagaCommands } from "./static-analyze.js";
import {
  nodeId,
  type DiagramOptions,
  type DiagramScope,
  type DomainGraph,
  type GraphNode,
  type GraphNodeKind,
} from "./types.js";

/**
 * Builds a `DomainGraph` from a live `DomainDefinition` plus the entry file
 * path used to anchor the static-analysis pass.
 *
 * Steps:
 *   1. Runtime introspection (`introspectDomain`) — five edge types.
 *   2. Saga `commands` resolution via `analyzeSagaCommands` — the sixth edge.
 *   3. Scope filter and (optional) isolated-node filter.
 *
 * The 4th positional parameter `injectedSagaCommands` lets tests bypass the
 * TypeScript-compiler step with a pre-built map.
 */
export function buildDomainGraph(
  definition: DomainDefinition,
  entryFile: string,
  options: DiagramOptions = {},
  injectedSagaCommands?: Map<string, string[]>,
): DomainGraph {
  const scope: DiagramScope = options.scope ?? "all";
  const hideIsolated = options.hideIsolated ?? false;

  const { nodes, edges } = introspectDomain(definition);
  const warnings: string[] = [];

  const sagaKeys = Object.keys(definition.processModel?.sagas ?? {});
  let sagaCommands: Map<string, string[]>;
  if (injectedSagaCommands) {
    sagaCommands = injectedSagaCommands;
  } else if (sagaKeys.length === 0) {
    sagaCommands = new Map();
  } else {
    const analysis = analyzeSagaCommands(
      entryFile,
      sagaKeys,
      options.tsconfigPath,
    );
    sagaCommands = analysis.commands;
    warnings.push(...analysis.warnings);
  }

  const knownCommandNames = new Set(
    nodes.filter((n) => n.kind === "command").map((n) => n.label),
  );

  const nodeIndex = new Map<string, GraphNode>(
    nodes.map((n) => [n.id, n] as const),
  );

  for (const [sagaKey, commandNames] of sagaCommands) {
    const sagaIdValue = nodeId("saga", sagaKey);
    if (!nodeIndex.has(sagaIdValue)) continue;

    for (const commandName of commandNames) {
      const cmdId = nodeId("command", commandName);
      if (!nodeIndex.has(cmdId)) {
        const externalNode: GraphNode = {
          id: cmdId,
          label: commandName,
          kind: "command",
          model: "external",
        };
        nodeIndex.set(cmdId, externalNode);
        nodes.push(externalNode);
        warnings.push(
          `Saga '${sagaKey}' dispatches command '${commandName}', but no aggregate handles it. Marked as external.`,
        );
      } else if (!knownCommandNames.has(commandName)) {
        // Command came from a previous saga's static result; keep model from first sighting.
      }
      edges.push({ from: sagaIdValue, to: cmdId, source: "static" });
    }
  }

  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (scope !== "all") {
    const allowedModels = scopeAllowedModels(scope);
    const allowedKinds = scopeAllowedKinds(scope);

    filteredNodes = nodes.filter(
      (n) =>
        (allowedModels.has(n.model) || n.model === "external") &&
        allowedKinds.has(n.kind),
    );
    const keptIds = new Set(filteredNodes.map((n) => n.id));
    filteredEdges = edges.filter(
      (e) => keptIds.has(e.from) && keptIds.has(e.to),
    );
  }

  if (hideIsolated) {
    const degree = new Map<string, number>();
    for (const e of filteredEdges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    filteredNodes = filteredNodes.filter((n) => (degree.get(n.id) ?? 0) > 0);
    const keptIds = new Set(filteredNodes.map((n) => n.id));
    filteredEdges = filteredEdges.filter(
      (e) => keptIds.has(e.from) && keptIds.has(e.to),
    );
  }

  if (Object.keys(definition.writeModel?.aggregates ?? {}).length === 0) {
    warnings.push(
      "Domain has no aggregates; the diagram will be missing the write model.",
    );
  }

  return { nodes: filteredNodes, edges: filteredEdges, warnings };
}

function scopeAllowedModels(scope: DiagramScope): Set<string> {
  switch (scope) {
    case "write":
      return new Set(["write"]);
    case "read":
      return new Set(["read", "write"]);
    case "process":
      return new Set(["process", "write"]);
    default:
      return new Set(["write", "read", "process"]);
  }
}

function scopeAllowedKinds(scope: DiagramScope): Set<GraphNodeKind> {
  switch (scope) {
    case "write":
      return new Set<GraphNodeKind>(["command", "aggregate", "event"]);
    case "read":
      return new Set<GraphNodeKind>(["event", "projection", "query"]);
    case "process":
      return new Set<GraphNodeKind>(["event", "saga", "command"]);
    default:
      return new Set<GraphNodeKind>([
        "command",
        "event",
        "query",
        "aggregate",
        "projection",
        "saga",
      ]);
  }
}

export type { DomainGraph, GraphEdge, GraphNode } from "./types.js";
