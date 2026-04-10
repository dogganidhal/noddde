# Build Report: Adapter Connectable Type Updates

**Date**: 2026-04-10
**Builder**: Claude Sonnet 4.6
**Task**: Add explicit `Connectable` interface to 3 message broker EventBus adapters

## Summary

Updated all three message broker adapter classes to explicitly implement the `Connectable` interface from `@noddde/core`. The classes already structurally satisfied `Connectable` (each had a `connect(): Promise<void>` method) — these changes make the satisfaction explicit in the type system.

## Changes Made

### `packages/adapters/kafka/src/kafka-event-bus.ts`

- Import: added `Connectable` to the existing `@noddde/core` import, sorted alphabetically (`AsyncEventHandler, Connectable, EventBus`)
- Class declaration: `implements EventBus` → `implements EventBus, Connectable`

### `packages/adapters/nats/src/nats-event-bus.ts`

- Import: added `Connectable` to the existing `@noddde/core` import (`AsyncEventHandler, Connectable, EventBus`)
- Class declaration: `implements EventBus` → `implements EventBus, Connectable`

### `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`

- Import: added `Connectable` to the existing `@noddde/core` import (`AsyncEventHandler, Connectable, EventBus`)
- Class declaration: `implements EventBus` → `implements EventBus, Connectable`

## Type Check Results

All three packages were type-checked with `npx tsc --noEmit`. The only errors observed were:

```
error TS2305: Module '"@noddde/core"' has no exported member 'Connectable'.
```

This error is expected: `Connectable` is being added to `@noddde/core` by a parallel Builder. Once that export lands, these packages will type-check cleanly. The edits themselves are correct — no other type errors exist.

## Test Results

All existing tests pass without modification:

| Package  | Test Files | Tests    | Result |
| -------- | ---------- | -------- | ------ |
| kafka    | 1 passed   | 8 passed | PASS   |
| nats     | 1 passed   | 8 passed | PASS   |
| rabbitmq | 1 passed   | 9 passed | PASS   |

## Status

PASS (pending `Connectable` export in `@noddde/core`)

The code changes are complete and correct. Full type-check green is gated on the parallel core change.
