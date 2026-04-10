---
spec: specs/adapters/kafka/kafka-event-bus.spec.md
source: packages/adapters/kafka/src/kafka-event-bus.ts
tests: packages/adapters/kafka/src/__tests__/kafka-event-bus.test.ts
builder: sonnet
date: 2026-04-10
status: GREEN
---

# Build Report: KafkaEventBus (partition key strategy + framework logger)

**Spec**: `specs/adapters/kafka/kafka-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — all 21 tests pass, type check clean, lint clean

---

## Changes Made

### Modified: `packages/adapters/kafka/src/kafka-event-bus.ts`

#### Fix 1: Configurable partition key strategy (Requirement 3)

- Added `partitionKeyStrategy?: "aggregateId" | ((event: Event) => string | null)` to `KafkaEventBusConfig`.
- Added `private _resolvePartitionKey(event: Event): string | null` method:
  - Default strategy `"aggregateId"`: reads `event.metadata?.aggregateId`, stringifies via `String()`, falls back to `null`.
  - Custom function: called with the full event, returns key or `null`.
- Updated `dispatch()` to call `this._resolvePartitionKey(event)` instead of `event.metadata?.correlationId`.
- Added `eslint-disable-next-line no-unused-vars` on the `partitionKeyStrategy` field to suppress a false positive from `eslint:recommended` that incorrectly flags named callback parameters in TypeScript interface type positions.

This is a behavior change from the previous implementation: the old default was `correlationId`; the new default is `aggregateId`.

#### Fix 2: Framework logger (Requirement 19)

- Added `Logger` to the `@noddde/core` import.
- Added `NodddeLogger` import from `@noddde/engine`.
- Added `logger?: Logger` to `KafkaEventBusConfig`.
- Added `private readonly _logger: Logger` field initialized from `config.logger ?? new NodddeLogger("warn", "noddde:kafka")`.
- Replaced all `console.error(...)` calls with `this._logger.error(message, { structuredData })`.
- Replaced all `console.warn(...)` calls with `this._logger.warn(message, { structuredData })`.
- Zero `console.*` calls remain in the implementation.

### Modified: `packages/adapters/kafka/package.json`

- Added `"@noddde/engine": "0.0.0"` to `dependencies` (required for `NodddeLogger` import).

### Modified: `packages/adapters/kafka/vitest.config.mts`

- Added `"@noddde/engine"` alias pointing to `../../engine/src/index.ts` (mirrors NATS adapter pattern).

### Modified: `packages/adapters/kafka/src/__tests__/kafka-event-bus.test.ts`

**Updated existing test**: `"should log error and remove topic from subscribed set when subscribe fails after connect"` — changed from `vi.spyOn(console, "error")` to injecting a mock logger via `config.logger`. The implementation now routes errors through the framework logger, so `console.error` is never called. Test intent (error is logged, topic removed) is unchanged.

**4 new tests added**:

- `"should use aggregateId as message key by default"` — dispatches with `metadata.aggregateId: "order-123"`, asserts sent key is `"order-123"`.
- `"should use null key when event has no aggregateId"` — dispatches without metadata, asserts sent key is `null`.
- `"should use custom function for partition key when provided"` — configures `partitionKeyStrategy: (event) => \`custom-${event.name}\``, asserts sent key is `"custom-OrderPlaced"`.
- `"should use provided logger for warn logging with structured data"` — injects mock logger, triggers deserialization failure via `_handleMessage`, asserts `mockLogger.warn` was called with a message containing `"deserialize"` and data `{ eventName: "TestEvent" }`.

---

## Test Results

```
✓ should publish event to topic derived from event name
✓ should prepend topicPrefix to event name for topic
✓ should throw when dispatching before connect
✓ should invoke registered handler when event is consumed
✓ should invoke all handlers concurrently via Promise.all
✓ should reject if any handler throws during parallel invocation
✓ should map BrokerResilience to kafkajs retry configuration
✓ should configure consumer with sessionTimeout and heartbeatInterval
✓ should disconnect and clear handlers on close
✓ should not throw when close is called multiple times
✓ should pass autoCommit: false to consumer.run()
✓ should call consumer.stop() before consumer.disconnect() on close
✓ should skip poison messages without throwing on deserialization failure
✓ should serialize the full event object including metadata
✓ should explicitly commit offsets after handling
✓ should deduplicate concurrent connect() calls
✓ should log error and remove topic from subscribed set when subscribe fails after connect
✓ should use aggregateId as message key by default
✓ should use null key when event has no aggregateId
✓ should use custom function for partition key when provided
✓ should use provided logger for warn logging with structured data

Test Files: 1 passed (1)
Tests:      21 passed (21)
```

All 21 tests GREEN.

---

## Type Check Results

### `packages/adapters/kafka` (`npx tsc --noEmit`)

**Clean** — no errors.

---

## Lint Results

### `packages/adapters/kafka` (`npx eslint . --max-warnings 0`)

**Clean** — exit 0, 0 warnings.

---

## Spec Compliance Notes

- **Req 3** — Message key is now derived from `partitionKeyStrategy` config (default `"aggregateId"`). Custom function support implemented via `_resolvePartitionKey`.
- **Req 19** — All logging goes through the `Logger` interface. No `console.*` calls remain. Structured data is passed as the second argument on every log call.

---

## Files Modified

- `packages/adapters/kafka/src/kafka-event-bus.ts`
- `packages/adapters/kafka/src/__tests__/kafka-event-bus.test.ts`
- `packages/adapters/kafka/package.json`
- `packages/adapters/kafka/vitest.config.mts`
