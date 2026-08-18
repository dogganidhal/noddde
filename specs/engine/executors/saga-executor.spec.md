---
title: "SagaExecutor"
module: engine/executors/saga-executor
source_file: packages/engine/src/executors/saga-executor.ts
status: implemented
exports: []
depends_on:
  - ddd/saga
  - edd/event
  - edd/event-metadata
  - cqrs/command/command
  - cqrs/command/command-bus
  - persistence
  - infrastructure
---

# SagaExecutor

> `SagaExecutor` executes the full saga event handling lifecycle: derive the saga instance ID from the event via the `on` map, load the saga state, bootstrap (if the event is in `startedBy`) or ignore (if the saga has not started), execute the saga handler, persist the new saga state, and dispatch reaction commands. The transactional coupling between saga-state persistence and reaction-command dispatch is selected per-saga by `saga.atomicity ?? "atomic"` (see `ddd/saga`): in **atomic** mode (the default) a single unit of work spans the saga-state save and all reaction commands, so they commit or roll back together; in **best-effort** mode the saga state is committed first and reaction commands are dispatched afterward, each in its own unit of work. This is an engine-internal class instantiated by `Domain` during `init()`.

## Type Contract

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CQRSInfrastructure,
  Event,
  Infrastructure,
  Saga,
  SagaPersistence,
  UnitOfWork,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { MetadataContext } from "../domain";

class SagaExecutor {
  constructor(
    infrastructure: Infrastructure & CQRSInfrastructure,
    sagaPersistence: SagaPersistence,
    unitOfWorkFactory: UnitOfWorkFactory,
    uowStorage: AsyncLocalStorage<UnitOfWork>,
    metadataStorage: AsyncLocalStorage<MetadataContext>,
    onEventsDispatched?: (events: Event[]) => Promise<void>,
  );

  execute(sagaName: string, saga: Saga<any, any>, event: Event): Promise<void>;
}
```

- `SagaExecutor` is constructed with the merged infrastructure (including CQRS buses), saga persistence, UoW factory, and `AsyncLocalStorage` instances for UoW and metadata context propagation.
- `execute` is the single public method. It processes a single event for a given saga definition, handling the full lifecycle internally.
- `execute` selects its unit-of-work / commit ordering from `saga.atomicity` (`"atomic" | "best-effort"`, from `ddd/saga`), defaulting an absent value to `"atomic"`. The constructor signature is unchanged — the mode is read per-event from the `saga` argument, so one executor instance serves sagas of either mode.

## Behavioral Requirements

### Derive Saga Instance ID

1. **Association lookup** -- Look up the `on` map entry via `saga.on[event.name]`. If no entry exists for this event name, return immediately (no-op). Otherwise, call `saga.on[event.name].id(event)` to derive the saga instance ID.

### Load Saga State

2. **Load from persistence** -- Call `sagaPersistence.load(sagaName, sagaId)` to retrieve the current saga state.

### Bootstrap or Resume

3. **Bootstrap on startedBy event** -- If the loaded state is `null` or `undefined`:

   - If `event.name` is in `saga.startedBy`, use `saga.initialState` as the current state. This starts a new saga instance.
   - If `event.name` is not in `saga.startedBy`, return immediately (the saga has not been started yet and this event cannot start it).

4. **Resume on existing state** -- If the loaded state is non-null, use it as the current state regardless of whether the event is in `startedBy`.

### Execute Saga Handler

5. **Handler lookup and invocation** -- Look up the handler via `saga.on[event.name]?.handle`. If no handler exists, return immediately (no-op). Otherwise, invoke the handler with `(event, currentState, infrastructure)`. The handler returns a `SagaReaction` containing `state` (the new saga state) and optional `commands`.

### Propagate Correlation Metadata

6. **Build metadata context from triggering event** -- Construct a `MetadataContext` with:
   - `correlationId`: from `event.metadata?.correlationId`, or a new UUID v7 if not present.
   - `causationId`: from `event.metadata?.eventId`, or `event.name` if not present.
   - `userId`: from `event.metadata?.userId`.
     This ensures all commands dispatched by the saga carry the same correlation chain as the triggering event.

### Resolve Atomicity Mode

7. **Resolve mode** -- Compute the effective mode as `saga.atomicity ?? "atomic"`. The saga definition's optional `atomicity` field (see `ddd/saga`) selects the transactional coupling; an absent field defaults to `"atomic"`. The mode governs only the unit-of-work and commit ordering relative to reaction-command dispatch (BRs 8-18). Steps 1-6 (association lookup, load, bootstrap/resume, handler invocation, metadata-context construction) and the correlation guarantees are identical across modes.

### Atomic Mode (default)

> Saga-state persistence and all reaction commands share one unit of work: they commit or roll back together. This is correct as long as command-produced events come from aggregate deciders that **return** events (the golden path) — `CommandLifecycleExecutor` detects the saga's UoW in `AsyncLocalStorage`, enlists on it, and `deferPublish`es those events so they are published only after the saga's UoW commits.

8. **Create a saga-scoped UoW** -- Call `unitOfWorkFactory()`. This single UoW spans both the saga-state save and every command dispatched by the reaction.

9. **Run within UoW and metadata context** -- Use `uowStorage.run(uow, ...)` and `metadataStorage.run(sagaCtx, ...)` so the UoW and metadata context are visible to all commands dispatched within the handler-reaction scope.

10. **Enlist saga-state save** -- Call `uow.enlist(() => sagaPersistence.save(sagaName, sagaId, reaction.state))` to defer saga-state persistence until commit.

11. **Dispatch reaction commands within the UoW** -- If `reaction.commands` is defined, normalize to an array (wrap a single command) and call `infrastructure.commandBus.dispatch(command)` for each. Because the UoW is in the `AsyncLocalStorage`, aggregate command handlers enlist their persistence on the **same** UoW (the explicit-UoW path in `CommandLifecycleExecutor`), achieving atomicity.

12. **Commit atomically** -- Call `uow.commit()`, which executes all enlisted operations (saga-state save + aggregate persistence saves) and returns the deferred events.

13. **Publish deferred events, then callback — OUTSIDE the saga's UoW `AsyncLocalStorage` scope** -- After a successful commit, dispatch every returned event sequentially via `for (const e of events) { await infrastructure.eventBus.dispatch(e); }` (sequential dispatch preserves causal ordering — events from a single saga reaction arrive at consumers in the order they were produced). Then, if `onEventsDispatched` is provided and `events.length > 0`, call `onEventsDispatched(events)`; errors from this callback are silently swallowed (a non-fatal outbox-marking hook). **This publish step runs after `uowStorage.run(uow, ...)` has returned**, not nested inside it — `commit()` happens inside the ALS scope (so `dispatchCommands`, requirement 11, can still enlist on `uow`), but the resulting events are dispatched once that scope has exited. This closes a re-entrancy defect: previously, publishing happened while the saga's now-completed `uow` was still the active `AsyncLocalStorage` value, so a standalone event handler reacting to one of these events — which is handed `infrastructure.commandBus` by design — that dispatched a command would have that command's `CommandLifecycleExecutor` observe the saga's `uow` via `uowStorage.getStore()`, take the explicit-UoW path, and throw `"UnitOfWork already completed"` when it tried to enlist (silently swallowed into a log by the event bus, but the command never ran). With publish outside the ALS scope, `uowStorage.getStore()` returns `undefined` for such a re-entrant dispatch, so it takes the implicit-UoW path and creates its own fresh UoW, exactly as if the triggering event had come from a plain `dispatchCommand()`. `runUowCompletionHooks(uow, true)` (see `specs/engine/executors/command-lifecycle-executor.spec.md` requirement 14a) is invoked once, after commit, to release any deferred locks or save any deferred snapshots registered by aggregate commands dispatched during requirement 11 — also outside the publish loop, so a hook failure cannot block publishing and a slow publish cannot delay lock release.

14. **Rollback on failure (atomic)** -- If any step within the UoW scope (state enlist, command dispatch, or commit) throws, call `uow.rollback()` (best-effort; rollback errors are swallowed) and re-throw the original error. The saga state is **not** persisted, and any aggregate changes enlisted on the same UoW are rolled back with it. `runUowCompletionHooks(uow, false)` is invoked exactly once (outside the ALS scope, alongside the rethrow) to release any deferred locks acquired by aggregate commands enlisted before the failure — a lock is never left held because the owning saga UoW rolled back instead of committing.

### Best-Effort Mode

> The saga state is committed **first** in its own UoW; **then** reaction commands are dispatched **outside** that UoW (each command obtains its own UoW via `CommandLifecycleExecutor`), still inside the metadata context. Because the saga state is already durable before any command runs, events that command handlers dispatch **directly** through the event bus — and any re-entrant saga executions they trigger — observe the committed saga state. This is the escape hatch for off-path dispatch (issue #119), notably **standalone command handlers**, which have no "return events" channel and can only publish via `eventBus.dispatch()`.

15. **Create and commit a saga-state UoW first** -- Create a UoW, run within `uowStorage.run(uow, ...)` and `metadataStorage.run(sagaCtx, ...)`, enlist the saga-state save, and call `uow.commit()` **before** dispatching any reaction command. For a state-only UoW the returned deferred-events array is typically empty; publish any returned events sequentially and invoke `onEventsDispatched` (when `events.length > 0`) exactly as in atomic mode (BR 13) — **also after `uowStorage.run(uow, ...)` has returned**, for the same re-entrancy reason. If this commit phase throws, call `uow.rollback()` (best-effort) and re-throw — the saga state is not persisted. Whether commit succeeds or throws, `runUowCompletionHooks(uow, committed)` is invoked exactly once (`committed` reflects whether `uow.commit()` actually returned) to release deferred locks / run deferred snapshot saves registered by any aggregate command enlisted on this UoW before the throw.

16. **Dispatch reaction commands after commit, outside the saga UoW** -- After the saga-state UoW has committed, if `reaction.commands` is defined, normalize to an array and dispatch each via `infrastructure.commandBus.dispatch(command)`, wrapped in `metadataStorage.run(sagaCtx, ...)` but **not** in `uowStorage.run`. With no ambient UoW, each command creates its own implicit UoW via `CommandLifecycleExecutor`, commits independently, and publishes its own produced events after its own commit.

17. **Committed-state visibility** -- Because the saga state is persisted before any reaction command runs, a command handler (aggregate decider or standalone handler) that dispatches an event directly via `infrastructure.eventBus.dispatch()` — and any re-entrant `SagaExecutor.execute` triggered by that event for the same saga instance — loads the committed saga state (not `null`). The event is handled (or starts/resumes the instance) rather than being silently dropped.

18. **No cross-command rollback (best-effort)** -- Once the saga-state UoW has committed, a subsequent reaction-command failure does **not** roll back the (already durable) saga state; the failing command's own UoW rolls back only its own aggregate changes. The error still propagates to the caller / event bus.

## Invariants

- **Atomicity is per-saga, selected by `saga.atomicity ?? "atomic"`.** Steps 1-6 (lookup, load, bootstrap/resume, handler, metadata) are identical across modes; only the UoW / commit / dispatch ordering differs.
- In **atomic** mode, the saga's UoW spans saga-state persistence and all reaction commands; they commit or roll back together. A reaction-command failure rolls back the saga-state transition.
- In **best-effort** mode, the saga state is committed in its own UoW **before** any reaction command is dispatched; reaction commands run outside that UoW, each in its own UoW. A reaction-command failure does **not** roll back the (already committed) saga state.
- Events produced by aggregate deciders are published only after the UoW that persists them commits (never before) — in **atomic** mode the saga's UoW, in **best-effort** mode each command's own UoW.
- Publishing always happens outside the `uowStorage` `AsyncLocalStorage` scope of the UoW that was just committed — in both modes. A standalone event handler that dispatches a command in reaction to a saga-produced event never observes an already-completed `uow` via `uowStorage.getStore()`; it always gets `undefined` (implicit-UoW path) unless it is itself nested inside a still-open, unrelated UoW scope.
- `runUowCompletionHooks(uow, committed)` runs exactly once per saga-owned UoW, after that UoW settles (commit or rollback) and outside the ALS scope — never zero times, never twice.
- The metadata context is set before any commands are dispatched, in **both** modes, ensuring enriched events carry the saga's correlation chain.
- The `causationId` for events produced by saga-dispatched commands is the `eventId` of the triggering event (linking cause to effect).
- If `saga.on[event.name]` is `undefined`, the event is silently ignored (no error).
- If `saga.on[event.name]?.handle` is `undefined`, the event is silently ignored (no error).
- If the saga has not started and the event is not in `startedBy`, the event is silently ignored.
- UoW rollback errors are swallowed; the original error is re-thrown.
- The executor always creates its own UoW for saga-state persistence (it never reuses an ambient one). In **atomic** mode that UoW also bounds the reaction commands; in **best-effort** mode the reaction commands are dispatched after it commits and obtain their own UoWs.
- In **best-effort** mode, a command handler that dispatches an event directly via `eventBus.dispatch()` observes committed saga state; the re-entrant saga event is handled, not dropped.
- In **atomic** mode, off-path direct `eventBus.dispatch()` from a command handler still races the saga-state commit: with the in-process bus the re-entrant event is delivered before the saga's UoW commits, loads `null`, and is silently ignored ("saga not started"). This is a **documented limitation of `atomic`**; the golden path (deciders/aggregates **return** events, which are deferred and published only after commit) avoids it entirely.

## Edge Cases

- **No `on` entry for event name** -- Returns immediately. No state load, no handler invocation.
- **No handler for event name** -- Returns immediately after `on` map lookup. State may be loaded but no handler runs.
- **Saga not started and event not in startedBy** -- Returns immediately. No handler invocation, no state persistence.
- **Saga already started and receives a startedBy event** -- Uses the existing state (does not reset to `initialState`). The `startedBy` check only applies when state is `null`.
- **Reaction with no commands** -- Only saga state is persisted. No commands dispatched. UoW commits with just the state save.
- **Reaction with single command (not array)** -- Normalized to `[command]` before dispatching.
- **Reaction with multiple commands** -- Each dispatched sequentially. In **atomic** mode all aggregate changes enlist on the saga's UoW; in **best-effort** mode each command commits in its own UoW after the saga state is persisted.
- **Command dispatch throws (atomic mode)** -- The saga's UoW is rolled back; saga state is **not** persisted; the error propagates.
- **Command dispatch throws (best-effort mode)** -- The saga-state UoW has already committed, so saga state **is** persisted; the failing command's own UoW rolls back its own aggregate changes; the error still propagates.
- **Saga omits `atomicity`** -- Treated as `"atomic"` (default); behavior is identical to pre-`atomicity` sagas.
- **Best-effort saga whose command handler dispatches a consumed event** -- The event is processed against committed saga state and advances the saga instance (the issue #119 scenario, fixed under best-effort).
- **Atomic saga whose command handler dispatches a consumed event** -- With the in-process event bus the re-entrant event is delivered before the saga UoW commits, loads `null`, and is dropped ("saga not started"); the saga does not advance. Documented limitation of `atomic` — use the golden path (return events) or `best-effort`.
- **sagaPersistence.save throws during commit** -- UoW commit fails. Error propagates after rollback attempt.
- **Triggering event has no metadata** -- `correlationId` defaults to a new UUID v7. `causationId` defaults to `event.name`. `userId` is `undefined`.
- **Triggering event has metadata** -- `correlationId`, `causationId` (from `eventId`), and `userId` are propagated.
- **Saga handler returns empty commands array** -- No commands dispatched (same as `undefined`).
- **A standalone event handler dispatches a command in reaction to a saga-produced event** -- The handler's `commandBus.dispatch()` call finds no ambient UoW (publishing happens outside `uowStorage.run`), takes the implicit-UoW path, and succeeds with its own independent UoW — it does NOT throw `"UnitOfWork already completed"`. This holds in both atomic and best-effort mode.

## Integration Points

- **Domain** -- Constructs the `SagaExecutor` during `init()` and subscribes it to event bus events matching `Object.keys(saga.on)`.
- **`Saga.atomicity` (core, `ddd/saga`)** -- `execute` reads `saga.atomicity` to select the mode; an absent field defaults to `"atomic"`. The field is declared and documented in the core saga spec; this spec defines its observable runtime behavior.
- **CommandBus** -- Saga dispatches commands through `infrastructure.commandBus.dispatch()`. This routes to aggregate command handlers registered by the Domain.
- **CommandLifecycleExecutor** -- When the saga dispatches commands, the command bus invokes the `CommandLifecycleExecutor`. In **atomic** mode the saga's UoW is in `AsyncLocalStorage`, so the executor takes the explicit-UoW path and enlists on it. In **best-effort** mode commands are dispatched after the saga UoW commits and outside `uowStorage`, so the executor takes the implicit-UoW path — creating and committing its own UoW per command and publishing that command's events after its own commit.
- **SagaPersistence** -- Saga state is loaded and saved via the persistence interface.
- **MetadataEnricher** -- Indirectly used: the metadata context set by the saga flows through `AsyncLocalStorage` to the `MetadataEnricher` in `CommandLifecycleExecutor`, ensuring correlation propagation.
- **EventBus** -- Events deferred by aggregate commands within the saga are published after UoW commit.
- **`uow-completion-hooks.ts`** -- `runUowCompletionHooks(uow, committed)` is called once per saga-owned UoW after it settles (see `specs/engine/executors/command-lifecycle-executor.spec.md` requirement 14a); this releases any pessimistic locks or saves any pending snapshots that aggregate commands dispatched during the reaction (requirement 11) registered via `onUowSettled`/`onUowCommitted` on that same UoW.
- **EventBus error isolation (layering)** -- `SagaExecutor.execute()` continues to perform its own internal `log + rollback UoW + rethrow` on failure (BR #13). The rollback contract is unchanged. However, when the executor's rethrow surfaces back to the bus, the bus's per-handler isolation layer (see `core/edd/event-bus`) catches the rethrow so it no longer poisons sibling subscribers (other sagas, projections, standalone handlers) on the same event. In other words: a saga still fails atomically (its UoW rolls back), but its failure no longer cascades to unrelated read-side consumers of the triggering event.

## Test Scenarios

### execute derives saga ID and runs handler for a startedBy event

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type OrderSagaState = { status: string };
type OrderSagaEvent = DefineEvents<{
  OrderPlaced: { orderId: string };
  PaymentReceived: { orderId: string };
}>;
type OrderSagaTypes = SagaTypes & {
  state: OrderSagaState;
  events: OrderSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const OrderSaga = defineSaga<OrderSagaTypes>({
  initialState: { status: "new" },
  startedBy: ["OrderPlaced"],
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      handle: (event, state) => ({
        state: { status: "placed" },
      }),
    },
    PaymentReceived: {
      id: (event) => event.payload.orderId,
      handle: (event, state) => ({
        state: { status: "paid" },
      }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should bootstrap saga with initialState on startedBy event and persist new state", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("OrderSaga", OrderSaga, {
      name: "OrderPlaced",
      payload: { orderId: "order-1" },
    });

    const state = await sagaPersistence.load("OrderSaga", "order-1");
    expect(state).toEqual({ status: "placed" });
  });
});
```

### execute ignores event when saga not started and event not in startedBy

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type MySagaState = { started: boolean };
type MySagaEvent = DefineEvents<{
  Started: { id: string };
  Continued: { id: string };
}>;
type MySagaTypes = SagaTypes & {
  state: MySagaState;
  events: MySagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const MySaga = defineSaga<MySagaTypes>({
  initialState: { started: false },
  startedBy: ["Started"],
  on: {
    Started: {
      id: (event) => event.payload.id,
      handle: () => ({ state: { started: true } }),
    },
    Continued: {
      id: (event) => event.payload.id,
      handle: (event, state) => ({ state }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should ignore event when saga not started and event not in startedBy", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // Dispatch "Continued" without prior "Started" — should be ignored
    await executor.execute("MySaga", MySaga, {
      name: "Continued",
      payload: { id: "s1" },
    });

    const state = await sagaPersistence.load("MySaga", "s1");
    expect(state).toBeUndefined();
  });
});
```

### execute returns immediately when no association exists for event name

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type MinSagaState = {};
type MinSagaEvent = DefineEvents<{ Known: { id: string } }>;
type MinSagaTypes = SagaTypes & {
  state: MinSagaState;
  events: MinSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const MinSaga = defineSaga<MinSagaTypes>({
  initialState: {},
  startedBy: ["Known"],
  on: {
    Known: {
      id: (event) => event.payload.id,
      handle: () => ({ state: {} }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should return immediately when no association exists for the event", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const loadSpy = vi.spyOn(sagaPersistence, "load");
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // "Unknown" has no entry in MinSaga.on
    await executor.execute("MinSaga", MinSaga, {
      name: "Unknown",
      payload: { id: "x" },
    });

    // Should not even load state
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
```

### execute dispatches reaction commands within saga UoW

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineSaga, defineAggregate } from "@noddde/core";
import type {
  SagaTypes,
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
  Command,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type DispatchSagaState = { dispatched: boolean };
type DispatchSagaEvent = DefineEvents<{
  TriggerReceived: { id: string };
}>;
type DispatchSagaTypes = SagaTypes & {
  state: DispatchSagaState;
  events: DispatchSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const DispatchSaga = defineSaga<DispatchSagaTypes>({
  initialState: { dispatched: false },
  startedBy: ["TriggerReceived"],
  on: {
    TriggerReceived: {
      id: (event) => event.payload.id,
      handle: () => ({
        state: { dispatched: true },
        commands: {
          name: "DoSomething",
          payload: { value: 42 },
          targetAggregateId: "target-1",
        },
      }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should dispatch reaction commands through the command bus", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const dispatchedCommands: Command[] = [];
    commandBus.register("DoSomething", async (command) => {
      dispatchedCommands.push(command);
    });

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("DispatchSaga", DispatchSaga, {
      name: "TriggerReceived",
      payload: { id: "d1" },
    });

    expect(dispatchedCommands).toHaveLength(1);
    expect(dispatchedCommands[0]!.name).toBe("DoSomething");
    expect(dispatchedCommands[0]!.payload).toEqual({ value: 42 });

    // Saga state should also be persisted
    const state = await sagaPersistence.load("DispatchSaga", "d1");
    expect(state).toEqual({ dispatched: true });
  });
});
```

### execute propagates correlation metadata from triggering event

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
  Command,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type CorrSagaState = {};
type CorrSagaEvent = DefineEvents<{ CorrEvent: { id: string } }>;
type CorrSagaTypes = SagaTypes & {
  state: CorrSagaState;
  events: CorrSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const CorrSaga = defineSaga<CorrSagaTypes>({
  initialState: {},
  startedBy: ["CorrEvent"],
  on: {
    CorrEvent: {
      id: (event) => event.payload.id,
      handle: () => ({
        state: {},
        commands: {
          name: "DownstreamCmd",
          payload: {},
          targetAggregateId: "ds1",
        },
      }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should propagate correlationId and causationId from triggering event metadata", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();

    let capturedCtx: MetadataContext | undefined;
    commandBus.register("DownstreamCmd", async () => {
      capturedCtx = metadataStorage.getStore();
    });

    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("CorrSaga", CorrSaga, {
      name: "CorrEvent",
      payload: { id: "c1" },
      metadata: {
        eventId: "evt-123",
        timestamp: "2025-01-01T00:00:00Z",
        correlationId: "corr-abc",
        causationId: "cause-xyz",
        userId: "user-99",
      },
    });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.correlationId).toBe("corr-abc");
    expect(capturedCtx!.causationId).toBe("evt-123");
    expect(capturedCtx!.userId).toBe("user-99");
  });
});
```

### execute rolls back UoW when command dispatch throws

> **Atomic-mode test (default).** `RbSaga` declares no `atomicity` field, so it runs in the default `atomic` mode: the saga's UoW spans the state save and the failing command, so a command failure rolls back the saga-state transition. The best-effort inverse is the next scenario.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type RbSagaState = { ran: boolean };
type RbSagaEvent = DefineEvents<{ RbTrigger: { id: string } }>;
type RbSagaTypes = SagaTypes & {
  state: RbSagaState;
  events: RbSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const RbSaga = defineSaga<RbSagaTypes>({
  initialState: { ran: false },
  startedBy: ["RbTrigger"],
  on: {
    RbTrigger: {
      id: (event) => event.payload.id,
      handle: () => ({
        state: { ran: true },
        commands: {
          name: "FailingCmd",
          payload: {},
          targetAggregateId: "fail-1",
        },
      }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should rollback UoW and not persist saga state when command throws", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    commandBus.register("FailingCmd", async () => {
      throw new Error("Command failed");
    });
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await expect(
      executor.execute("RbSaga", RbSaga, {
        name: "RbTrigger",
        payload: { id: "rb1" },
      }),
    ).rejects.toThrow("Command failed");

    // Saga state should NOT be persisted due to rollback
    const state = await sagaPersistence.load("RbSaga", "rb1");
    expect(state).toBeUndefined();
  });
});
```

### execute handles reaction with no commands (state-only update)

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect, vi } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type NoCmdSagaState = { step: number };
type NoCmdSagaEvent = DefineEvents<{ StepEvent: { id: string } }>;
type NoCmdSagaTypes = SagaTypes & {
  state: NoCmdSagaState;
  events: NoCmdSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const NoCmdSaga = defineSaga<NoCmdSagaTypes>({
  initialState: { step: 0 },
  startedBy: ["StepEvent"],
  on: {
    StepEvent: {
      id: (event) => event.payload.id,
      handle: (event, state) => ({
        state: { step: state.step + 1 },
        // No commands
      }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should persist saga state without dispatching commands when reaction has none", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const dispatchSpy = vi.spyOn(commandBus, "dispatch");
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("NoCmdSaga", NoCmdSaga, {
      name: "StepEvent",
      payload: { id: "nc1" },
    });

    const state = await sagaPersistence.load("NoCmdSaga", "nc1");
    expect(state).toEqual({ step: 1 });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
```

### saga handler failure is isolated from sibling subscribers on the same event

> Integration scenario — verifies the layering: SagaExecutor logs + rolls back + rethrows; the event bus's per-handler isolation absorbs the rethrow so sibling projections on the same event still update.

```ts
import { describe, expect, it, vi } from "vitest";
import type { DefineCommands, DefineEvents, DefineQueries } from "@noddde/core";
import {
  defineAggregate,
  defineDomain,
  defineProjection,
  defineSaga,
} from "@noddde/core";
import {
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  InMemoryViewStore,
  wireDomain,
} from "@noddde/engine";

describe("Saga-failure isolation from sibling subscribers", () => {
  type UserEvent = DefineEvents<{ UserCreated: { id: string; name: string } }>;
  type UserCommand = DefineCommands<{ CreateUser: { name: string } }>;
  type UserTypes = {
    state: { name: string } | null;
    events: UserEvent;
    commands: UserCommand;
    infrastructure: {};
  };
  type UserView = { id: string; name: string };
  type UserQuery = DefineQueries<{
    GetUser: { payload: { id: string }; result: UserView | undefined | null };
  }>;
  type UserProjectionTypes = {
    events: UserEvent;
    queries: UserQuery;
    view: UserView;
    infrastructure: {};
  };
  type FailingSagaState = { started: boolean };
  type FailingSagaTypes = {
    state: FailingSagaState;
    events: UserEvent;
    commands: never;
    infrastructure: {};
  };

  const User = defineAggregate<UserTypes>({
    initialState: null,
    decide: {
      CreateUser: (cmd) => ({
        name: "UserCreated",
        payload: { id: cmd.targetAggregateId, name: cmd.payload.name },
      }),
    },
    evolve: { UserCreated: (payload) => ({ name: payload.name }) },
  });

  const HealthyProjection = defineProjection<UserProjectionTypes>({
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        reduce: (event) => ({
          id: event.payload.id,
          name: event.payload.name,
        }),
      },
    },
    queryHandlers: {},
  });

  const FailingSaga = defineSaga<FailingSagaTypes>({
    initialState: { started: false },
    startedBy: ["UserCreated"],
    on: {
      UserCreated: {
        id: (event) => event.payload.id,
        handle: () => {
          throw new Error("saga bug");
        },
      },
    },
  });

  it("should let sibling projections update and keep the command successful when a saga handler throws", async () => {
    const viewStore = new InMemoryViewStore<UserView>();
    const sagaPersistence = new InMemorySagaPersistence();
    const sagaSaveSpy = vi.spyOn(sagaPersistence, "save");

    const definition = defineDomain({
      writeModel: { aggregates: { User } },
      readModel: {
        projections: { HealthyProjection },
        sagas: { FailingSaga },
      },
    });

    const domain = await wireDomain(definition, {
      aggregates: {
        persistence: () => new InMemoryEventSourcedAggregatePersistence(),
      },
      projections: {
        HealthyProjection: { viewStore: () => viewStore },
      },
      sagas: { persistence: () => sagaPersistence },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await expect(
      domain.commandBus.dispatch({
        name: "CreateUser",
        targetAggregateId: "u-1",
        payload: { name: "Alice" },
      }),
    ).resolves.not.toThrow();

    // Eventual consistency: allow the event bus to drain.
    await new Promise((r) => setTimeout(r, 10));

    // Saga state NOT persisted — its UoW rolled back (SagaExecutor contract).
    expect(sagaSaveSpy).not.toHaveBeenCalled();

    // Sibling projection still updated — bus isolation absorbed the saga's rethrow.
    expect(await viewStore.load("u-1")).toEqual({
      id: "u-1",
      name: "Alice",
    });
  });
});
```

### a standalone handler can dispatch a command in reaction to a saga-published event (atomic mode)

> Integration reproduction of the "UnitOfWork already completed" re-entrancy defect: a saga (atomic mode) reacts to `SourceDone` and just records its own state (no reaction commands, so the fix is exercised purely by the publish step). A standalone event handler also reacts to `SourceDone` by dispatching `UpdateTarget` against a second aggregate. Before the fix, the saga's publish loop ran while the saga's now-completed `uow` was still the ambient `AsyncLocalStorage` value, so the standalone handler's re-entrant dispatch hit the explicit-UoW path, threw `"UnitOfWork already completed"` when it tried to enlist, and that throw was swallowed into a log by the event bus — `Target` was silently never updated. After the fix, publishing happens outside that scope, so the re-entrant dispatch takes the implicit-UoW path and succeeds.

```ts
import { describe, it, expect } from "vitest";
import type {
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";
import { defineAggregate, defineDomain, defineSaga } from "@noddde/core";
import {
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  wireDomain,
} from "@noddde/engine";

describe("SagaExecutor: re-entrant dispatch from a standalone event handler", () => {
  type SourceEvent = DefineEvents<{ SourceDone: { id: string } }>;
  type SourceCommand = DefineCommands<{ FinishSource: { id: string } }>;
  type SourceTypes = {
    state: { done: boolean } | null;
    events: SourceEvent;
    commands: SourceCommand;
    infrastructure: Infrastructure;
  };

  type TargetEvent = DefineEvents<{ TargetUpdated: { id: string } }>;
  type TargetCommand = DefineCommands<{ UpdateTarget: { id: string } }>;
  type TargetTypes = {
    state: { updated: boolean } | null;
    events: TargetEvent;
    commands: TargetCommand;
    infrastructure: Infrastructure;
  };

  type TriggerSagaTypes = {
    state: { started: boolean };
    events: SourceEvent;
    commands: never;
    infrastructure: Infrastructure;
  };

  const Source = defineAggregate<SourceTypes>({
    initialState: null,
    decide: {
      FinishSource: (cmd) => ({
        name: "SourceDone",
        payload: { id: cmd.targetAggregateId as string },
      }),
    },
    evolve: { SourceDone: () => ({ done: true }) },
  });

  const Target = defineAggregate<TargetTypes>({
    initialState: null,
    decide: {
      UpdateTarget: (cmd) => ({
        name: "TargetUpdated",
        payload: { id: cmd.targetAggregateId as string },
      }),
    },
    evolve: { TargetUpdated: () => ({ updated: true }) },
  });

  const TriggerSaga = defineSaga<TriggerSagaTypes>({
    atomicity: "atomic",
    initialState: { started: false },
    startedBy: ["SourceDone"],
    on: {
      SourceDone: {
        id: (event) => event.payload.id,
        handle: () => ({ state: { started: true } }),
      },
    },
  });

  it("should let a standalone handler dispatch a command against a second aggregate", async () => {
    const sharedPersistence = new InMemoryEventSourcedAggregatePersistence();

    const definition = defineDomain({
      writeModel: { aggregates: { Source, Target } },
      readModel: { projections: {} },
      processModel: {
        sagas: { TriggerSaga },
        standaloneEventHandlers: {
          SourceDone: async (event, infrastructure) => {
            await infrastructure.commandBus.dispatch({
              name: "UpdateTarget",
              targetAggregateId: event.payload.id,
              payload: { id: event.payload.id },
            });
          },
        },
      },
    });

    const domain = await wireDomain(definition, {
      aggregates: { persistence: () => sharedPersistence },
      sagas: { persistence: () => new InMemorySagaPersistence() },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "FinishSource",
      targetAggregateId: "s-1",
      payload: { id: "s-1" },
    });

    const targetEvents = await sharedPersistence.load("Target", "s-1");
    expect(targetEvents).toHaveLength(1);
    expect(targetEvents[0]!.name).toBe("TargetUpdated");
  });
});
```

### execute resumes existing saga on subsequent events

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type FlowSagaState = { steps: string[] };
type FlowSagaEvent = DefineEvents<{
  FlowStarted: { id: string };
  FlowContinued: { id: string };
}>;
type FlowSagaTypes = SagaTypes & {
  state: FlowSagaState;
  events: FlowSagaEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const FlowSaga = defineSaga<FlowSagaTypes>({
  initialState: { steps: [] },
  startedBy: ["FlowStarted"],
  on: {
    FlowStarted: {
      id: (event) => event.payload.id,
      handle: (event, state) => ({
        state: { steps: [...state.steps, "started"] },
      }),
    },
    FlowContinued: {
      id: (event) => event.payload.id,
      handle: (event, state) => ({
        state: { steps: [...state.steps, "continued"] },
      }),
    },
  },
});

describe("SagaExecutor", () => {
  it("should resume saga from persisted state on subsequent events", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // First event starts the saga
    await executor.execute("FlowSaga", FlowSaga, {
      name: "FlowStarted",
      payload: { id: "flow-1" },
    });

    // Second event continues the saga
    await executor.execute("FlowSaga", FlowSaga, {
      name: "FlowContinued",
      payload: { id: "flow-1" },
    });

    const state = await sagaPersistence.load("FlowSaga", "flow-1");
    expect(state).toEqual({ steps: ["started", "continued"] });
  });
});
```

### execute persists saga state even when a command throws under best-effort

> Best-effort inverse of the atomic rollback test. `atomicity: "best-effort"` commits the saga state before dispatching reaction commands, so a downstream command failure does **not** roll back the saga-state transition; the error still propagates.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type BeRbState = { ran: boolean };
type BeRbEvent = DefineEvents<{ BeRbTrigger: { id: string } }>;
type BeRbTypes = SagaTypes & {
  state: BeRbState;
  events: BeRbEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const BeRbSaga = defineSaga<BeRbTypes>({
  atomicity: "best-effort",
  initialState: { ran: false },
  startedBy: ["BeRbTrigger"],
  on: {
    BeRbTrigger: {
      id: (event) => event.payload.id,
      handle: () => ({
        state: { ran: true },
        commands: {
          name: "FailingCmd",
          payload: {},
          targetAggregateId: "fail-be",
        },
      }),
    },
  },
});

describe("SagaExecutor best-effort", () => {
  it("should persist saga state even when a command throws", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    commandBus.register("FailingCmd", async () => {
      throw new Error("Command failed");
    });
    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await expect(
      executor.execute("BeRbSaga", BeRbSaga, {
        name: "BeRbTrigger",
        payload: { id: "be1" },
      }),
    ).rejects.toThrow("Command failed");

    // Saga state IS persisted — committed before the command ran.
    const state = await sagaPersistence.load("BeRbSaga", "be1");
    expect(state).toEqual({ ran: true });
  });
});
```

### execute commits saga state before dispatching commands under best-effort

> Proves the commit-first ordering directly: by the time the reaction command's handler runs, the new saga state is already loadable from persistence.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type OrderingState = { phase: string };
type OrderingEvent = DefineEvents<{ Begin: { id: string } }>;
type OrderingTypes = SagaTypes & {
  state: OrderingState;
  events: OrderingEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const OrderingSaga = defineSaga<OrderingTypes>({
  atomicity: "best-effort",
  initialState: { phase: "init" },
  startedBy: ["Begin"],
  on: {
    Begin: {
      id: (event) => event.payload.id,
      handle: () => ({
        state: { phase: "committed" },
        commands: { name: "Probe", payload: {}, targetAggregateId: "p1" },
      }),
    },
  },
});

describe("SagaExecutor best-effort", () => {
  it("should have committed saga state by the time the command handler runs", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    let stateSeenByCommand: unknown;
    commandBus.register("Probe", async () => {
      stateSeenByCommand = await sagaPersistence.load("OrderingSaga", "o1");
    });

    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    };

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    await executor.execute("OrderingSaga", OrderingSaga, {
      name: "Begin",
      payload: { id: "o1" },
    });

    // The command handler observed the already-committed saga state.
    expect(stateSeenByCommand).toEqual({ phase: "committed" });
  });
});
```

### execute under best-effort lets a command-handler-dispatched event resume the same saga (issue #119)

> Canonical reproduction of issue #119, fixed under `best-effort`. The saga's `StartTask` handler dispatches a `ProcessTask` command whose handler publishes a `ProcessCompleted` event **directly** on the event bus (the off-path pattern standalone command handlers must use). The executor is subscribed to the bus via `eventBus.on`, exactly as `Domain` wires it. Because best-effort commits saga state before dispatching the command, the re-entrant `ProcessCompleted` finds the persisted state and advances the saga to `done`.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Event,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type TaskState = { step: "initial" | "processing" | "done" };
type TaskEvent = DefineEvents<{
  StartTask: { taskId: string };
  ProcessCompleted: { taskId: string };
}>;
type TaskTypes = SagaTypes & {
  state: TaskState;
  events: TaskEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const BestEffortTaskSaga = defineSaga<TaskTypes>({
  atomicity: "best-effort",
  initialState: { step: "initial" },
  startedBy: ["StartTask"],
  on: {
    StartTask: {
      id: (event) => event.payload.taskId,
      handle: (event) => ({
        state: { step: "processing" },
        commands: {
          name: "ProcessTask",
          payload: { taskId: event.payload.taskId },
          targetAggregateId: event.payload.taskId,
        },
      }),
    },
    ProcessCompleted: {
      id: (event) => event.payload.taskId,
      handle: (_event, state) => ({
        state: { ...state, step: "done" },
      }),
    },
  },
});

describe("SagaExecutor best-effort (issue #119)", () => {
  it("should resume the saga when a command handler dispatches a consumed event", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const eventBus = new EventEmitterEventBus();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    // Wire the executor to the event bus exactly as Domain does (eventBus.on).
    for (const eventName of Object.keys(BestEffortTaskSaga.on)) {
      eventBus.on(eventName, (event: Event) =>
        executor.execute("TaskSaga", BestEffortTaskSaga, event),
      );
    }

    // Standalone-style command handler: publishes an event directly (off-path).
    commandBus.register("ProcessTask", async (command) => {
      await eventBus.dispatch({
        name: "ProcessCompleted",
        payload: { taskId: (command.payload as { taskId: string }).taskId },
      });
    });

    await executor.execute("TaskSaga", BestEffortTaskSaga, {
      name: "StartTask",
      payload: { taskId: "t-1" },
    });

    const state = await sagaPersistence.load("TaskSaga", "t-1");
    expect(state).toEqual({ step: "done" });
  });
});
```

### execute under atomic drops an event dispatched by a command handler (issue #119 limitation)

> Documents the `atomic`-mode limitation. The same shape as the best-effort reproduction, but `atomicity: "atomic"`. Because commands are dispatched inside the saga's UoW (before commit), the re-entrant `ProcessCompleted` loads `null` saga state and is dropped — the saga never reaches `done`. The remedy is the golden path (return events) or `best-effort`.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { defineSaga } from "@noddde/core";
import type {
  SagaTypes,
  DefineEvents,
  Event,
  Infrastructure,
  CQRSInfrastructure,
  UnitOfWork,
} from "@noddde/core";
import {
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
  InMemorySagaPersistence,
  createInMemoryUnitOfWork,
} from "@noddde/engine";
import { SagaExecutor } from "../../../executors/saga-executor";
import type { MetadataContext } from "../../../domain";

type AtomicTaskState = { step: "initial" | "processing" | "done" };
type AtomicTaskEvent = DefineEvents<{
  StartTask: { taskId: string };
  ProcessCompleted: { taskId: string };
}>;
type AtomicTaskTypes = SagaTypes & {
  state: AtomicTaskState;
  events: AtomicTaskEvent;
  commands: never;
  infrastructure: Infrastructure & CQRSInfrastructure;
};

const AtomicTaskSaga = defineSaga<AtomicTaskTypes>({
  atomicity: "atomic",
  initialState: { step: "initial" },
  startedBy: ["StartTask"],
  on: {
    StartTask: {
      id: (event) => event.payload.taskId,
      handle: (event) => ({
        state: { step: "processing" },
        commands: {
          name: "ProcessTask",
          payload: { taskId: event.payload.taskId },
          targetAggregateId: event.payload.taskId,
        },
      }),
    },
    ProcessCompleted: {
      id: (event) => event.payload.taskId,
      handle: (_event, state) => ({
        state: { ...state, step: "done" },
      }),
    },
  },
});

describe("SagaExecutor atomic (issue #119 limitation)", () => {
  it("should drop a command-handler-dispatched event (saga stays at processing)", async () => {
    const sagaPersistence = new InMemorySagaPersistence();
    const commandBus = new InMemoryCommandBus();
    const eventBus = new EventEmitterEventBus();
    const uowStorage = new AsyncLocalStorage<UnitOfWork>();
    const metadataStorage = new AsyncLocalStorage<MetadataContext>();

    const infrastructure: Infrastructure & CQRSInfrastructure = {
      commandBus,
      eventBus,
      queryBus: new InMemoryQueryBus(),
    };

    const executor = new SagaExecutor(
      infrastructure,
      sagaPersistence,
      createInMemoryUnitOfWork,
      uowStorage,
      metadataStorage,
    );

    for (const eventName of Object.keys(AtomicTaskSaga.on)) {
      eventBus.on(eventName, (event: Event) =>
        executor.execute("AtomicTaskSaga", AtomicTaskSaga, event),
      );
    }

    commandBus.register("ProcessTask", async (command) => {
      await eventBus.dispatch({
        name: "ProcessCompleted",
        payload: { taskId: (command.payload as { taskId: string }).taskId },
      });
    });

    await executor.execute("AtomicTaskSaga", AtomicTaskSaga, {
      name: "StartTask",
      payload: { taskId: "t-2" },
    });

    // The re-entrant ProcessCompleted arrived before commit → dropped.
    const state = await sagaPersistence.load("AtomicTaskSaga", "t-2");
    expect(state).toEqual({ step: "processing" });
  });
});
```
