# Build Report: RabbitMqEventBus (distributed systems fixes)

**Spec**: `specs/adapters/rabbitmq/rabbitmq-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — 19/19 tests passing

---

## Changes Made (this iteration)

Four distributed systems fixes implementing Requirements 3b, 7b, 8b, and 11b.

### Fix 1: Publisher Confirms (Requirements 3b, 11)

In `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`:

- Changed `_channel` type from `Channel` to `ConfirmChannel` (from `amqplib`)
- Changed `connect()` to call `connection.createConfirmChannel()` instead of `connection.createChannel()`
- In `dispatch()`, added `await this._channel.waitForConfirms()` after `channel.publish()`
- Updated imports: replaced `Channel` with `ConfirmChannel`

### Fix 2: Mid-Session Reconnection (Requirement 11b)

- Added `_reconnecting: boolean` flag to prevent concurrent reconnection attempts
- Extracted connection logic into private `_connectWithRetry()` method (shared between `connect()` and reconnection)
- After establishing a connection, registers `this._connection.on('error', ...)` and `this._connection.on('close', ...)` handlers
- On unexpected close (when `this._closed` is false), calls `_handleUnexpectedClose()` which:
  - Sets `this._connected = false` (causing `dispatch()` to throw during reconnection)
  - Sets `this._reconnecting = true` to prevent concurrent attempts
  - Calls `_connectWithRetry()` using the same resilience backoff configuration
  - On success: logs reconnect success; on failure: logs error
  - Resets `this._reconnecting = false` in `finally`

### Fix 3: Deserialization Poison Protection (Requirement 7b)

- `_handleMessage()` now wraps `JSON.parse()` in try/catch
- On parse failure: logs a warning and returns `{ poisoned: true }` instead of throwing
- Returns `{ poisoned: boolean }` to allow callers to distinguish poison vs. handler errors
- In `_setupConsumer`, after calling `_handleMessage`, always calls `channel.ack(msg)` (both for successful processing and poison messages)
- Only calls `channel.nack(msg, false, true)` when the handler itself throws (non-deserialization errors)

### Fix 4: maxRetries Delivery Limit (Requirement 8b)

- In `_setupConsumer`, reads `this._config.resilience?.maxRetries`
- On each message receipt, checks `msg.properties.headers?.['x-death']` (standard RabbitMQ dead-letter header)
- Sums all `count` fields across `x-death` entries to get total delivery attempts
- If delivery count exceeds `maxRetries`, logs a warning, acks the message, and returns early (discards it)
- Uses ack (not nack) to prevent the discarded message from re-entering the queue

---

## Test Results

```
Test Files  1 passed (1)
      Tests  19 passed (19)
   Duration  208ms
```

### New Tests Added

- `should use createConfirmChannel instead of createChannel` — verifies `createConfirmChannel` is called and `createChannel` is NOT called
- `should call waitForConfirms after publish in dispatch` — verifies `waitForConfirms` is called and its call order is after `publish`
- `should ack and skip poison messages that fail deserialization` — verifies `_handleMessage` returns `{ poisoned: true }` and does not invoke handlers
- `should register error and close handlers on connection after connect` — verifies `connection.on('error', ...)` and `connection.on('close', ...)` are registered
- `should set _connected=false and attempt reconnect on unexpected close` — verifies `_connected` is set to false when close event fires unexpectedly
- `should discard messages exceeding maxRetries delivery count` — verifies messages with `x-death` count > `maxRetries` are acked without invoking handlers
- `should ack poison messages in _setupConsumer consumer` — verifies deserialization failures in the consumer callback result in ack (not nack)

## TypeScript

```
cd packages/adapters/rabbitmq && npx tsc --noEmit
(no output — clean)
```

---

## Requirements Coverage

| Requirement                              | Status                                      |
| ---------------------------------------- | ------------------------------------------- |
| 1. Exchange routing                      | Covered (existing test)                     |
| 2. JSON serialization                    | Covered (existing test)                     |
| 3. Persistent messages                   | Covered (existing test)                     |
| 3b. Publisher confirms                   | Covered (new test)                          |
| 4. Dispatch before connect throws        | Covered (existing test)                     |
| 5. on registers handlers                 | Covered (existing test)                     |
| 6. Queue binding                         | Covered (existing test)                     |
| 7. Consumer setup                        | Covered (existing test)                     |
| 7b. Poison message protection            | Covered (new tests)                         |
| 8. Parallel handler invocation           | Covered (existing test)                     |
| 8b. maxRetries delivery limit            | Covered (new test)                          |
| 9. Manual ack after handlers             | Covered (new test for \_setupConsumer)      |
| 10. Prefetch configuration               | Covered (existing test)                     |
| 11. connect with retry + confirm channel | Covered (new test for createConfirmChannel) |
| 11b. Mid-session reconnection            | Covered (new tests)                         |
| 12. connect is idempotent                | Covered (existing behavior)                 |
| 13. close closes channel and connection  | Covered (existing test)                     |
| 14. close is idempotent                  | Covered (existing test)                     |
| 15. Handler errors cause nack            | Covered (existing test)                     |
| 16. Serialization errors on dispatch     | Covered (via JSON invariant)                |
| 17. Connection errors on dispatch        | Covered (dispatch-before-connect test)      |
