import type { DomainDefinition } from "@noddde/engine";
import type { GraphEdge, GraphNode } from "./types.js";
import { nodeId } from "./types.js";

interface IntrospectResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Walks a `DomainDefinition` and produces nodes + runtime-discoverable edges.
 *
 * Covers five of the six edge types:
 *   - command → aggregate           (`Object.keys(aggregate.decide)`)
 *   - aggregate → event             (`Object.keys(aggregate.evolve)`)
 *   - event → projection            (`Object.keys(projection.on)`)
 *   - query → projection            (`Object.keys(projection.queryHandlers)`)
 *   - event → saga                  (`saga.startedBy` ∪ `Object.keys(saga.on)`)
 *
 * The sixth edge (saga → command) requires TypeScript-level resolution of
 * the saga's `commands` discriminated union — see `static-analyze.ts`.
 */
export function introspectDomain(
  definition: DomainDefinition,
): IntrospectResult {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const ensureNode = (node: GraphNode): void => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
    }
  };

  const aggregates = definition.writeModel?.aggregates ?? {};
  for (const [aggregateName, aggregate] of Object.entries(aggregates)) {
    if (!aggregate) continue;
    const aggId = nodeId("aggregate", aggregateName);
    ensureNode({
      id: aggId,
      label: aggregateName,
      kind: "aggregate",
      model: "write",
    });

    for (const commandName of Object.keys(aggregate.decide ?? {})) {
      const cmdId = nodeId("command", commandName);
      ensureNode({
        id: cmdId,
        label: commandName,
        kind: "command",
        model: "write",
      });
      edges.push({ from: cmdId, to: aggId, source: "runtime" });
    }

    for (const eventName of Object.keys(aggregate.evolve ?? {})) {
      const evtId = nodeId("event", eventName);
      ensureNode({
        id: evtId,
        label: eventName,
        kind: "event",
        model: "write",
      });
      edges.push({ from: aggId, to: evtId, source: "runtime" });
    }
  }

  const projections = definition.readModel?.projections ?? {};
  for (const [projectionName, projection] of Object.entries(projections)) {
    if (!projection) continue;
    const projId = nodeId("projection", projectionName);
    ensureNode({
      id: projId,
      label: projectionName,
      kind: "projection",
      model: "read",
    });

    for (const eventName of Object.keys(projection.on ?? {})) {
      const evtId = nodeId("event", eventName);
      ensureNode({
        id: evtId,
        label: eventName,
        kind: "event",
        model: "write",
      });
      edges.push({ from: evtId, to: projId, source: "runtime" });
    }

    for (const queryName of Object.keys(projection.queryHandlers ?? {})) {
      const qId = nodeId("query", queryName);
      ensureNode({
        id: qId,
        label: queryName,
        kind: "query",
        model: "read",
      });
      edges.push({ from: qId, to: projId, source: "runtime" });
    }
  }

  const sagas = definition.processModel?.sagas ?? {};
  for (const [sagaName, saga] of Object.entries(sagas)) {
    if (!saga) continue;
    const sagaIdValue = nodeId("saga", sagaName);
    ensureNode({
      id: sagaIdValue,
      label: sagaName,
      kind: "saga",
      model: "process",
    });

    const triggerEvents = new Set<string>([
      ...(saga.startedBy ?? []),
      ...Object.keys(saga.on ?? {}),
    ]);
    for (const eventName of triggerEvents) {
      const evtId = nodeId("event", eventName);
      ensureNode({
        id: evtId,
        label: eventName,
        kind: "event",
        model: "write",
      });
      edges.push({ from: evtId, to: sagaIdValue, source: "runtime" });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}
