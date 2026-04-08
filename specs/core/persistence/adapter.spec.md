---
title: "Persistence Adapter Interface"
module: core/persistence/adapter
source_file: packages/core/src/persistence/adapter.ts
status: implemented
exports:
  - PersistenceAdapter
  - isPersistenceAdapter
depends_on:
  - core/persistence/persistence
  - core/persistence/unit-of-work
  - core/persistence/snapshot
  - core/persistence/outbox
  - core/persistence/idempotency
  - core/infrastructure
docs:
  - docs/content/docs/infrastructure/orm-adapters.mdx
---

# Persistence Adapter Interface

> A standard interface for database adapters that plug into `wireDomain`. Adapter implementations (Drizzle, Prisma, TypeORM, etc.) implement `PersistenceAdapter` to provide persistence stores, unit-of-work factories, snapshot stores, and other infrastructure. The engine resolves missing wiring from the adapter automatically, eliminating repetitive boilerplate. Community adapter authors implement this single interface to be compatible with the framework.

## Type Contract

```ts
import type {
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  UnitOfWorkFactory,
  SnapshotStore,
  OutboxStore,
  IdempotencyStore,
  AggregateLocker,
} from "@noddde/core";

/**
 * Standard interface for database persistence adapters.
 *
 * Adapter classes implement this interface and are passed to `wireDomain`
 * via the `persistenceAdapter` property. The engine resolves aggregate
 * persistence, saga persistence, unit-of-work, snapshots, outbox,
 * idempotency, and locking from the adapter when not explicitly wired.
 *
 * Only `unitOfWorkFactory` is required. All other fields are optional
 * and validated at runtime: the engine errors if the domain needs a
 * capability the adapter doesn't provide.
 *
 * Does NOT extend `Closeable`. Adapters that hold resources implement
 * an optional `close()` method, auto-discovered by `isCloseable()`.
 */
export interface PersistenceAdapter {
  /** Required. Factory for creating unit-of-work instances. */
  unitOfWorkFactory: UnitOfWorkFactory;

  /** Shared event-sourced persistence. Optional. */
  eventSourcedPersistence?: EventSourcedAggregatePersistence;

  /** Shared state-stored persistence (default aggregate table). Optional. */
  stateStoredPersistence?: StateStoredAggregatePersistence;

  /** Saga state persistence. Optional — only needed when sagas are defined. */
  sagaPersistence?: SagaPersistence;

  /** Snapshot store for event-sourced aggregates. Optional. */
  snapshotStore?: SnapshotStore;

  /** Outbox store for transactional outbox pattern. Optional. */
  outboxStore?: OutboxStore;

  /** Idempotency store for command deduplication. Optional. */
  idempotencyStore?: IdempotencyStore;

  /** Aggregate locker for pessimistic concurrency. Optional. */
  aggregateLocker?: AggregateLocker;

  /**
   * Optional initialization hook. Called by `Domain.init()` before
   * any other resolution. Use for schema creation, migrations, etc.
   */
  init?(): Promise<void>;

  /**
   * Optional cleanup hook. Auto-discovered by `isCloseable()` and
   * called during `Domain.shutdown()`. Use for connection pool cleanup.
   * Must be idempotent.
   */
  close?(): Promise<void>;
}

/**
 * Runtime type guard for detecting PersistenceAdapter implementations.
 * Checks for the presence of `unitOfWorkFactory` — the only required field.
 *
 * @param value - The value to check.
 * @returns `true` if the value satisfies the PersistenceAdapter interface.
 */
export function isPersistenceAdapter(
  value: unknown,
): value is PersistenceAdapter;
```

## Behavioral Requirements

### Adapter resolution in wireDomain

1. When `persistenceAdapter` is provided in `DomainWiring`, the engine uses it as a fallback source for all persistence concerns not explicitly wired.
2. When `persistenceAdapter` is not provided, the engine behaves exactly as before (backward compatible — in-memory defaults or explicit wiring).

### Default aggregate persistence

3. When an adapter is present and an aggregate has no `persistence` declared, the engine defaults to `adapter.stateStoredPersistence`. DDD with state-stored aggregates is the primary use case; event sourcing is opt-in.
4. When an adapter is present but does not provide `stateStoredPersistence`, and an aggregate omits `persistence`, `wireDomain` throws an error at init time.

### Persistence shorthand resolution

5. `persistence: 'event-sourced'` resolves to `adapter.eventSourcedPersistence`. Error if adapter is absent or does not provide `eventSourcedPersistence`.
6. `persistence: 'state-stored'` resolves to `adapter.stateStoredPersistence`. Error if adapter is absent or does not provide `stateStoredPersistence`.
7. `persistence: () => somePersistence` (factory function) continues to work as before, ignoring the adapter.
8. `persistence: someConfigObject` (a `PersistenceConfiguration` object — not a string, not a function) is used directly. This supports `adapter.stateStored(table)` which returns a `PersistenceConfiguration`.

### Concurrency shorthand resolution

9. `concurrency: 'optimistic'` is equivalent to `{ maxRetries: 0 }` — same as omitting `concurrency`.
10. `concurrency: 'pessimistic'` resolves `locker` from `adapter.aggregateLocker`. Error if adapter is absent or does not provide `aggregateLocker`.
11. `concurrency: { strategy: 'pessimistic' }` without explicit `locker` also resolves from `adapter.aggregateLocker`.
12. `concurrency: { strategy: 'pessimistic', locker: customLocker }` uses the explicit locker, ignoring the adapter.
13. Object-form `concurrency` (e.g., `{ maxRetries: 5 }`) continues to work as before.

### Snapshot store inference

14. When `snapshots: { strategy }` is provided without `store`, the engine resolves `store` from `adapter.snapshotStore`.
15. When `snapshots: { strategy }` is provided without `store` and the adapter does not provide `snapshotStore`, `wireDomain` throws an error.
16. Explicit `snapshots: { strategy, store: () => myStore }` ignores the adapter.

### Saga persistence inference

17. When `wiring.sagas.persistence` is not provided, the engine falls back to `adapter.sagaPersistence`.
18. When sagas are defined in the domain but no saga persistence is available (neither from explicit wiring nor from the adapter), `wireDomain` throws an error.
19. When no sagas are defined, saga persistence is not required — neither from wiring nor adapter.

### Unit-of-work inference

20. When `wiring.unitOfWork` is not provided, the engine falls back to `adapter.unitOfWorkFactory`.
21. When neither `wiring.unitOfWork` nor adapter is available, the engine uses the in-memory default.

### Outbox and idempotency inference

22. When `wiring.outbox.store` is not provided, the engine falls back to `adapter.outboxStore`.
23. When `wiring.idempotency` is not provided, the engine falls back to `adapter.idempotencyStore`.

### Adapter lifecycle

24. `adapter.init?.()` is called at the start of `Domain.init()`, after logger setup.
25. The adapter is pushed into the domain's component list for auto-close. `isCloseable()` detects adapters with a `close()` method and calls it during `Domain.shutdown()`.
26. If the adapter does not implement `close()`, shutdown proceeds without error.

### Explicit wiring overrides

27. For every concern, explicit wiring (global or per-aggregate) always takes precedence over adapter defaults. The adapter is purely a fallback.
28. Per-aggregate wiring overrides global wiring, which overrides adapter defaults.

## Invariants

- `unitOfWorkFactory` is the only required field on `PersistenceAdapter`. All other fields are optional.
- Explicit wiring ALWAYS takes precedence over adapter defaults.
- Shorthand strings (`'event-sourced'`, `'state-stored'`, `'pessimistic'`, `'optimistic'`) ALWAYS require an adapter to be present. Using a shorthand without an adapter is always an error.
- When a domain capability requires a store the adapter doesn't provide, `wireDomain` ALWAYS throws a descriptive error at init time — not at first use.
- `isPersistenceAdapter` ALWAYS returns `true` for objects with a `unitOfWorkFactory` property that is a function, and `false` for everything else.

## Edge Cases

- **Adapter with no optional stores**: only `unitOfWorkFactory` provided. All aggregates must use explicit `persistence` factories. Sagas, snapshots, outbox, idempotency all require explicit wiring.
- **Adapter + partial per-aggregate overrides**: some aggregates use shorthand, others use explicit factories. Both resolve correctly.
- **No adapter, no explicit wiring**: backward-compatible — engine uses in-memory defaults (as today).
- **Adapter without `stateStoredPersistence` + aggregate omitting `persistence`**: error at init time with descriptive message.
- **Adapter without `eventSourcedPersistence` + aggregate with `persistence: 'event-sourced'`**: error at init time.
- **Adapter without `aggregateLocker` + aggregate with `concurrency: 'pessimistic'`**: error at init time.
- **Adapter without `sagaPersistence` + domain with sagas**: error at init time.
- **Adapter without `snapshotStore` + aggregate with `snapshots: { strategy }`**: error at init time.
- **`isPersistenceAdapter(null)`**: returns `false`.
- **`isPersistenceAdapter({})`**: returns `false` (no `unitOfWorkFactory`).
- **`isPersistenceAdapter({ unitOfWorkFactory: "not-a-function" })`**: returns `false`.

## Integration Points

- **`@noddde/engine`**: `wireDomain` reads `persistenceAdapter` from `DomainWiring`. `Domain.init()` calls `adapter.init?.()` and resolves defaults. `Domain.shutdown()` auto-discovers `close()` via `isCloseable()`.
- **`@noddde/core`**: `PersistenceAdapter` interface references types from `persistence/`, `infrastructure/closeable`.
- **Adapter packages**: `DrizzleAdapter`, `PrismaAdapter`, `TypeORMAdapter` implement `PersistenceAdapter`.

## Test Scenarios

### isPersistenceAdapter returns true for valid adapter

```ts
import { isPersistenceAdapter } from "@noddde/core";
import { InMemoryUnitOfWorkFactory } from "@noddde/engine";

const adapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
};

expect(isPersistenceAdapter(adapter)).toBe(true);
```

### isPersistenceAdapter returns true for full adapter

```ts
import { isPersistenceAdapter } from "@noddde/core";
import {
  InMemoryUnitOfWorkFactory,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryStateStoredAggregatePersistence,
  InMemorySagaPersistence,
} from "@noddde/engine";

const adapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  eventSourcedPersistence: new InMemoryEventSourcedAggregatePersistence(),
  stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
  sagaPersistence: new InMemorySagaPersistence(),
};

expect(isPersistenceAdapter(adapter)).toBe(true);
```

### isPersistenceAdapter returns false for non-adapters

```ts
import { isPersistenceAdapter } from "@noddde/core";

expect(isPersistenceAdapter(null)).toBe(false);
expect(isPersistenceAdapter(undefined)).toBe(false);
expect(isPersistenceAdapter({})).toBe(false);
expect(isPersistenceAdapter("string")).toBe(false);
expect(isPersistenceAdapter({ unitOfWorkFactory: "not-a-function" })).toBe(
  false,
);
```

### Adapter defaults resolve for aggregate persistence

```ts
import { defineDomain, wireDomain } from "@noddde/engine";
import type { PersistenceAdapter } from "@noddde/core";

// Minimal aggregate for testing
const TestAggregate = defineAggregate({
  name: "Test",
  initialState: () => ({}),
  commands: {},
  events: {},
});

const domain = defineDomain({
  writeModel: { aggregates: { Test: TestAggregate } },
  readModel: { projections: {} },
});

const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
};

const wired = await wireDomain(domain, {
  persistenceAdapter: adapter,
});

// Aggregate should use adapter's stateStoredPersistence by default
expect(wired).toBeDefined();
```

### Shorthand persistence: event-sourced resolves from adapter

```ts
const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  eventSourcedPersistence: new InMemoryEventSourcedAggregatePersistence(),
};

const wired = await wireDomain(domain, {
  persistenceAdapter: adapter,
  aggregates: {
    Test: { persistence: "event-sourced" },
  },
});

expect(wired).toBeDefined();
```

### Shorthand persistence without adapter throws

```ts
await expect(
  wireDomain(domain, {
    aggregates: {
      Test: { persistence: "event-sourced" },
    },
  }),
).rejects.toThrow();
```

### Concurrency pessimistic resolves locker from adapter

```ts
const mockLocker: AggregateLocker = {
  lock: vi.fn().mockResolvedValue({ release: vi.fn() }),
};

const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
  aggregateLocker: mockLocker,
};

const wired = await wireDomain(domain, {
  persistenceAdapter: adapter,
  aggregates: {
    Test: { concurrency: "pessimistic" },
  },
});

expect(wired).toBeDefined();
```

### Pessimistic without adapter locker throws

```ts
const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
};

await expect(
  wireDomain(domain, {
    persistenceAdapter: adapter,
    aggregates: {
      Test: { concurrency: "pessimistic" },
    },
  }),
).rejects.toThrow();
```

### Snapshot store inferred from adapter

```ts
const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  eventSourcedPersistence: new InMemoryEventSourcedAggregatePersistence(),
  snapshotStore: new InMemorySnapshotStore(),
};

const wired = await wireDomain(domain, {
  persistenceAdapter: adapter,
  aggregates: {
    Test: {
      persistence: "event-sourced",
      snapshots: { strategy: everyNEvents(10) },
    },
  },
});

expect(wired).toBeDefined();
```

### Saga persistence inferred from adapter

```ts
const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
  sagaPersistence: new InMemorySagaPersistence(),
};

// Domain with sagas would resolve saga persistence from adapter
expect(adapter.sagaPersistence).toBeDefined();
```

### Adapter init called during domain init

```ts
const initFn = vi.fn().mockResolvedValue(undefined);
const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
  init: initFn,
};

await wireDomain(domain, { persistenceAdapter: adapter });

expect(initFn).toHaveBeenCalledOnce();
```

### Adapter close called during domain shutdown

```ts
const closeFn = vi.fn().mockResolvedValue(undefined);
const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  stateStoredPersistence: new InMemoryStateStoredAggregatePersistence(),
  close: closeFn,
};

const wired = await wireDomain(domain, { persistenceAdapter: adapter });
await wired.shutdown();

expect(closeFn).toHaveBeenCalledOnce();
```

### Explicit wiring overrides adapter defaults

```ts
const adapterPersistence = new InMemoryStateStoredAggregatePersistence();
const explicitPersistence = new InMemoryEventSourcedAggregatePersistence();

const adapter: PersistenceAdapter = {
  unitOfWorkFactory: new InMemoryUnitOfWorkFactory(),
  stateStoredPersistence: adapterPersistence,
};

const wired = await wireDomain(domain, {
  persistenceAdapter: adapter,
  aggregates: {
    Test: { persistence: () => explicitPersistence },
  },
});

// The explicit factory should have been used, not the adapter default
expect(wired).toBeDefined();
```

### No adapter backward compatibility

```ts
// No adapter — engine uses in-memory defaults (existing behavior)
const wired = await wireDomain(domain, {});

expect(wired).toBeDefined();
```
