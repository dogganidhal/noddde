# Build Report: RabbitMqEventBus (distributed systems fixes - iteration 2)

**Spec**: `specs/adapters/rabbitmq/rabbitmq-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — 21/21 tests passing

---

## Changes Made (this iteration)

Two targeted fixes from the distributed audit (Req 8b and Reqs 9/15).

### Fix 1: Replace x-death with in-memory delivery tracking (Requirement 8b)

**File**: `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`

Added private field:
```ts
private readonly _deliveryCounts: Map<string, number> = new Map();
```

Replaced the `x-death` header approach in `_setupConsumer` with in-memory counting:
- Derives `msgId` from `msg.properties.messageId` (if present) or a 32-character base64 slice of the content.
- Increments `_deliveryCounts` on each delivery.
- If `count > maxRetries`, logs a warning and acks (discards) the message.
- On successful ack, prunes the entry via `this._deliveryCounts.delete(msgId)`.

The `x-death` approach was inoperative because those headers are only populated when a dead-letter exchange (DLX) is configured, which `RabbitMqEventBus` does not configure.

### Fix 2: try/catch around ack/nack calls (Requirements 9, 15)

Wrapped all `channel.ack(msg)` and `channel.nack(msg)` calls in `_setupConsumer` in try/catch blocks. During reconnection the channel becomes stale; throwing on a stale channel would crash the consumer callback.

- `ack` on successful processing: logs error on failure and continues.
- `ack` when discarding (maxRetries exceeded): silently swallows.
- `nack` on handler failure: logs error on failure and continues.

---

## Test Changes

### Updated test
- **"should discard messages exceeding maxRetries delivery count"** renamed to **"should track delivery count in memory and discard after maxRetries"** — completely replaced. Old test injected `x-death` headers. New test invokes the consumer callback multiple times with the same `messageId` to exercise the in-memory counter, verifying:
  - Successful delivery prunes the counter.
  - Handler failures increment the counter without pruning (nack called).
  - After `maxRetries + 1` deliveries, the message is discarded via ack and handler is NOT called.

### New tests added
- **"should not crash when ack throws on stale channel after successful handler"** — `ack` mock throws; verifies consumer callback resolves without throwing.
- **"should not crash when nack throws on stale channel after handler failure"** — `nack` mock throws; verifies consumer callback resolves without throwing.

---

## Test Results

```
Test Files  1 passed (1)
      Tests  21 passed (21)
   Duration  ~190ms
```

## TypeScript Check

3 pre-existing errors remain (missing exports `AsyncEventHandler`, `BrokerResilience`, `Connectable` from `@noddde/core`) — present before this change, out of scope. No new TypeScript errors introduced by this iteration.

---

## Requirements Coverage

| Requirement                              | Status                                      |
| ---------------------------------------- | ------------------------------------------- |
| 1. Exchange routing                      | Covered                                     |
| 2. JSON serialization                    | Covered                                     |
| 3. Persistent messages                   | Covered                                     |
| 3b. Publisher confirms                   | Covered                                     |
| 4. Dispatch before connect throws        | Covered                                     |
| 5. on registers handlers                 | Covered                                     |
| 6. Queue binding                         | Covered                                     |
| 7. Consumer setup                        | Covered                                     |
| 7b. Poison message protection            | Covered                                     |
| 8. Parallel handler invocation           | Covered                                     |
| 8b. maxRetries delivery limit (in-memory)| Covered (new test this iteration)           |
| 9. Manual ack after handlers (try/catch) | Covered (new stale-channel tests)           |
| 10. Prefetch configuration               | Covered                                     |
| 11. connect with retry + confirm channel | Covered                                     |
| 11b. Mid-session reconnection            | Covered                                     |
| 12. connect is idempotent                | Covered                                     |
| 13. close closes channel and connection  | Covered                                     |
| 14. close is idempotent                  | Covered                                     |
| 15. Handler errors cause nack (try/catch)| Covered (new stale-channel tests)           |
| 16. Serialization errors on dispatch     | Covered                                     |
| 17. Connection errors on dispatch        | Covered                                     |
