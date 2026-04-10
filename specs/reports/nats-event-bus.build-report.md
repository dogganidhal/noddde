# Build Report: NatsEventBus

**Spec**: `specs/adapters/nats/nats-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — all 15 tests passing, TypeScript clean

---

## Changes Made

### Modified: `packages/adapters/nats/src/nats-event-bus.ts`

**Fix 1 & Fix 3: Proper error handling in `_consumeSubscription` (Requirements 7, 8)**

Replaced the single silent `catch {}` block with two separate try/catch blocks:

1. **Poison message protection** — `JSON.parse()` is wrapped in its own try/catch. On parse failure: logs the error and calls `msg.term()` to permanently discard the malformed message, then `continue`s to the next message.
2. **Handler failure handling** — `_handleMessage` is wrapped in a second try/catch. On handler rejection: logs the error with event name, and calls `msg.nak()` for immediate redelivery instead of silently not-acking.

`_handleMessage` signature kept as `(eventName: string, messageData: string)` for test compatibility; `_consumeSubscription` validates JSON before forwarding the string.

**Fix 2: `maxDeliver` configuration (Requirement 10b)**

In `_createSubscriptionForEvent()`, after setting `maxAckPending`, added:

```ts
const maxRetries = this._config.resilience?.maxRetries;
if (maxRetries !== undefined) {
  opts.maxDeliver(maxRetries);
}
```

`BrokerResilience.maxRetries` was already present in `@noddde/core` — no core changes needed.

### Modified: `packages/adapters/nats/src/__tests__/nats-event-bus.test.ts`

Added 4 new test cases (11 existing tests retained unchanged):

1. **`should set maxDeliver on consumer options when resilience.maxRetries is configured`** — Verifies `opts.maxDeliver(5)` is called when `resilience: { maxRetries: 5 }` is set.
2. **`should term a poison message (malformed JSON) and continue`** — Verifies `msg.term()` is called and handler is NOT invoked for malformed JSON.
3. **`should nak message when handler throws and not ack`** — Verifies `msg.nak()` is called and `msg.ack()` is NOT called when a handler throws.
4. **`should ack message when all handlers succeed`** — Verifies `msg.ack()` is called and `msg.nak()` is NOT called on successful handler execution.

---

## Test Results

```
Test Files  1 passed (1)
Tests       15 passed (15)
Duration    217ms
```

All tests GREEN. `npx tsc --noEmit` exits with 0 errors.

---

## Requirements Coverage

| Req | Description                                                 | Test                                                                                 |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Subject derivation from event name                          | "should publish event to subject derived from event name"                            |
| 2   | JSON serialization of full event                            | "should serialize the full event object including metadata"                          |
| 3   | JetStream publish with ack                                  | covered by dispatch tests using mock JetStream                                       |
| 4   | Dispatch before connect throws                              | "should throw when dispatching before connect"                                       |
| 5   | on registers handlers by event name                         | "should invoke registered handler when event is consumed"                            |
| 7   | Poison message protection via `msg.term()`                  | "should term a poison message (malformed JSON) and continue"                         |
| 8   | Handler failure → `msg.nak()` for immediate redelivery      | "should nak message when handler throws and not ack"                                 |
| 9   | Ack after all handlers succeed                              | "should ack message when all handlers succeed"                                       |
| 10  | `prefetchCount` → `maxAckPending` on consumer (default 256) | "should configure prefetchCount as maxAckPending on JetStream consumer options"      |
| 10b | `resilience.maxRetries` → `maxDeliver` on consumer          | "should set maxDeliver on consumer options when resilience.maxRetries is configured" |
| 11  | `resilience` config mapped to NATS reconnection options     | "should map BrokerResilience to nats reconnection options"                           |
| 12  | `connect()` is idempotent                                   | covered by `_connected` guard in connect()                                           |
| 13  | `close()` drains and clears handlers                        | "should drain connection and clear handlers on close"                                |
| 14  | `close()` is idempotent                                     | "should not throw when close is called multiple times"                               |

---

## Files Modified

- `packages/adapters/nats/src/nats-event-bus.ts` — `_consumeSubscription()`, `_createSubscriptionForEvent()`
- `packages/adapters/nats/src/__tests__/nats-event-bus.test.ts` — added 4 new test cases
