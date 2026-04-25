---
title: "noddde diagram — flow diagram from a domain"
module: cli/diagram
source_file: packages/cli/src/commands/diagram.ts
status: implemented
exports:
  - registerDiagramCommand
  - DomainGraph
  - GraphNode
  - GraphEdge
  - buildDomainGraph
  - introspectDomain
  - analyzeSagaCommands
  - emitMermaid
  - emitDot
  - emitJson
depends_on:
  - core/ddd/aggregate-root
  - core/ddd/projection
  - core/ddd/saga
  - engine/domain
docs:
  - getting-started/cli.mdx
---

# noddde diagram

> A CLI command that loads a noddde domain module and emits a flow diagram of how commands, events, and queries traverse the system. Five of the six edge types are derived from runtime introspection of plain `defineAggregate`/`defineProjection`/`defineSaga` objects; only `Saga → Command` requires TypeScript-level type resolution because saga handlers construct commands inline. The default output is Mermaid, with DOT and JSON also supported. A normalized `DomainGraph` intermediate decouples introspection from emission.

## Type Contract

```ts
/** A node in the domain flow graph. */
export type GraphNode = {
  /** Stable, unique key. Format: `<kind>:<name>` (e.g. `command:PlaceBid`). */
  id: string;
  /** Human-readable display name (the command/event/query/component name). */
  label: string;
  /** Logical category for styling and subgraph assignment. */
  kind: "command" | "event" | "query" | "aggregate" | "projection" | "saga";
  /** Which top-level model this node belongs to. */
  model: "write" | "read" | "process" | "external";
};

/** A directed edge between two nodes. */
export type GraphEdge = {
  from: string; // GraphNode.id
  to: string; // GraphNode.id
  /**
   * `runtime` — derived from `Object.keys(...)` on the live domain.
   * `static`  — derived by resolving a TypeScript discriminated union.
   */
  source: "runtime" | "static";
};

/** The fully-normalized graph. Emitters consume only this type. */
export type DomainGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Non-fatal diagnostics surfaced to the user (missing handlers, fallbacks). */
  warnings: string[];
};

/** Output format. */
export type DiagramFormat = "mermaid" | "dot" | "json";

/** Subgraph filter. */
export type DiagramScope = "write" | "read" | "process" | "all";

/** Options for the top-level command and the build pipeline. */
export type DiagramOptions = {
  format?: DiagramFormat; // default "mermaid"
  scope?: DiagramScope; // default "all"
  hideIsolated?: boolean; // default false
  tsconfigPath?: string; // auto-detected from the entry's package
};

/** Pure builder. Combines runtime introspection + (lazy) static analysis. */
export function buildDomainGraph(
  definition: DomainDefinition,
  entryFile: string,
  options?: DiagramOptions,
): DomainGraph;

/** Runtime walk of a DomainDefinition — covers 5 of 6 edge types. */
export function introspectDomain(definition: DomainDefinition): {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** Result of saga command static analysis. */
export interface SagaCommandAnalysis {
  /** Map of `<sagaKey>` → list of dispatched command names. */
  commands: Map<string, string[]>;
  /** Sagas whose `commands` type could not be resolved to a finite union. */
  unresolved: string[];
  /** Diagnostic messages (e.g. tsconfig not found). */
  warnings: string[];
}

/**
 * Resolves each saga's `commands` discriminated union via the TS compiler API
 * and returns the set of command names per saga key. The `entryFile` is the
 * domain entry path; the analyzer resolves the saga symbols transitively.
 */
export function analyzeSagaCommands(
  entryFile: string,
  sagaKeys: string[],
  tsconfigPath?: string,
): SagaCommandAnalysis;

/** Emit a Mermaid `flowchart LR` diagram. */
export function emitMermaid(graph: DomainGraph): string;

/** Emit a Graphviz DOT digraph. */
export function emitDot(graph: DomainGraph): string;

/** Emit the JSON serialization of the graph. */
export function emitJson(graph: DomainGraph): string;

/** Registers the `noddde diagram` subcommand on the root program. */
export function registerDiagramCommand(program: Command): void;
```

## Behavioral Requirements

1. **Command → Aggregate edges** are produced from `Object.keys(aggregate.decide)` for each aggregate in `definition.writeModel.aggregates`. Each command name yields one node (`command:<name>`) and one edge to the aggregate node (`aggregate:<key>`).
2. **Aggregate → Event edges** are produced from `Object.keys(aggregate.evolve)` for each aggregate. The `EvolveHandlerMap` is required by the `Aggregate` type (keyed by `T["events"]["name"]`), so every emitted event has a corresponding key. Edge `source` is `"runtime"`.
3. **Event → Projection edges** are produced from `Object.keys(projection.on)` for each projection. The `on` map is partial; only the listed event names produce edges.
4. **Query → Projection edges** are produced from `Object.keys(projection.queryHandlers)` for each projection.
5. **Event → Saga edges** are produced from the union of `saga.startedBy` and `Object.keys(saga.on)` for each saga, deduplicated. `startedBy` is a non-empty tuple at the type level; the introspector treats both arrays the same way.
6. **Saga → Command edges** are produced by `analyzeSagaCommands`, which uses the TypeScript compiler API to resolve the `commands` field of each saga's type bundle (the type passed as the generic argument to `defineSaga`). The discriminated union members must each have a `name` property whose type is a string literal; those literals are the dispatched command names. Edge `source` is `"static"`.
7. **Multiple aggregates emitting the same event** produce a single event node with multiple incoming edges (one per emitter). The same applies to events handled by multiple projections or sagas.
8. **External commands** — when a saga's `analyzeSagaCommands` output contains a command name that no aggregate declares in its `decide` map, the command node is still created and tagged `model: "external"`. A warning is added to `graph.warnings`. This is one of the diagnostic outputs the tool exists to produce.
9. **Optional `processModel`** — when `definition.processModel?.sagas` is `undefined` or empty, no saga nodes or edges are produced and the static analysis pass is skipped entirely.
10. **`scope` filter** — when `scope !== "all"`, the graph filters out nodes whose `model` is not in the chosen scope, plus all edges referencing dropped nodes. `command`, `event`, and `query` nodes inherit their model from the component that produces them; events emitted by aggregates are `write`-model events and are kept under `scope: "write"`.
11. **`hideIsolated`** — when `true`, the builder removes nodes whose total degree (in + out) is zero after scope filtering.
12. **Format default** — `format: undefined` resolves to `"mermaid"`. `scope: undefined` resolves to `"all"`.
13. **Mermaid output structure** — emit `flowchart LR` with three `subgraph` blocks (`Write Model`, `Read Model`, `Process Model`), in that order. Empty subgraphs are omitted. Solid edges (`-->`) for `runtime` source; dashed edges (`-.->`) for `static`. Node shapes by kind: command/query/event = pill (`(["X"])`), aggregate/projection/saga = box (`[[X]]`).
14. **DOT output structure** — emit `digraph G { rankdir=LR; ... }` with cluster subgraphs (`subgraph cluster_write { ... }`). Edge style `solid` for runtime, `dashed` for static.
15. **JSON output** — emit `JSON.stringify(graph, null, 2)`. This is the contract for downstream consumers.
16. **CLI command** — `noddde diagram [domain-file]` defaults its first positional argument to `src/domain/domain.ts` resolved against `process.cwd()`. Flags: `--out <path>`, `--format <mermaid|dot|json>`, `--scope <write|read|process|all>`, `--hide-isolated`, `--tsconfig <path>`. When `--out` is omitted, the diagram is written to stdout.
17. **Domain loading** — the entry file is loaded with [tsx](https://github.com/privatenumber/tsx) via a programmatic API (`tsx.tsImport` or equivalent) so `.ts` files import without a prebuild. The loader expects the entry file to export `aggregates`, `projections`, and optionally `sagas` as named exports, OR to export a `definition` from `defineDomain(...)`. Both shapes are supported; the introspector synthesizes a minimal `DomainDefinition` from the named exports when the latter shape is absent.
18. **Error: side-effecting domain file** — if the dynamic import throws, the CLI prints a clear message ("Diagram failed to load `<entry>`. Ensure your domain module has no top-level infrastructure dependencies") and exits with code 1.
19. **Error: missing exports** — if neither `definition` nor `aggregates` is found on the imported module, exit with code 1 and a message naming the expected exports.

## Invariants

- Every edge's `from` and `to` reference an existing node in `graph.nodes`.
- `GraphNode.id` is unique across `graph.nodes`.
- A `command` node referenced by both an aggregate edge and a saga edge is **always** the same node (commands are deduplicated by name, never split). The `model` of such a node is `"write"` (a real handled command), never `"external"`.
- The graph contains no self-loops.
- `runtime`-source edges never depend on TypeScript resolution; the introspector pass alone is enough to produce them.

## Edge Cases

- **Domain with no projections**: write-model only. Read-model subgraph is omitted from Mermaid/DOT output.
- **Domain with no sagas**: process-model subgraph omitted; static analysis pass is skipped (no `tsconfig` resolution required).
- **Saga `commands` resolves to `Command` (the framework base type) with no literal `name`**: emit one warning per saga ("Saga `<key>` declares an unconstrained command type — no Saga→Command edges produced"). The saga still appears as a node with its incoming event edges.
- **Saga handler dispatches a command that no aggregate handles** (cross-domain or stub): keep the command node (`model: "external"`) and the saga→command edge; add a warning naming both.
- **Two aggregates emit an event with the same name**: one event node, two incoming edges. No collision.
- **Empty `aggregates` map** (rare but allowed by `DomainDefinition`): write-model subgraph omitted; warning added.
- **`tsconfigPath` not provided and not auto-discoverable**: walk up from the entry file looking for the nearest `tsconfig.json`. If none found, skip static analysis with a warning ("No tsconfig.json found; saga command edges will be omitted").
- **Mermaid identifier sanitization**: canonical `DomainGraph` ids contain `:` (e.g. `command:PlaceBid`), which Mermaid's parser rejects in identifier position. The Mermaid emitter replaces `:` with `_` (e.g. `command_PlaceBid`) when emitting node ids, edge endpoints, and `class` lines. The DOT emitter quotes ids and keeps the colon. The JSON output preserves the canonical ids verbatim.

## Integration Points

- **`@noddde/core`**: imports the `Aggregate`, `Projection`, `Saga` interfaces for typing. No runtime dependency.
- **`@noddde/engine`**: imports `DomainDefinition` for typing. No runtime dependency.
- **TypeScript compiler API** (`typescript` — already a dev dep): used by `analyzeSagaCommands`. The analyzer creates a `Program` rooted at the saga module's source file, locates each saga's call to `defineSaga<T>(...)`, resolves `T` to a type, walks the `commands` property type, and reads the literal `name` of each union member.
- **`tsx`**: a new runtime dep for `.ts` import without prebuild.
- **`commander`**: subcommand registration follows the existing `registerNewCommand` / `registerAddCommand` pattern in `packages/cli/src/index.ts`.

## Test Scenarios

The test file is `packages/cli/src/__tests__/diagram/diagram.test.ts`. Sample fixtures live at `samples/sample-auction`, `samples/sample-flash-sale`, and `samples/sample-hotel-booking` and are imported directly (no temp project setup needed for the introspector tests).

### Aggregate decide keys produce command nodes and command→aggregate edges

```ts
import { describe, it, expect } from "vitest";
import { introspectDomain } from "../../diagram/introspect";
import { aggregates as auctionAggregates } from "../../../../../../samples/sample-auction/src/domain/domain";

it("produces a command node + edge for each key in aggregate.decide", () => {
  const { nodes, edges } = introspectDomain({
    writeModel: { aggregates: auctionAggregates },
    readModel: { projections: {} },
  } as any);

  const commandNodes = nodes.filter((n) => n.kind === "command");
  const auctionDecideKeys = Object.keys(auctionAggregates.Auction.decide);
  expect(commandNodes.map((n) => n.label).sort()).toEqual(
    auctionDecideKeys.sort(),
  );

  for (const cmdName of auctionDecideKeys) {
    expect(
      edges.find(
        (e) => e.from === `command:${cmdName}` && e.to === `aggregate:Auction`,
      ),
    ).toBeDefined();
  }
});
```

### Aggregate evolve keys produce event nodes and aggregate→event edges

```ts
it("produces an event node + edge for each key in aggregate.evolve", () => {
  const { nodes, edges } = introspectDomain({
    writeModel: { aggregates: auctionAggregates },
    readModel: { projections: {} },
  } as any);

  const eventNodes = nodes.filter((n) => n.kind === "event");
  const auctionEvolveKeys = Object.keys(auctionAggregates.Auction.evolve);
  expect(eventNodes.map((n) => n.label).sort()).toEqual(
    auctionEvolveKeys.sort(),
  );

  for (const evtName of auctionEvolveKeys) {
    expect(
      edges.find(
        (e) => e.from === `aggregate:Auction` && e.to === `event:${evtName}`,
      ),
    ).toBeDefined();
  }
});
```

### Projection on keys produce event→projection edges

```ts
import { projections as auctionProjections } from "../../../../../../samples/sample-auction/src/domain/domain";

it("produces an event→projection edge for each key in projection.on", () => {
  const { edges } = introspectDomain({
    writeModel: { aggregates: auctionAggregates },
    readModel: { projections: auctionProjections },
  } as any);

  const summary = auctionProjections.AuctionSummary;
  for (const evtName of Object.keys(summary.on)) {
    expect(
      edges.find(
        (e) =>
          e.from === `event:${evtName}` && e.to === `projection:AuctionSummary`,
      ),
    ).toBeDefined();
  }
});
```

### Projection queryHandlers keys produce query→projection edges

```ts
it("produces a query→projection edge for each key in projection.queryHandlers", () => {
  const { edges } = introspectDomain({
    writeModel: { aggregates: auctionAggregates },
    readModel: { projections: auctionProjections },
  } as any);

  const summary = auctionProjections.AuctionSummary;
  for (const qName of Object.keys(summary.queryHandlers)) {
    expect(
      edges.find(
        (e) =>
          e.from === `query:${qName}` && e.to === `projection:AuctionSummary`,
      ),
    ).toBeDefined();
  }
});
```

### Saga startedBy and on keys both produce event→saga edges

```ts
import {
  aggregates as hotelAggregates,
  projections as hotelProjections,
  sagas as hotelSagas,
} from "../../../../../../samples/sample-hotel-booking/src/domain/domain";

it("produces event→saga edges for both startedBy and on keys", () => {
  const { edges } = introspectDomain({
    writeModel: { aggregates: hotelAggregates },
    readModel: { projections: hotelProjections },
    processModel: { sagas: hotelSagas },
  } as any);

  const fulfillment = hotelSagas.BookingFulfillment;
  const triggers = new Set([
    ...fulfillment.startedBy,
    ...Object.keys(fulfillment.on),
  ]);
  for (const evtName of triggers) {
    expect(
      edges.find(
        (e) =>
          e.from === `event:${evtName}` && e.to === `saga:BookingFulfillment`,
      ),
    ).toBeDefined();
  }
});
```

### Static analysis resolves SagaDef.commands to the literal command names

```ts
import { analyzeSagaCommands } from "../../diagram/static-analyze";
import path from "node:path";

it("extracts dispatched command names from a saga's command union", () => {
  const entryFile = path.resolve(
    __dirname,
    "../../../../../samples/sample-hotel-booking/src/domain/domain.ts",
  );
  const result = analyzeSagaCommands(entryFile, ["BookingFulfillment"]);

  const cmds = result.get("BookingFulfillment");
  expect(cmds).toBeDefined();
  // BookingCommand union members
  expect(cmds).toContain("ConfirmBooking");
  expect(cmds).toContain("CancelBooking");
  // RoomCommand union members
  expect(cmds).toContain("BlockRoom");
  expect(cmds).toContain("ReleaseRoom");
});
```

### Saga→command edges flag external commands and emit a warning

```ts
import { buildDomainGraph } from "../../diagram/build-graph";

it("marks saga-dispatched commands not handled by any aggregate as external", () => {
  // Synthetic case: saga dispatches "FooBar" but no aggregate has FooBar in decide.
  // We construct the saga static-analysis result directly to keep the test deterministic.
  const graph = buildDomainGraph(
    {
      writeModel: { aggregates: hotelAggregates },
      readModel: { projections: hotelProjections },
      processModel: { sagas: hotelSagas },
    } as any,
    "fake-entry.ts",
    {},
    // injected for testability
    new Map([["BookingFulfillment", ["ConfirmBooking", "FooBar"]]]),
  );

  const fooBarNode = graph.nodes.find((n) => n.id === "command:FooBar");
  expect(fooBarNode?.model).toBe("external");
  expect(
    graph.warnings.some((w) => w.includes("FooBar") && w.includes("external")),
  ).toBe(true);
});
```

### Mermaid emitter renders subgraphs and edge styles

```ts
import { emitMermaid } from "../../diagram/emit-mermaid";

it("emits Mermaid with subgraphs, pill nodes, and dashed static edges", () => {
  const graph: DomainGraph = {
    nodes: [
      {
        id: "command:CreateAuction",
        label: "CreateAuction",
        kind: "command",
        model: "write",
      },
      {
        id: "aggregate:Auction",
        label: "Auction",
        kind: "aggregate",
        model: "write",
      },
      {
        id: "event:AuctionCreated",
        label: "AuctionCreated",
        kind: "event",
        model: "write",
      },
      { id: "saga:Foo", label: "Foo", kind: "saga", model: "process" },
      {
        id: "command:DoFoo",
        label: "DoFoo",
        kind: "command",
        model: "external",
      },
    ],
    edges: [
      {
        from: "command:CreateAuction",
        to: "aggregate:Auction",
        source: "runtime",
      },
      {
        from: "aggregate:Auction",
        to: "event:AuctionCreated",
        source: "runtime",
      },
      { from: "event:AuctionCreated", to: "saga:Foo", source: "runtime" },
      { from: "saga:Foo", to: "command:DoFoo", source: "static" },
    ],
    warnings: [],
  };

  const out = emitMermaid(graph);
  expect(out).toMatch(/flowchart LR/);
  expect(out).toMatch(/subgraph .*Write Model/);
  expect(out).toMatch(/subgraph .*Process Model/);
  expect(out).toMatch(/\(\["CreateAuction"\]\)/);
  expect(out).toMatch(/\[\[Auction\]\]/);
  // Solid edge for runtime
  expect(out).toMatch(/command:CreateAuction --> aggregate:Auction/);
  // Dashed edge for static
  expect(out).toMatch(/saga:Foo -\.-> command:DoFoo/);
});
```

### JSON emitter is the canonical contract

```ts
import { emitJson } from "../../diagram/emit-json";

it("emits valid JSON that round-trips the graph", () => {
  const graph: DomainGraph = {
    nodes: [{ id: "command:X", label: "X", kind: "command", model: "write" }],
    edges: [],
    warnings: ["a warning"],
  };
  const out = emitJson(graph);
  expect(JSON.parse(out)).toEqual(graph);
});
```

### Scope filter drops nodes outside the chosen model

```ts
it("filters out read-model nodes when scope=write", () => {
  const graph = buildDomainGraph(
    {
      writeModel: { aggregates: auctionAggregates },
      readModel: { projections: auctionProjections },
    } as any,
    "fake.ts",
    { scope: "write" },
  );
  expect(graph.nodes.find((n) => n.kind === "projection")).toBeUndefined();
  expect(graph.nodes.find((n) => n.kind === "query")).toBeUndefined();
});
```

### Empty processModel produces no saga nodes and skips static analysis

```ts
it("skips the static analysis pass when there are no sagas", () => {
  const graph = buildDomainGraph(
    {
      writeModel: { aggregates: auctionAggregates },
      readModel: { projections: auctionProjections },
    } as any,
    "fake-entry.ts",
    {},
  );
  expect(graph.nodes.find((n) => n.kind === "saga")).toBeUndefined();
});
```
