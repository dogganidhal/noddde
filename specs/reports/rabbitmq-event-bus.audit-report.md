# Audit Report: RabbitMQ Event Bus — Distributed Systems Fixes

**Spec**: `specs/adapters/rabbitmq/rabbitmq-event-bus.spec.md`
**Source**: `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`
**Tests**: `packages/adapters/rabbitmq/src/__tests__/rabbitmq-event-bus.test.ts`
**Auditor**: Claude Opus 4.6
**Date**: 2026-04-10
**Verdict**: **PASS**

---

## Fix 1: Publisher Confirms (Req 3b, 11)

**Spec requirement**: `dispatch()` must use a confirm channel (`createConfirmChannel()`) and await `waitForConfirms()` after publishing.

**Source verification**:

- Line 8: Channel type is `ConfirmChannel` (from amqplib).
- Line 154: `this._connection.createConfirmChannel()` is used (not `createChannel()`).
- Lines 260-263: `dispatch()` calls `this._channel.publish(...)` followed by `await this._channel.waitForConfirms()`.

**Test verification**:

- Test "should use createConfirmChannel instead of createChannel" (line 248): Asserts `createConfirmChannel` was called and `createChannel` was NOT called.
- Test "should call waitForConfirms after publish in dispatch" (line 274): Asserts `waitForConfirms` is called after `publish`, verified via `invocationCallOrder`.

**Result**: PASS. The implementation correctly uses confirm channels and awaits publisher confirmation.

---

## Fix 2: Mid-Session Reconnection (Req 11b)

**Spec requirement**: Register `connection.on('error')` and `connection.on('close')` handlers. On unexpected disconnection, automatically reconnect with resilience backoff.

**Source verification**:

- Lines 145-152: Inside `_connectWithRetry()`, `connection.on('error')` and `connection.on('close')` are registered. The `close` handler triggers `_handleUnexpectedClose()` when `!this._closed`.
- Lines 189-213: `_handleUnexpectedClose()` sets `_connected = false`, `_reconnecting = true`, then calls `_connectWithRetry()` which uses the same exponential backoff logic.
- Lines 191-192: Guard against concurrent reconnection attempts (`if (this._reconnecting) return`).

**Test verification**:

- Test "should register error and close handlers on connection after connect" (line 312): Verifies `connection.on('error')` and `connection.on('close')` are registered.
- Test "should set \_connected=false and attempt reconnect on unexpected close" (line 343): Simulates unexpected close, verifies `_connected` is set to false.

**Result**: PASS. Reconnection logic is correctly implemented with proper guard against re-entrant calls.

---

## Fix 3: Deserialization Protection (Req 7b)

**Spec requirement**: `JSON.parse` must be in try/catch. Poison messages must be acked (skipped), not nacked.

**Source verification**:

- Lines 315-323: `_handleMessage()` wraps `JSON.parse` in try/catch. On deserialization failure, logs a warning and returns `{ poisoned: true }`.
- Lines 372-378: In `_setupConsumer()`, the consumer calls `_handleMessage()`, checks the result. On success or poison message, calls `channel.ack(msg)`. Only on handler rejection does it call `channel.nack(msg, false, true)`.

**Test verification**:

- Test "should ack and skip poison messages that fail deserialization" (line 297): Passes invalid JSON, verifies `{ poisoned: true }` is returned and handler is NOT invoked.
- Test "should ack poison messages in \_setupConsumer consumer" (line 422): Exercises the full `_setupConsumer` consumer callback with invalid JSON, verifies `ack` is called and `nack` is NOT called.

**Result**: PASS. Poison messages are correctly handled without blocking the queue.

---

## Fix 4: maxRetries Delivery Limit (Req 8b)

**Spec requirement**: When `resilience.maxRetries` is configured, check delivery count against the limit. Messages exceeding the limit are acked and discarded.

**Source verification**:

- Lines 345-369: In `_setupConsumer()`, `maxRetries` is read from config. If defined, the `x-death` header count is aggregated. If the total delivery count exceeds `maxRetries`, a warning is logged, the message is acked, and the consumer returns without invoking handlers.

**Test verification**:

- Test "should discard messages exceeding maxRetries delivery count" (line 377): Configures `maxRetries: 2`, sends a message with `x-death` count totaling 3. Verifies the message is acked and the handler is NOT invoked.

**Result**: PASS. Delivery limit enforcement is correctly implemented.

---

## Mechanical Checks

| Check                               | Result                      |
| ----------------------------------- | --------------------------- |
| `npx vitest run --reporter=verbose` | PASS -- 19/19 tests green   |
| `npx tsc --noEmit`                  | PASS -- clean (zero errors) |

## Documentation

Updated `docs/content/docs/running/event-bus-adapters.mdx` RabbitMQ "How It Works" section:

- Added publisher confirms mention (confirm channel + `waitForConfirms()`)
- Added poison message protection bullet
- Expanded connection resilience bullet with mid-session reconnection details

---

## Summary

All 4 distributed systems fixes are correctly implemented, match the spec requirements, and have corresponding test coverage. No spec violations, no missing behaviors. The implementation is clean and well-documented with JSDoc.
