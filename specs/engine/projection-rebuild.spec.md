---
title: "Projection Rebuild API"
module: engine/projection-rebuild
source_file: packages/engine/src/projection-rebuild.ts
status: implemented
exports:
  - ProjectionRebuildOptions
  - ProjectionRebuildResult
  - ProjectionNotFoundError
  - StrongConsistencyRebuildError
  - EventReaderUnavailableError
  - ViewStoreNotTruncatableError
  - MissingViewStoreFactoryError
depends_on:
  - engine/domain
  - ddd/projection
  - core/persistence/view-store
  - core/persistence/event-reader
  - core/persistence/adapter
  - edd/event-bus
  - edd/event
  - infrastructure
docs:
  - read-model/projection-rebuild.mdx
---

# Projection Rebuild API

> A first-class framework capability for restoring a projection's view store from the event log. `Domain.rebuildProjection(name, opts?)` detaches the projection's live event-bus subscriptions, truncates its view store, replays every persisted event through its `on` map handlers, and re-attaches subscriptions when finished. v1 supports eventual-consistency projections only and requires the caller to halt writes during the rebuild window. Each failure mode has a typed error so ops scripts can react with precision.

## Type Contract

```ts
import type { Logger } from "@noddde/core";

/**
 * Options accepted by {@link Domain.rebuildProjection}.
 *
 * All fields are optional. Omitting all of them is the common case for
 * one-shot ops rebuilds.
 */
export interface ProjectionRebuildOptions {
  /**
   * Optional logger override. When omitted, the rebuild uses the domain's
   * configured logger via `domain.infrastructure.logger.child("projection-rebuild")`.
   */
  logger?: Logger;

  /**
   * Number of events to apply before invoking `onProgress`.
   * Must be a positive integer. Defaults to 1000.
   *
   * Counted on `eventsApplied` (events the projection handles), NOT on
   * `eventsRead` — skipped events do not trigger progress callbacks.
   */
  progressInterval?: number;

  /**
   * Optional progress callback. Invoked synchronously inside the replay
   * loop (the loop awaits its return). Use to report ETA, write
   * heartbeats to a log, or update an admin UI.
   */
  onProgress?: (progress: { eventsApplied: number }) => void | Promise<void>;
}

/**
 * Result returned by a successful {@link Domain.rebuildProjection} call.
 */
export interface ProjectionRebuildResult {
  /** The projection name passed to `rebuildProjection`. */
  projectionName: string;

  /**
   * Total events the EventReader yielded during this rebuild. Includes
   * events that the projection's `on` map does not handle.
   */
  eventsRead: number;

  /**
   * Number of events that matched a handler in the projection's `on`
   * map and were applied (saved, updated, or deleted) to the view store.
   * Always `<= eventsRead`.
   */
  eventsApplied: number;

  /**
   * Number of times a reducer returned the `DeleteView` sentinel during
   * the replay (calls to `viewStore.delete(viewId)`). Always
   * `<= eventsApplied`.
   */
  viewsDeleted: number;

  /**
   * Wall-clock duration of the rebuild in milliseconds, from the moment
   * the method validates inputs to the moment subscriptions are
   * re-attached. Suitable for telemetry, not for SLA enforcement.
   */
  durationMs: number;
}

/**
 * Thrown when the projection name is not registered in the domain.
 */
export class ProjectionNotFoundError extends Error {
  override readonly name = "ProjectionNotFoundError" as const;
  constructor(public readonly projectionName: string);
}

/**
 * Thrown when `rebuildProjection` is called on a projection whose
 * `consistency` is `"strong"`. v1 does not support rebuilding
 * strong-consistency projections (they would race with in-flight UoWs).
 */
export class StrongConsistencyRebuildError extends Error {
  override readonly name = "StrongConsistencyRebuildError" as const;
  constructor(public readonly projectionName: string);
}

/**
 * Thrown when no `EventReader` is resolvable from the wired
 * `PersistenceAdapter.eventReader` or from the resolved event-sourced
 * persistence (which the in-memory implementation structurally provides).
 */
export class EventReaderUnavailableError extends Error {
  override readonly name = "EventReaderUnavailableError" as const;
  constructor();
}

/**
 * Thrown when the projection's view store does not implement the
 * optional `truncate()` method. Adapter authors implementing
 * production view stores should add `truncate()` so rebuild becomes
 * available.
 */
export class ViewStoreNotTruncatableError extends Error {
  override readonly name = "ViewStoreNotTruncatableError" as const;
  constructor(public readonly projectionName: string);
}

/**
 * Thrown when the projection has no `ViewStoreFactory` wired. Rebuild is
 * meaningless without a target store; the caller likely forgot to
 * configure `DomainWiring.projections[name].viewStore`.
 */
export class MissingViewStoreFactoryError extends Error {
  override readonly name = "MissingViewStoreFactoryError" as const;
  constructor(public readonly projectionName: string);
}
```

The `Domain` class gains a method (the signature lives in `specs/engine/domain.spec.md` — repeated here for convenience):

```ts
class Domain<
  TInfrastructure extends Infrastructure,
  TStandaloneCommand extends Command = Command,
  TStandaloneQuery extends Query<any> = Query<any>,
  TAggregateCommand extends AggregateCommand<any> = AggregateCommand<any>,
  TProjectionQuery extends Query<any> = Query<any>,
  TProjections extends ProjectionMap = ProjectionMap,
> {
  /**
   * Truncates the named projection's view store and replays the entire
   * event log through its `on` map handlers, restoring the views to a
   * consistent state derived solely from the event log.
   *
   * v1 supports eventual-consistency projections only. The caller is
   * responsible for ensuring no commands are dispatched while a rebuild
   * is in flight — concurrent writes during rebuild produce undefined
   * results.
   *
   * @throws {@link ProjectionNotFoundError} unknown name
   * @throws {@link StrongConsistencyRebuildError} projection is strong-consistency
   * @throws {@link MissingViewStoreFactoryError} no viewStore wired
   * @throws {@link EventReaderUnavailableError} no EventReader resolvable
   * @throws {@link ViewStoreNotTruncatableError} viewStore lacks truncate()
   */
  rebuildProjection<TName extends keyof TProjections & string>(
    name: TName,
    options?: ProjectionRebuildOptions,
  ): Promise<ProjectionRebuildResult>;
}
```

- The implementation lives in a dedicated helper file `packages/engine/src/projection-rebuild.ts` invoked from `Domain.rebuildProjection`. The helper accepts an internal context object (resolved projection registry, view store factories, eventBus handle, EventReader resolution) — it is not exported on the public surface.
- All five error classes extend `Error`, have a `readonly name` literal type, and are exported from `@noddde/engine`. They are caught individually via `instanceof`.
- `ProjectionRebuildOptions` and `ProjectionRebuildResult` are exported from `@noddde/engine`.

## Behavioral Requirements

### Argument resolution

1. **Projection lookup** — The method resolves `definition.readModel.projections[name]`. If the entry is `undefined`, it throws `ProjectionNotFoundError`. At the type level, the `TName extends keyof TProjections & string` constraint makes this a compile-time error for known domains, so the runtime check is a defensive last line for `any`-typed callers (e.g., dynamic loaders).
2. **Strong-consistency rejection** — If `projection.consistency === "strong"`, the method throws `StrongConsistencyRebuildError` BEFORE any I/O. No truncate happens; no event reads happen; subscriptions are not touched.
3. **ViewStoreFactory resolution** — The method looks up the projection's view store factory from `Domain`'s `resolvedViewStoreFactories` map (populated during `init()`). If the entry is missing or `undefined`, it throws `MissingViewStoreFactoryError`.
4. **Base store materialization** — The method obtains the base view store by calling `factory.getForContext(undefined)`. Rebuild operates non-transactionally; strong-consistency contexts are not relevant in v1.
5. **EventReader resolution** — The method resolves an `EventReader` in this order:
   1. `wiring.persistenceAdapter?.eventReader` — explicit on adapter.
   2. The resolved event-sourced persistence (from `aggregatePersistenceResolver` if global, or scanned across per-aggregate resolutions) — if any persistence object structurally satisfies `EventReader` (i.e., has a callable `read` method), the first such is used.
   3. If neither is found, throws `EventReaderUnavailableError`.
6. **Truncate capability check** — Before any reads, the method verifies `typeof baseStore.truncate === "function"`. If not, throws `ViewStoreNotTruncatableError`.
7. **Options validation** — If `options.progressInterval` is provided and is not a positive integer, the method throws `RangeError`. Defaults: `progressInterval = 1000`, `onProgress = undefined`.

### Rebuild pipeline

The method executes these steps in order. Steps 1–6 are validation (steps above); steps 8–14 below execute only after validation passes.

8. **Logger setup** — Resolves the logger as `options.logger ?? domain.infrastructure.logger.child("projection-rebuild")`. Logs `info` start (`"rebuilding <name>"`).
9. **Subscription detach** — For every event name in `projection.on`, the method removes the projection's specific subscription handler from the event bus. The Domain maintains an internal registry of `(projectionName, eventName) → handler` populated during `init()`'s eventual-consistency wiring so the rebuild can detach precisely these handlers without disturbing sagas or other projections.
10. **Truncate** — Calls `await baseStore.truncate()`. If `truncate()` throws, the method propagates the error; subscriptions remain detached and MUST be re-attached in the `finally` block (see step 14).
11. **Replay loop** — Iterates `for await (const event of reader.read())`:
    - Increments `eventsRead`.
    - Looks up `handler = projection.on[event.name]`. If `undefined`, continues (skipping).
    - Computes `viewId = handler.id ? handler.id(event) : event.metadata?.aggregateId`. If both are `undefined`, throws `Error("rebuildProjection: cannot derive viewId for event '<name>'; projection.on['<name>'].id is required")`.
    - Loads `current = (await baseStore.load(viewId)) ?? projection.initialView`.
    - Computes `next = await handler.reduce(event, current)`.
    - If `next === DeleteView`: calls `await baseStore.delete(viewId)`, increments `viewsDeleted`, increments `eventsApplied`.
    - Else: calls `await baseStore.save(viewId, next)`, increments `eventsApplied`.
    - If `eventsApplied % progressInterval === 0`: invokes `await onProgress?.({ eventsApplied })`.
12. **Result accumulation** — Tracks `durationMs` from validation-end to subscription-reattach.
13. **Subscription re-attach** — In a `finally` block, re-subscribes every previously detached handler on the event bus. The re-attach uses the SAME handler functions originally registered by `Domain.init()` — the registry stores the function references, not just metadata.
14. **Logger completion** — Logs `info` completion with the final counters.
15. **Return** — Returns `ProjectionRebuildResult` with `projectionName`, `eventsRead`, `eventsApplied`, `viewsDeleted`, `durationMs`.

### Failure-mode semantics

16. **Failure during truncate** — Subscriptions are re-attached via the `finally` block. The view store may be partially truncated (implementation-defined). The error propagates to the caller.
17. **Failure during replay** — Subscriptions are re-attached via the `finally` block. The view store may contain partial rebuild results. The error propagates to the caller, who SHOULD treat the projection as in an inconsistent state and retry the rebuild (after halting writes).
18. **`onProgress` callback throws** — Propagates as a replay failure (treated like a replay error per #17). The framework does not swallow callback errors.
19. **Concurrent rebuilds on the same projection** — Undefined behavior; the framework does NOT serialize. The first detach succeeds; the second detach is a no-op (handlers already removed); both truncate; both replay. Callers MUST not invoke rebuild concurrently for the same projection.
20. **Concurrent rebuilds on different projections** — Safe. Each rebuild operates on an independent view store factory and detaches only its own subscriptions.

### Subscription registry semantics

21. **Registry shape** — The Domain maintains, internally, a `Map<string, Map<string, AsyncEventHandler>>` keyed `projectionName → eventName → handler`. This is populated during `init()` (step 11 of the Domain init sequence) for eventual-consistency projections only. Strong-consistency projections are never entered.
22. **Detach semantics** — `eventBus.removeListener?(eventName, handler)` or equivalent. The `EventBus` interface (from `core/edd/event-bus`) MUST support removal — if the wired bus does not, `rebuildProjection` throws an error explaining the bus does not support detach. (Implementations: the in-memory `EventEmitterEventBus` supports `off`; production adapters typically do.)
23. **Idempotent re-attach** — Re-attach uses `eventBus.on(eventName, handler)` which is the same call `init()` used. If a handler was already re-attached (race), the second call is benign (the EventBus contract permits multiple identical listeners — but the registry guards against this in v1).

### Logging

24. **Start log** — `logger.info("rebuilding <projectionName>")` at the start (after validation passes).
25. **Progress log** — Each `onProgress` tick also emits `logger.debug("<projectionName>: applied <eventsApplied> events")`.
26. **Completion log** — `logger.info("rebuilt <projectionName>: read=<eventsRead> applied=<eventsApplied> deleted=<viewsDeleted> durationMs=<n>")`.
27. **Failure log** — On any error after validation, `logger.error("rebuild <projectionName> failed: <message>")` before the error propagates.

## Invariants

- `eventsRead >= eventsApplied`. Events not matched by the projection's `on` map are counted in `eventsRead` only.
- `eventsApplied >= viewsDeleted`. Every deletion is also an application.
- `durationMs >= 0`.
- A successful rebuild leaves the view store in a state equivalent to running the same event log through the projection from scratch — pure replay-driven state.
- A failed rebuild leaves subscriptions re-attached. The view store state on failure is implementation-defined but the live event flow resumes once the method returns (or throws).
- `rebuildProjection` is the only public API for rebuild. The internal helper module is not exported; callers cannot bypass argument validation.
- Validation errors (`ProjectionNotFoundError`, `StrongConsistencyRebuildError`, `MissingViewStoreFactoryError`, `EventReaderUnavailableError`, `ViewStoreNotTruncatableError`) throw BEFORE any I/O. The view store and subscriptions are NEVER touched when validation fails.
- The `TName` generic ensures unknown projection names are a TypeScript compile error for typed domains; only loosely typed dynamic callers can reach the runtime `ProjectionNotFoundError`.

## Edge Cases

- **Empty event log** — `eventsRead === 0`, `eventsApplied === 0`, `viewsDeleted === 0`, `durationMs >= 0`. Truncate still runs. Subscriptions are detached and re-attached.
- **Empty `on` map** — Every event yielded by the reader is skipped (`eventsRead > 0`, `eventsApplied === 0`). The truncate still clears the view store. After rebuild, the store is empty.
- **All events are `DeleteView` returns** — Every event applied results in a delete; `viewsDeleted === eventsApplied`. The final view store is empty.
- **Reducer throws** — The replay loop propagates the error. Subscriptions re-attach in `finally`. View store may be partially rebuilt.
- **`onProgress` is async** — The replay loop awaits its return before continuing. A slow callback throttles the rebuild but does not lose events.
- **`progressInterval` is larger than total events applied** — `onProgress` is invoked zero times during replay. The completion log still fires.
- **Projection's `id` extractor returns `undefined`** — Treated as a malformed event; the replay throws `Error("rebuildProjection: handler.id returned undefined for event '<name>'")` and aborts. Subscriptions re-attach in `finally`.
- **Domain not yet initialized** — `rebuildProjection` called before `init()` throws (the resolved-projections map is empty). The error message indicates `init()` is required.
- **Domain shutting down** — `rebuildProjection` called after `shutdown()` throws `DomainShutdownError` (same as `dispatchCommand`/`dispatchQuery`). Validation does NOT proceed.
- **EventReader yields events with no `metadata`** — Handlers with explicit `id` work; handlers without `id` AND without `event.metadata.aggregateId` throw per requirement 11.
- **`progressInterval = 1`** — `onProgress` fires for every applied event. Acceptable but slow.

## Integration Points

- **`Domain.init()`** — populates the projection-subscription registry as part of step 11 (event listener registration for eventual-consistency projections). The registry is read-only after init.
- **`Domain.shutdown()`** — rejects rebuild calls with `DomainShutdownError` once `_shuttingDown` is true.
- **`PersistenceAdapter.eventReader?`** — primary source for the rebuild event stream.
- **`InMemoryEventSourcedAggregatePersistence.read()`** — fallback source when no adapter is wired.
- **`ViewStore.truncate?()`** — required on the projection's view store.
- **`DeleteView`** — recognized during replay exactly as in the live event flow.
- **`projection.consistency`** — only `"eventual"` is supported in v1.
- **Logger** — Operations are logged at `info`/`debug`/`error` levels, mirroring the rest of the engine.

## CLI Template Maintenance

This spec introduces a new public method on `Domain` but does not change the structure of projection definitions. No CLI template changes required for `noddde new projection` or related commands. The framework MAY add a `noddde rebuild projection <name>` CLI command in a follow-up; the Auditor SHOULD note this as a future enhancement, not a blocker.

## Test Scenarios

### Empty event log rebuilds to zero counters

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: empty event log", () => {
  it("should rebuild with zero counters and not throw", async () => {
    type ItemView = { id: string };
    type ItemEvent = DefineEvents<{ ItemCreated: { id: string } }>;
    type ItemCommand = DefineCommands<{ CreateItem: { id: string } }>;
    type ItemQuery = DefineQueries<{
      GetItem: { payload: { id: string }; result: ItemView | null };
    }>;

    const Item = defineAggregate<{
      state: { id: string } | null;
      commands: ItemCommand;
      events: ItemEvent;
      infrastructure: {};
    }>({
      name: "Item",
      initialState: () => null,
      decide: {
        CreateItem: (cmd) => ({
          name: "ItemCreated",
          payload: { id: cmd.payload.id },
        }),
      },
      evolve: {
        ItemCreated: (p) => ({ id: p.id }),
      },
    });

    const ItemSummary = defineProjection<{
      events: ItemEvent;
      queries: ItemQuery;
      view: ItemView;
      infrastructure: {};
    }>({
      on: {
        ItemCreated: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const def = defineDomain({
      writeModel: { aggregates: { Item } },
      readModel: { projections: { ItemSummary } },
    });
    const domain = await wireDomain(def, {
      projections: {
        ItemSummary: { viewStore: new InMemoryViewStoreFactory<ItemView>() },
      },
    });

    const result = await domain.rebuildProjection("ItemSummary");

    expect(result.projectionName).toBe("ItemSummary");
    expect(result.eventsRead).toBe(0);
    expect(result.eventsApplied).toBe(0);
    expect(result.viewsDeleted).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
```

### Rebuild reproduces a single-aggregate view

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: single aggregate replay", () => {
  it("should reproduce a view identical to the live-built one", async () => {
    type BalanceView = { id: string; balance: number };
    type AccountEvent = DefineEvents<{
      AccountCreated: { id: string };
      DepositMade: { id: string; amount: number };
    }>;
    type AccountCommand = DefineCommands<{
      CreateAccount: { id: string };
      Deposit: { id: string; amount: number };
    }>;
    type AccountQuery = DefineQueries<{
      GetBalance: { payload: { id: string }; result: BalanceView | null };
    }>;

    const Account = defineAggregate<{
      state: BalanceView | null;
      commands: AccountCommand;
      events: AccountEvent;
      infrastructure: {};
    }>({
      name: "Account",
      initialState: () => null,
      decide: {
        CreateAccount: (cmd) => ({
          name: "AccountCreated",
          payload: { id: cmd.payload.id },
        }),
        Deposit: (cmd) => ({
          name: "DepositMade",
          payload: { id: cmd.payload.id, amount: cmd.payload.amount },
        }),
      },
      evolve: {
        AccountCreated: (p) => ({ id: p.id, balance: 0 }),
        DepositMade: (p, s) =>
          s
            ? { ...s, balance: s.balance + p.amount }
            : { id: p.id, balance: p.amount },
      },
    });

    const Balance = defineProjection<{
      events: AccountEvent;
      queries: AccountQuery;
      view: BalanceView;
      infrastructure: {};
    }>({
      on: {
        AccountCreated: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, balance: 0 }),
        },
        DepositMade: {
          id: (e) => e.payload.id,
          reduce: (e, v) =>
            v
              ? { ...v, balance: v.balance + e.payload.amount }
              : { id: e.payload.id, balance: e.payload.amount },
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<BalanceView>();
    const def = defineDomain({
      writeModel: { aggregates: { Account } },
      readModel: { projections: { Balance } },
    });
    const domain = await wireDomain(def, {
      projections: { Balance: { viewStore: factory } },
    });

    // Live flow: dispatch commands → projections update.
    await domain.dispatchCommand({
      name: "CreateAccount",
      targetAggregateId: "acc-1",
      payload: { id: "acc-1" },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { id: "acc-1", amount: 100 },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "acc-1",
      payload: { id: "acc-1", amount: 50 },
    });

    const liveView = await factory.getForContext().load("acc-1");
    expect(liveView).toEqual({ id: "acc-1", balance: 150 });

    // Rebuild from scratch.
    const result = await domain.rebuildProjection("Balance");

    expect(result.eventsRead).toBe(3);
    expect(result.eventsApplied).toBe(3);
    expect(result.viewsDeleted).toBe(0);

    const rebuiltView = await factory.getForContext().load("acc-1");
    expect(rebuiltView).toEqual({ id: "acc-1", balance: 150 });
  });
});
```

### Pre-existing stale views are truncated before replay

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: truncates stale views", () => {
  it("should remove stale views even when no replay event re-creates them", async () => {
    type ItemView = { id: string; name: string };
    type ItemEvent = DefineEvents<{
      ItemCreated: { id: string; name: string };
    }>;
    type ItemCommand = DefineCommands<{
      CreateItem: { id: string; name: string };
    }>;
    type ItemQuery = DefineQueries<{
      GetItem: { payload: { id: string }; result: ItemView | null };
    }>;

    const Item = defineAggregate<{
      state: ItemView | null;
      commands: ItemCommand;
      events: ItemEvent;
      infrastructure: {};
    }>({
      name: "Item",
      initialState: () => null,
      decide: {
        CreateItem: (cmd) => ({
          name: "ItemCreated",
          payload: { id: cmd.payload.id, name: cmd.payload.name },
        }),
      },
      evolve: {
        ItemCreated: (p) => ({ id: p.id, name: p.name }),
      },
    });

    const Inventory = defineProjection<{
      events: ItemEvent;
      queries: ItemQuery;
      view: ItemView;
      infrastructure: {};
    }>({
      on: {
        ItemCreated: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, name: e.payload.name }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<ItemView>();
    const def = defineDomain({
      writeModel: { aggregates: { Item } },
      readModel: { projections: { Inventory } },
    });
    const domain = await wireDomain(def, {
      projections: { Inventory: { viewStore: factory } },
    });

    // Create one item legitimately.
    await domain.dispatchCommand({
      name: "CreateItem",
      targetAggregateId: "i-1",
      payload: { id: "i-1", name: "Widget" },
    });

    // Manually corrupt the store with a stale view that no event will reproduce.
    await factory
      .getForContext()
      .save("stale-id", { id: "stale-id", name: "Stale" });

    expect(await factory.getForContext().load("stale-id")).toBeTruthy();

    const result = await domain.rebuildProjection("Inventory");

    expect(result.eventsApplied).toBe(1);
    expect(await factory.getForContext().load("stale-id")).toBeFalsy();
    expect(await factory.getForContext().load("i-1")).toEqual({
      id: "i-1",
      name: "Widget",
    });
  });
});
```

### DeleteView during replay routes to viewStore.delete and increments viewsDeleted

```ts
import { describe, it, expect } from "vitest";
import {
  DeleteView,
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: DeleteView during replay", () => {
  it("should call viewStore.delete and increment viewsDeleted", async () => {
    type View = { id: string; active: boolean };
    type Event = DefineEvents<{
      Created: { id: string };
      Removed: { id: string };
    }>;
    type Command = DefineCommands<{
      Create: { id: string };
      Remove: { id: string };
    }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
        Remove: (cmd) => ({ name: "Removed", payload: { id: cmd.payload.id } }),
      },
      evolve: {
        Created: (p) => ({ id: p.id, active: true }),
        Removed: () => null,
      },
    });

    const Proj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, active: true }),
        },
        Removed: {
          id: (e) => e.payload.id,
          reduce: () => DeleteView,
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<View>();
    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });
    const domain = await wireDomain(def, {
      projections: { Proj: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "x",
      payload: { id: "x" },
    });
    await domain.dispatchCommand({
      name: "Remove",
      targetAggregateId: "x",
      payload: { id: "x" },
    });

    const result = await domain.rebuildProjection("Proj");
    expect(result.eventsApplied).toBe(2);
    expect(result.viewsDeleted).toBe(1);
    expect(await factory.getForContext().load("x")).toBeFalsy();
  });
});
```

### Events not in the on map are skipped silently

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: unhandled events are skipped", () => {
  it("should increment eventsRead but not eventsApplied", async () => {
    type View = { id: string; balance: number };
    type Event = DefineEvents<{
      Created: { id: string };
      Noise: { id: string };
    }>;
    type Command = DefineCommands<{
      Create: { id: string };
      MakeNoise: { id: string };
    }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
        MakeNoise: (cmd) => ({
          name: "Noise",
          payload: { id: cmd.payload.id },
        }),
      },
      evolve: {
        Created: (p) => ({ id: p.id, balance: 0 }),
        Noise: (_, s) => s,
      },
    });

    const Proj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      // Only handles Created — Noise is ignored.
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id, balance: 0 }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<View>();
    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });
    const domain = await wireDomain(def, {
      projections: { Proj: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "x",
      payload: { id: "x" },
    });
    await domain.dispatchCommand({
      name: "MakeNoise",
      targetAggregateId: "x",
      payload: { id: "x" },
    });
    await domain.dispatchCommand({
      name: "MakeNoise",
      targetAggregateId: "x",
      payload: { id: "x" },
    });

    const result = await domain.rebuildProjection("Proj");
    expect(result.eventsRead).toBe(3);
    expect(result.eventsApplied).toBe(1);
  });
});
```

### Strong-consistency projection rejects rebuild without touching truncate

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import {
  wireDomain,
  InMemoryViewStoreFactory,
  StrongConsistencyRebuildError,
} from "@noddde/engine";

describe("rebuildProjection: strong-consistency rejection", () => {
  it("should throw StrongConsistencyRebuildError and not call truncate", async () => {
    type View = { id: string };
    type Event = DefineEvents<{ Created: { id: string } }>;
    type Command = DefineCommands<{ Create: { id: string } }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const StrongProj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      consistency: "strong",
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<View>();
    let truncateCalled = false;
    const wrappedFactory = {
      getForContext: () => {
        const inner = factory.getForContext();
        return {
          ...inner,
          truncate: async () => {
            truncateCalled = true;
            await (inner as any).truncate?.();
          },
        };
      },
    };

    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { StrongProj } },
    });
    const domain = await wireDomain(def, {
      projections: { StrongProj: { viewStore: wrappedFactory as any } },
    });

    await expect(domain.rebuildProjection("StrongProj")).rejects.toBeInstanceOf(
      StrongConsistencyRebuildError,
    );
    expect(truncateCalled).toBe(false);
  });
});
```

### EventReaderUnavailableError is thrown when no reader is wired

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import {
  wireDomain,
  InMemoryViewStoreFactory,
  EventReaderUnavailableError,
} from "@noddde/engine";

describe("rebuildProjection: missing EventReader", () => {
  it("should throw EventReaderUnavailableError when no reader is resolvable", async () => {
    type View = { id: string };
    type Event = DefineEvents<{ Created: { id: string } }>;
    type Command = DefineCommands<{ Create: { id: string } }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const Proj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });

    // Wire state-stored persistence (does NOT implement EventReader) and no adapter.eventReader.
    const { InMemoryStateStoredAggregatePersistence } = await import(
      "@noddde/engine"
    );
    const domain = await wireDomain(def, {
      aggregates: {
        persistence: () => new InMemoryStateStoredAggregatePersistence(),
      },
      projections: {
        Proj: { viewStore: new InMemoryViewStoreFactory<View>() },
      },
    });

    await expect(domain.rebuildProjection("Proj")).rejects.toBeInstanceOf(
      EventReaderUnavailableError,
    );
  });
});
```

### ViewStoreNotTruncatableError when the store lacks truncate()

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, ViewStoreNotTruncatableError } from "@noddde/engine";

describe("rebuildProjection: missing truncate()", () => {
  it("should throw ViewStoreNotTruncatableError when the store cannot truncate", async () => {
    type View = { id: string };
    type Event = DefineEvents<{ Created: { id: string } }>;
    type Command = DefineCommands<{ Create: { id: string } }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const Proj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const noTruncateFactory = {
      getForContext: () => ({
        save: async () => {},
        load: async () => undefined,
        delete: async () => {},
        // No truncate.
      }),
    };

    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });
    const domain = await wireDomain(def, {
      projections: { Proj: { viewStore: noTruncateFactory as any } },
    });

    await expect(domain.rebuildProjection("Proj")).rejects.toBeInstanceOf(
      ViewStoreNotTruncatableError,
    );
  });
});
```

### ProjectionNotFoundError for unknown name (runtime safety)

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  type DefineEvents,
  type DefineCommands,
} from "@noddde/core";
import { wireDomain, ProjectionNotFoundError } from "@noddde/engine";

describe("rebuildProjection: unknown projection name", () => {
  it("should throw ProjectionNotFoundError when name is not registered", async () => {
    type Event = DefineEvents<{ X: { id: string } }>;
    type Command = DefineCommands<{ DoX: { id: string } }>;

    const Agg = defineAggregate<{
      state: null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        DoX: (cmd) => ({ name: "X", payload: { id: cmd.payload.id } }),
      },
      evolve: { X: () => null },
    });

    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: {} },
    });
    const domain = await wireDomain(def);

    // Cast around the type-level keyof TProjections constraint.
    await expect(
      (domain.rebuildProjection as (n: string) => Promise<unknown>)(
        "NotARegisteredProjection",
      ),
    ).rejects.toBeInstanceOf(ProjectionNotFoundError);
  });
});
```

### Subscriptions are detached during rebuild

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: subscriptions detach during replay", () => {
  it("should not dispatch live events to the projection while rebuilding", async () => {
    type View = { id: string };
    type Event = DefineEvents<{ Created: { id: string } }>;
    type Command = DefineCommands<{ Create: { id: string } }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    let liveReduces = 0;
    const Proj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => {
            liveReduces++;
            return { id: e.payload.id };
          },
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<View>();
    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });
    const domain = await wireDomain(def, {
      projections: { Proj: { viewStore: factory } },
    });

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "a",
      payload: { id: "a" },
    });
    // Live flow: 1 reduce
    expect(liveReduces).toBe(1);

    // Kick off the rebuild and intercept the eventBus to dispatch during the replay.
    const eventBus = domain.infrastructure.eventBus;
    const rebuildPromise = domain.rebuildProjection("Proj");
    await eventBus.dispatch({
      name: "Created",
      payload: { id: "b" },
      metadata: { aggregateName: "Agg", aggregateId: "b" } as any,
    } as any);
    await rebuildPromise;

    // While detached, the dispatched event MUST NOT have gone through the reducer.
    // (liveReduces increases by 1 for the replay of the original Created.)
    expect(liveReduces).toBe(2);
  });
});
```

### Subscriptions are re-attached after rebuild

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: subscriptions re-attach after replay", () => {
  it("should resume processing live events after rebuild resolves", async () => {
    type View = { id: string };
    type Event = DefineEvents<{ Created: { id: string } }>;
    type Command = DefineCommands<{ Create: { id: string } }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const Proj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const factory = new InMemoryViewStoreFactory<View>();
    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });
    const domain = await wireDomain(def, {
      projections: { Proj: { viewStore: factory } },
    });

    await domain.rebuildProjection("Proj");

    await domain.dispatchCommand({
      name: "Create",
      targetAggregateId: "post-rebuild",
      payload: { id: "post-rebuild" },
    });

    const view = await factory.getForContext().load("post-rebuild");
    expect(view).toEqual({ id: "post-rebuild" });
  });
});
```

### onProgress fires every progressInterval events

```ts
import { describe, it, expect } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: onProgress callback", () => {
  it("should invoke onProgress every N applied events", async () => {
    type View = { id: string };
    type Event = DefineEvents<{ Created: { id: string } }>;
    type Command = DefineCommands<{ Create: { id: string } }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const Proj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { Proj } },
    });
    const domain = await wireDomain(def, {
      projections: {
        Proj: { viewStore: new InMemoryViewStoreFactory<View>() },
      },
    });

    for (let i = 0; i < 5; i++) {
      await domain.dispatchCommand({
        name: "Create",
        targetAggregateId: `id-${i}`,
        payload: { id: `id-${i}` },
      });
    }

    const ticks: number[] = [];
    const result = await domain.rebuildProjection("Proj", {
      progressInterval: 2,
      onProgress: ({ eventsApplied }) => {
        ticks.push(eventsApplied);
      },
    });

    expect(result.eventsApplied).toBe(5);
    expect(ticks).toEqual([2, 4]); // tick at applied=2 and applied=4
  });
});
```

### Type-level: unknown projection name is a TypeScript error

```ts
import { describe, it } from "vitest";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  type DefineEvents,
  type DefineCommands,
  type DefineQueries,
} from "@noddde/core";
import { wireDomain, InMemoryViewStoreFactory } from "@noddde/engine";

describe("rebuildProjection: type-level name inference", () => {
  it("should reject unknown projection names at compile time", async () => {
    type View = { id: string };
    type Event = DefineEvents<{ Created: { id: string } }>;
    type Command = DefineCommands<{ Create: { id: string } }>;
    type Query = DefineQueries<{
      Get: { payload: { id: string }; result: View | null };
    }>;

    const Agg = defineAggregate<{
      state: View | null;
      commands: Command;
      events: Event;
      infrastructure: {};
    }>({
      name: "Agg",
      initialState: () => null,
      decide: {
        Create: (cmd) => ({ name: "Created", payload: { id: cmd.payload.id } }),
      },
      evolve: { Created: (p) => ({ id: p.id }) },
    });

    const KnownProj = defineProjection<{
      events: Event;
      queries: Query;
      view: View;
      infrastructure: {};
    }>({
      on: {
        Created: {
          id: (e) => e.payload.id,
          reduce: (e) => ({ id: e.payload.id }),
        },
      },
      queryHandlers: {},
    });

    const def = defineDomain({
      writeModel: { aggregates: { Agg } },
      readModel: { projections: { KnownProj } },
    });
    const domain = await wireDomain(def, {
      projections: {
        KnownProj: { viewStore: new InMemoryViewStoreFactory<View>() },
      },
    });

    // Sanity: known name is fine.
    await domain.rebuildProjection("KnownProj");

    // @ts-expect-error -- "Unknown" is not in keyof typeof projections.
    await domain.rebuildProjection("Unknown");
  });
});
```
