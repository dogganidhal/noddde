# Audit Report: Engine — Distributed Systems Fixes

**Specs**:

- `specs/engine/domain.spec.md` (steps 2, 6, 13b)
- `specs/engine/executors/command-lifecycle-executor.spec.md` (reqs 11, 15)
- `specs/engine/executors/saga-executor.spec.md` (req 12)

**Sources**:

- `packages/engine/src/domain.ts`
- `packages/engine/src/executors/command-lifecycle-executor.ts`
- `packages/engine/src/executors/saga-executor.ts`

**Date**: 2026-04-10
**Verdict**: **PASS**

---

## Fix 1: Sequential Event Dispatch (All 3 Files)

**Spec requirement**: `Promise.all(events.map(...))` replaced with `for (const e of events) { await eventBus.dispatch(e); }`. Sequential dispatch preserves causal ordering.

### command-lifecycle-executor.ts

**Source verification** (lines 166-168):

```ts
for (const e of events) {
  await eventBus.dispatch(e);
}
```

This is the implicit UoW path (req 11/15). Events are dispatched one at a time in order.

**Spec alignment**: Req 11 states "all returned events are dispatched sequentially via `for (const e of events) { await eventBus.dispatch(e); }`". Req 15 restates this for the event publishing after implicit commit path.

### saga-executor.ts

**Source verification** (lines 160-162):

```ts
for (const e of events) {
  await this.infrastructure.eventBus.dispatch(e);
}
```

This is the saga UoW commit path (req 12).

**Spec alignment**: Req 12 states "dispatch all returned events sequentially via `for (const e of events) { await infrastructure.eventBus.dispatch(e); }`".

### domain.ts

**Source verification** (lines 1332-1334):

```ts
for (const e of events) {
  await this._infrastructure.eventBus.dispatch(e);
}
```

This is the `withUnitOfWork` helper path.

**Grep confirmation**: A search for `Promise.all` across all files in `packages/engine/src/domain.ts` and `packages/engine/src/executors/` returned zero matches. All event dispatch loops use the sequential `for...of` pattern.

**Result**: PASS. All three dispatch sites use sequential `for...of` loops. No `Promise.all` remains for event dispatch anywhere in the engine package.

---

## Fix 2: Handler Registration Before Connect (domain.ts)

**Spec requirement** (step 2 note + step 13b): Auto-connect code must run AFTER all handler registration (steps 6-13). All `bus.on()` calls must happen BEFORE any `bus.connect()` call.

**Source verification**:

The `init()` method in `domain.ts` follows this exact order:

1. **Steps 0-5.12** (lines 526-1011): Infrastructure resolution, persistence, executor creation, upcaster validation.
2. **Step 6** (lines 1016-1046): Register aggregate command handlers on command bus.
3. **Step 7** (lines 1049-1062): Register standalone command handlers.
4. **Step 8** (lines 1064-1086): Register projection query handlers on query bus.
5. **Step 9** (lines 1088-1102): Register standalone query handlers.
6. **Step 10** (lines 1104-1145): Register event listeners for projections via `eventBus.on()`.
7. **Step 11** (lines 1148-1158): Register event listeners for sagas via `eventBus.on()`.
8. **Step 12** (lines 1161-1170): Register standalone event handlers via `eventBus.on()`.
9. **Step 13b** (lines 1173-1181): Auto-connect buses. Comment explicitly states: "Must happen AFTER all handler registration (steps 6-12) to prevent a race condition where broker-backed buses deliver queued messages before handlers are registered."

The connect loop at lines 1177-1181:

```ts
for (const bus of [commandBus, eventBus, queryBus]) {
  if (isConnectable(bus)) {
    await bus.connect();
  }
}
```

This runs strictly AFTER all `bus.on()` calls. There is no earlier `connect()` call anywhere in `init()`.

**Spec alignment**: Step 2 note says "Auto-connect is deferred to step 13b (after all handler registration)." Step 13b says "After ALL handler registration is complete (steps 7-13), iterate over `{ commandBus, eventBus, queryBus }`. For each that passes `isConnectable(bus)`, call `await bus.connect()`."

**Result**: PASS. The ordering is correct: all handler registration happens before any connect call.

---

## Overall Assessment

Both distributed systems fixes are correctly implemented across all three source files.

- **Tests**: 330/330 passed (entire engine test suite)
- **Type check**: Clean (zero errors)
- **Sequential dispatch**: Verified via grep -- zero `Promise.all` instances remain in domain.ts or executors. All three dispatch sites use `for (const e of events) { await eventBus.dispatch(e); }`.
- **Handler-before-connect**: Verified by reading the full `init()` method. Steps 6-12 (all handler registration) precede step 13b (connect). The code comment at line 1173 explicitly documents the ordering rationale.

**Docs**: Updated `docs/content/docs/running/event-bus-adapters.mdx` "Connection Lifecycle" section to clarify that handler registration occurs BEFORE connect, correcting the previous ordering (which listed auto-connect before handler registration).
