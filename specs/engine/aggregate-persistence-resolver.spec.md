---
title: "AggregatePersistenceResolver"
module: engine/aggregate-persistence-resolver
source_file: packages/engine/src/aggregate-persistence-resolver.ts
status: implemented
exports: []
depends_on:
  - persistence
---

# AggregatePersistenceResolver

> `AggregatePersistenceResolver` is the strategy interface for resolving the correct aggregate persistence at command dispatch time. It follows the same strategy pattern as `ConcurrencyStrategy`. Two implementations are provided: `GlobalAggregatePersistenceResolver` (all aggregates share one persistence) and `PerAggregatePersistenceResolver` (each aggregate has its own persistence). Both are engine-internal — users configure persistence via `DomainConfiguration.infrastructure.aggregatePersistence`.

## Type Contract

```ts
import type { PersistenceConfiguration } from "@noddde/core";

interface AggregatePersistenceResolver {
  resolve(aggregateName: string): PersistenceConfiguration;
}

class GlobalAggregatePersistenceResolver
  implements AggregatePersistenceResolver
{
  constructor(persistence: PersistenceConfiguration);
  resolve(aggregateName: string): PersistenceConfiguration;
}

class PerAggregatePersistenceResolver implements AggregatePersistenceResolver {
  constructor(map: Map<string, PersistenceConfiguration>);
  resolve(aggregateName: string): PersistenceConfiguration;
}
```

- `AggregatePersistenceResolver` is the strategy interface. A single method `resolve` takes an aggregate name and returns the `PersistenceConfiguration` for that aggregate.
- `GlobalAggregatePersistenceResolver` wraps a single persistence instance, returning it for every aggregate name. This is used when `aggregatePersistence` is omitted or is a single factory function.
- `PerAggregatePersistenceResolver` wraps a `Map` of persistence instances keyed by aggregate name. This is used when `aggregatePersistence` is a per-aggregate record.
- All three types are engine-internal (`@internal`) and not exported from `@noddde/core`. They are constructed by `Domain.init()`.

## Behavioral Requirements

1. **GlobalAggregatePersistenceResolver.resolve** -- Always returns the same `PersistenceConfiguration` instance, regardless of the `aggregateName` parameter.
2. **PerAggregatePersistenceResolver.resolve** -- Looks up the `aggregateName` in the internal map. If found, returns the corresponding `PersistenceConfiguration`. If not found, throws an error: `No persistence configured for aggregate "${aggregateName}"`.

## Invariants

- `GlobalAggregatePersistenceResolver` always returns a non-null `PersistenceConfiguration`.
- `PerAggregatePersistenceResolver` returns a non-null `PersistenceConfiguration` for all aggregate names in the map. Throws for unknown names.
- Both implementations are synchronous. All async factory resolution happens at `Domain.init()` time, not at resolve time.

## Edge Cases

- **PerAggregatePersistenceResolver with unknown aggregate name** -- Throws a descriptive error. This should never happen in practice because `Domain.init()` validates the map against registered aggregates.
- **PerAggregatePersistenceResolver with empty map** -- Every call to `resolve` throws. This is valid but unusual (domain with no aggregates).

## Integration Points

- **Domain.init()** -- Constructs the appropriate resolver based on `aggregatePersistence` configuration.
- **CommandLifecycleExecutor** -- Receives the resolver and calls `resolve(aggregateName)` at the start of each `execute()` invocation.
- **ConcurrencyStrategy** -- Analogous engine-internal strategy pattern (`concurrency-strategy.ts`).

## Test Scenarios

### GlobalAggregatePersistenceResolver returns the same persistence for any aggregate

```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSourcedAggregatePersistence } from "@noddde/engine";
import { GlobalAggregatePersistenceResolver } from "../../../aggregate-persistence-resolver";

describe("GlobalAggregatePersistenceResolver", () => {
  it("should return the same persistence instance for any aggregate name", () => {
    const persistence = new InMemoryEventSourcedAggregatePersistence();
    const resolver = new GlobalAggregatePersistenceResolver(persistence);

    expect(resolver.resolve("Foo")).toBe(persistence);
    expect(resolver.resolve("Bar")).toBe(persistence);
    expect(resolver.resolve("Foo")).toBe(resolver.resolve("Bar"));
  });
});
```

### PerAggregatePersistenceResolver returns the correct persistence per aggregate

```ts
import { describe, it, expect } from "vitest";
import {
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
} from "@noddde/engine";
import { PerAggregatePersistenceResolver } from "../../../aggregate-persistence-resolver";

describe("PerAggregatePersistenceResolver", () => {
  it("should return the correct persistence for each aggregate name", () => {
    const esPersistence = new InMemoryEventSourcedAggregatePersistence();
    const ssPersistence = new InMemoryStateStoredAggregatePersistence();
    const map = new Map([
      ["Counter", esPersistence],
      ["BankAccount", ssPersistence],
    ]);
    const resolver = new PerAggregatePersistenceResolver(map);

    expect(resolver.resolve("Counter")).toBe(esPersistence);
    expect(resolver.resolve("BankAccount")).toBe(ssPersistence);
  });

  it("should throw for unknown aggregate names", () => {
    const map = new Map([
      ["Counter", new InMemoryEventSourcedAggregatePersistence()],
    ]);
    const resolver = new PerAggregatePersistenceResolver(map);

    expect(() => resolver.resolve("NonExistent")).toThrow(
      /No persistence configured for aggregate "NonExistent"/,
    );
  });
});
```
