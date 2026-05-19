---
title: "DomainDefinition & defineDomain"
module: ddd/domain-definition
source_file: packages/core/src/ddd/domain-definition.ts
status: implemented
exports: [DomainDefinition, defineDomain]
depends_on:
  - ddd/aggregate-root
  - ddd/projection
  - ddd/saga
  - cqrs/command/command
  - cqrs/command/command-handler
  - cqrs/query/query
  - cqrs/query/query-handler
  - edd/event
  - edd/event-handler
  - infrastructure
docs:
  - getting-started/quick-start.mdx
  - running/domain-configuration.mdx
  - modeling/routing-and-dispatch.mdx
---

# DomainDefinition & defineDomain

> The pure, structural side of the domain API: a typed object describing aggregates, projections, sagas, and handler registrations, and a sync identity function that returns it with full type inference. No runtime, no infrastructure, no I/O — just the **shape** of a domain. This separation lets domain definitions be authored, shared, tested, and analyzed in `@noddde/core` independent of how (or whether) they are later wired to runtime infrastructure via `@noddde/engine`.

## Type Contract

```ts
/**
 * Maps command names to standalone command handlers. File-private — exposed
 * only as part of DomainDefinition's writeModel.standaloneCommandHandlers.
 */
type StandaloneCommandHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command,
> = {
  [CommandName in TStandaloneCommand["name"]]?: StandaloneCommandHandler<
    TInfrastructure,
    Extract<TStandaloneCommand, { name: CommandName }>
  >;
};

/**
 * Maps query names to standalone query handlers. File-private — exposed
 * only as part of DomainDefinition's readModel.standaloneQueryHandlers.
 */
type StandaloneQueryHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneQuery extends Query<any>,
> = {
  [QueryName in TStandaloneQuery["name"]]?: QueryHandler<
    TInfrastructure,
    Extract<TStandaloneQuery, { name: QueryName }>
  >;
};

/**
 * Maps event names to standalone event handlers. File-private — exposed
 * only as part of DomainDefinition's processModel.standaloneEventHandlers.
 */
type StandaloneEventHandlerMap<
  TInfrastructure extends Infrastructure,
  TStandaloneEvent extends Event,
> = {
  [EventName in TStandaloneEvent["name"]]?: EventHandler<
    Extract<TStandaloneEvent, { name: EventName }>,
    TInfrastructure
  >;
};

/**
 * Pure structural definition of a domain. Contains aggregates, projections,
 * sagas, and handler registrations — no runtime or infrastructure concerns.
 *
 * Created via {@link defineDomain}. Pass to `wireDomain` (from `@noddde/engine`)
 * along with infrastructure wiring to create a running `Domain` instance.
 */
type DomainDefinition<
  TInfrastructure extends Infrastructure = Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends Record<string | symbol, Aggregate<any>> = Record<
    string | symbol,
    Aggregate<any>
  >,
  TStandaloneEvent extends Event = Event,
  TProjections extends Record<string | symbol, Projection<any>> = Record<
    string | symbol,
    Projection<any>
  >,
> = {
  /** The write side: aggregates and standalone command handlers. */
  writeModel: {
    /** A map of aggregate definitions keyed by aggregate name. */
    aggregates: TAggregates;
    /** Optional map of standalone command handlers keyed by command name. */
    standaloneCommandHandlers?: StandaloneCommandHandlerMap<
      TInfrastructure,
      TStandaloneCommand
    >;
  };
  /** The read side: projections and standalone query handlers. */
  readModel: {
    /** A map of projection definitions keyed by projection name. */
    projections: TProjections;
    /** Optional map of standalone query handlers keyed by query name. */
    standaloneQueryHandlers?: StandaloneQueryHandlerMap<
      TInfrastructure,
      TStandaloneQuery
    >;
  };
  /**
   * Process model: sagas and standalone event handlers. Optional — omit if
   * the domain has no cross-aggregate workflows or event-driven side effects.
   */
  processModel?: {
    /** A map of saga definitions keyed by saga name. Optional — omit if no sagas. */
    sagas?: Record<string | symbol, Saga<any, any>>;
    /** Optional map of standalone event handlers keyed by event name. */
    standaloneEventHandlers?: StandaloneEventHandlerMap<
      TInfrastructure,
      TStandaloneEvent
    >;
  };
};

/**
 * Creates a pure, sync domain definition with full type inference.
 * Consistent with defineAggregate, defineProjection, defineSaga.
 *
 * Overload 1 (preferred): Infers all types from the definition object,
 * preserving narrow aggregate/projection types for typed dispatch
 * downstream (in wireDomain / Domain).
 *
 * Overload 2 (legacy, deprecated): Explicit infrastructure generic for
 * standalone handler typing. Typed dispatch is NOT available because
 * TypeScript cannot infer TAggregates/TProjections when explicit
 * generics are provided.
 */
function defineDomain<T extends DomainDefinition<any, any, any, any, any, any>>(
  definition: T,
): T;
/** @deprecated Prefer calling defineDomain({...}) without explicit generics. */
function defineDomain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregates extends Record<string | symbol, Aggregate<any>> = Record<
    string | symbol,
    Aggregate<any>
  >,
  TStandaloneEvent extends Event = Event,
  TProjections extends Record<string | symbol, Projection<any>> = Record<
    string | symbol,
    Projection<any>
  >,
>(
  definition: DomainDefinition<
    TInfrastructure,
    TStandaloneCommand,
    TStandaloneQuery,
    TAggregates,
    TStandaloneEvent,
    TProjections
  >,
): DomainDefinition<
  TInfrastructure,
  TStandaloneCommand,
  TStandaloneQuery,
  TAggregates,
  TStandaloneEvent,
  TProjections
>;
```

- **`DomainDefinition<TInfrastructure, TStandaloneCommand, TStandaloneQuery, TAggregates, TStandaloneEvent, TProjections>`** captures the pure domain structure: write model (aggregates + standalone command handlers), read model (projections + standalone query handlers), and optional process model (sagas + standalone event handlers).
- `TInfrastructure` is a type parameter only — handler signatures reference it but no infrastructure value is present in the definition. Infrastructure is wired separately by `wireDomain` (`@noddde/engine`).
- `TAggregates` and `TProjections` carry the typed maps inferred from `writeModel.aggregates` and `readModel.projections`. Their narrow inference is what enables `wireDomain` to compute typed `dispatchCommand` and `dispatchQuery` signatures.
- The internal types `StandaloneCommandHandlerMap`, `StandaloneQueryHandlerMap`, and `StandaloneEventHandlerMap` are file-private structural helpers — they are not exported.
- **`defineDomain`** is a sync identity function with two overloads:
  - **Overload 1 (preferred)**: A single type parameter `T extends DomainDefinition<any, any, any, any, any, any>` — TypeScript infers `T` from the definition argument, preserving the narrow aggregate/projection types required for typed dispatch downstream.
  - **Overload 2 (legacy, deprecated)**: Six explicit type parameters matching `DomainDefinition`'s shape. Standalone handler infrastructure is typed, but `TAggregates`/`TProjections` cannot be inferred when explicit generics are provided — typed dispatch is therefore unavailable in this form. Use only for backward compatibility with existing call sites.
- Both overloads return the exact input definition object — no copy, no transformation. The implementation is `(definition) => definition`.

## Behavioral Requirements

### defineDomain() — Identity Function

1. Accept a `DomainDefinition` object.
2. Return the **same** object unchanged (reference equality with the input).
3. This is a **sync** function — no async, no side effects, no factories called, no I/O.
4. Consistent with `defineAggregate`, `defineProjection`, `defineSaga`.

### Type inference (Overload 1, preferred)

1. With no explicit type arguments, TypeScript infers `T` from the definition argument.
2. The narrow shapes of `writeModel.aggregates` and `readModel.projections` are preserved on the return value.
3. `processModel` may be omitted; its absence is reflected on the result type.

### Type inference (Overload 2, legacy)

1. When the caller specifies explicit generics — at minimum `TInfrastructure` — the second overload matches.
2. The handler maps within `writeModel.standaloneCommandHandlers`, `readModel.standaloneQueryHandlers`, and `processModel.standaloneEventHandlers` are typed against the supplied `TStandaloneCommand` / `TStandaloneQuery` / `TStandaloneEvent`.
3. The narrow aggregate/projection types are widened to the constraint defaults (`Record<string | symbol, Aggregate<any>>` / `Record<string | symbol, Projection<any>>`) because explicit generics block inference. Typed dispatch downstream is therefore unavailable.
4. The overload is marked `@deprecated`.

## Invariants

- `defineDomain` is sync, pure, and has no side effects. It returns the input unchanged.
- `defineDomain(x) === x` — reference equality with the input.
- No runtime work happens in `defineDomain`. No infrastructure is touched, no factory is called.
- `DomainDefinition` is a structural type only — there is no associated class, instance, or runtime object.
- `DomainDefinition.writeModel.aggregates` and `DomainDefinition.readModel.projections` are required. They may be empty objects (`{}`).
- `DomainDefinition.processModel` is optional. When omitted entirely, the domain has no sagas and no standalone event handlers.
- The three handler maps (`standaloneCommandHandlers`, `standaloneQueryHandlers`, `standaloneEventHandlers`) are file-private to the source file — they are not exported and exist only as the type of the corresponding fields on `DomainDefinition`.

## Edge Cases

- **`defineDomain` called multiple times** — Each call returns a fresh reference (whatever the caller passed in). No state is shared between calls.
- **Empty maps** — `writeModel.aggregates: {}` and `readModel.projections: {}` are valid; the result is a domain definition with no commands routed to aggregates and no projections.
- **`processModel` omitted vs. `processModel: {}`** — Both are valid. `{}` is shorthand for "process model exists but is empty"; downstream wiring treats them identically (no sagas, no standalone event handlers).
- **`processModel.sagas` omitted but `standaloneEventHandlers` set** — Valid: the domain has standalone event handlers but no sagas.
- **`writeModel.standaloneCommandHandlers` empty object (`{}`)** — Valid. Equivalent to omitting the field.
- **Handler key not in the standalone command/query/event union** — TypeScript rejects the call at compile time because the mapped type only permits keys from the union.
- **Calling Overload 2 with explicit `TInfrastructure` but no other generics** — The remaining generics default to the broadest constraints. Standalone handlers are typed; typed dispatch downstream is unavailable.
- **Definition object mutated after `defineDomain` returns** — Mutations are visible on the returned reference (the function is a pure identity, not a copy). Callers should treat the definition as immutable.

## Integration Points

- **`@noddde/engine`** — `wireDomain` accepts a `DomainDefinition` and produces a running `Domain` instance. `wireDomain` reads the narrow `TAggregates` and `TProjections` inferred by Overload 1 of `defineDomain` to compute the typed `dispatchCommand` and `dispatchQuery` signatures on the returned `Domain`. For backward compatibility, `@noddde/engine` re-exports both `DomainDefinition` and `defineDomain` from `@noddde/core`, so existing imports `from "@noddde/engine"` continue to work.
- **`@noddde/core/ddd`** — `defineDomain` composes the four "definition" primitives (`defineAggregate`, `defineProjection`, `defineSaga`, and standalone handler functions) into a single domain shape. The handler-signature types (`StandaloneCommandHandler`, `QueryHandler`, `EventHandler`) come from the existing core modules.
- **CLI scaffolding (`@noddde/cli`)** — Templates that scaffold a `defineDomain(...)` call may import from either `@noddde/core` (canonical) or `@noddde/engine` (back-compat). The template choice is a downstream decision; this spec does not mandate one.

## Test Scenarios

### defineDomain returns the input unchanged with type inference

```ts
import { describe, it, expect } from "vitest";
import { defineDomain, defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("defineDomain (core)", () => {
  it("returns the same object reference (identity)", () => {
    const input = {
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    };

    const definition = defineDomain(input);

    expect(definition).toBe(input);
  });

  it("preserves writeModel, readModel, and processModel as provided", () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    expect(definition.writeModel.aggregates).toEqual({ Counter });
    expect(definition.readModel.projections).toEqual({});
    expect(definition.processModel).toBeUndefined();
  });

  it("accepts an empty domain (no aggregates, no projections, no process model)", () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    expect(definition.writeModel.aggregates).toEqual({});
    expect(definition.readModel.projections).toEqual({});
    expect(definition.processModel).toBeUndefined();
  });

  it("returns a fresh reference per call", () => {
    const a = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });
    const b = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    expect(a).not.toBe(b);
  });
});
```

### defineDomain accepts the legacy explicit-generic overload

```ts
import { describe, it, expect } from "vitest";
import { defineDomain } from "@noddde/core";
import type { Infrastructure } from "@noddde/core";

describe("defineDomain (core) — legacy overload", () => {
  it("accepts an explicit TInfrastructure generic and returns the input", () => {
    const input = {
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    };

    const definition = defineDomain<Infrastructure>(input);

    expect(definition).toBe(input);
  });
});
```

### defineDomain supports processModel with sagas and standalone event handlers

```ts
import { describe, it, expect } from "vitest";
import { defineDomain } from "@noddde/core";

describe("defineDomain (core) — processModel", () => {
  it("accepts processModel with sagas omitted but standaloneEventHandlers present", () => {
    const handler = async () => {};
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          SomethingHappened: handler,
        },
      },
    });

    expect(definition.processModel).toBeDefined();
    expect(definition.processModel?.sagas).toBeUndefined();
    expect(definition.processModel?.standaloneEventHandlers).toEqual({
      SomethingHappened: handler,
    });
  });

  it("accepts processModel as an empty object", () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: {},
    });

    expect(definition.processModel).toEqual({});
  });
});
```

### @noddde/engine re-exports defineDomain and DomainDefinition from @noddde/core

```ts
import { describe, it, expect } from "vitest";
import { defineDomain as coreDefineDomain } from "@noddde/core";
import { defineDomain as engineDefineDomain } from "@noddde/engine";

describe("defineDomain re-export from @noddde/engine", () => {
  it("the engine package re-exports the same function reference as core", () => {
    expect(engineDefineDomain).toBe(coreDefineDomain);
  });
});
```
