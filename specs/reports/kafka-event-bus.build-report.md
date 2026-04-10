# Build Report: KafkaEventBus (distributed systems fixes — round 2)

**Spec**: `specs/adapters/kafka/kafka-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — all 17 tests pass, type check clean, lint clean

---

## Changes Made

### Modified: `packages/adapters/kafka/src/kafka-event-bus.ts`

#### Fix 1: Explicit `commitOffsets()` + `_deliveryCounts` pruning (Requirement 10)

In the `eachMessage` callback inside `connect()`, after `_handleMessage` resolves successfully:

1. `consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }])` is now called explicitly to persist the offset to Kafka.
2. `this._deliveryCounts.delete(offsetKey)` prunes the in-memory counter to prevent unbounded growth.

Previously `autoCommit: false` was set but `commitOffsets()` was never called, meaning offsets were never persisted — every consumer restart would reprocess all messages.

#### Fix 2: `connect()` mutex (Requirement 13)

Added `private _connecting: Promise<void> | null = null`. The `connect()` method now:

- Returns immediately if `_connected === true`.
- Returns the existing in-flight promise if `_connecting != null` (deduplicates concurrent calls without starting a second connection attempt).
- Otherwise creates the connection promise, assigns it to `_connecting`, runs the connection logic, and clears `_connecting` in a `finally` block.

#### Fix 3: `on()` subscribe error handling (Requirement 7)

When `on()` is called after `connect()`, the subscribe call now uses `.catch()` instead of the previous `void` pattern:

- On rejection: logs via `console.error`.
- Removes the topic from `_subscribedTopics` so a future `on()` call can retry.

Previously subscribe errors were silently swallowed (`void this._consumer.subscribe(...)`).

---

### Modified: `packages/adapters/kafka/src/__tests__/kafka-event-bus.test.ts`

- Introduced `makeMockConsumer()` / `makeMockProducer()` factory helpers (shared across all tests) that include `commitOffsets: vi.fn().mockResolvedValue(undefined)` in the consumer mock — required because the implementation now calls `commitOffsets` in `eachMessage`.
- **New test**: "should explicitly commit offsets after handling" — captures the `eachMessage` callback from `consumer.run()`, invokes it with a synthetic message (offset `"42"`), and asserts `commitOffsets` was called with `offset: "43"`.
- **New test**: "should deduplicate concurrent connect() calls" — fires two concurrent `connect()` calls via `Promise.all`, asserts both producer and consumer `.connect()` are each called exactly once.
- **New test**: "should log error and remove topic from subscribed set when subscribe fails after connect" — verifies `console.error` is called and the topic is removed from `_subscribedTopics` when subscribe rejects.

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

Test Files: 1 passed (1)
Tests:      17 passed (17)
```

All 17 tests GREEN.

---

## Type Check Results

### `packages/adapters/kafka` (`npx tsc --noEmit`)

**Clean** — no errors.

---

## Lint Results

### `yarn workspace @noddde/kafka lint`

**Clean** — exit 0, 0 warnings.

---

## Spec Compliance Notes

- **Req 7** — Subscribe errors after `connect()` are now caught, logged, and the topic is removed from `_subscribedTopics` for retry.
- **Req 10** — `commitOffsets()` is called explicitly after handler success; `_deliveryCounts` entry is pruned after commit.
- **Req 13** — Concurrent `connect()` calls are deduplicated via a `_connecting` promise mutex.

---

## Files Modified

- `packages/adapters/kafka/src/kafka-event-bus.ts` — three new distributed-correctness fixes applied
- `packages/adapters/kafka/src/__tests__/kafka-event-bus.test.ts` — shared mock helpers + three new tests (14 → 17 total)
