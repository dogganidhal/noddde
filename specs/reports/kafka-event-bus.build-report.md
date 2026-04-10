# Build Report: KafkaEventBus (distributed systems fixes)

**Spec**: `specs/adapters/kafka/kafka-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — all 14 tests pass, type check clean

---

## Changes Made

### Modified: `packages/adapters/kafka/src/kafka-event-bus.ts`

#### Fix 1: autoCommit disabled (Requirement 10)

`consumer.run()` now passes `autoCommit: false` as the first option. Without this, kafkajs auto-commits on a timer regardless of handler success, breaking at-least-once delivery guarantees.

#### Fix 2: close() calls consumer.stop() first (Requirement 14)

`close()` now calls `await this._consumer.stop()` before `await this._consumer.disconnect()`. This gives in-flight `eachMessage` callbacks time to complete before the connection is torn down, preventing unhandled promise rejections.

#### Fix 3: Deserialization poison message protection (Requirement 8)

`_handleMessage()` wraps `JSON.parse()` in a `try/catch`. On parse failure, a warning is logged via `console.warn` and the method returns `undefined` (resolves without throwing). This allows the consumer to commit the offset and move past the malformed message. Poison messages no longer block the partition.

#### Fix 4: maxRetries delivery limit (Requirement 9b)

Added an in-memory `Map<string, number>` (`_deliveryCounts`) keyed by `topic:partition:offset` string. Each time `_handleMessage` is called with an `offsetKey` (set by the `eachMessage` callback in `connect()`), the count is incremented. If the count exceeds `resilience.maxRetries`, a warning is logged and the method returns early (message skipped).

**Known limitation**: The delivery counter is in-memory only and resets on consumer restart. For durable dead-letter tracking across restarts, a persistent store or Kafka header propagation on the producer side would be needed. This limitation is documented in the JSDoc.

#### TypeScript fix

`partition` in the `eachMessage` callback is on the `EachMessagePayload` object, not on `KafkaMessage`. Destructured correctly as `{ topic, partition, message }`.

### Modified: `packages/adapters/kafka/src/__tests__/kafka-event-bus.test.ts`

Three new tests added:

1. **`should pass autoCommit: false to consumer.run()`** — Spies on the `run` mock and asserts the call includes `{ autoCommit: false }`.
2. **`should call consumer.stop() before consumer.disconnect() on close`** — Tracks call order via a `callOrder` array, asserts `["stop", "disconnect"]`.
3. **`should skip poison messages without throwing on deserialization failure`** — Calls `_handleMessage` with `{invalid json`, asserts the promise resolves (not rejects) and the handler is never called.

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

Test Files: 1 passed (1)
Tests:      14 passed (14)
```

All 14 tests GREEN.

---

## Type Check Results

### `packages/adapters/kafka` (`npx tsc --noEmit`)

**Clean** — no errors.

---

## Spec Compliance Notes

- **Req 8** — Poison message protection implemented via try/catch around `JSON.parse`. Malformed messages are skipped, not retried.
- **Req 9b** — maxRetries delivery limit implemented via in-memory `_deliveryCounts` map keyed by `topic:partition:offset`. Limitation: counter resets on consumer restart.
- **Req 10** — `autoCommit: false` explicitly passed to `consumer.run()`.
- **Req 14** — `consumer.stop()` called before `consumer.disconnect()` in `close()`.

---

## Files Modified

- `packages/adapters/kafka/src/kafka-event-bus.ts` — four distributed systems fixes applied
- `packages/adapters/kafka/src/__tests__/kafka-event-bus.test.ts` — three new tests added (11 → 14 total)
