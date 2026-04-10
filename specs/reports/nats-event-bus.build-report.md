# Build Report: NatsEventBus (Distributed Audit v2 Fixes)

**Spec**: `specs/adapters/nats/nats-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — all 19 tests passing

---

## Changes Made

### Modified: `packages/adapters/nats/src/nats-event-bus.ts`

**Fix 1: try/catch around msg.term(), msg.ack(), msg.nak() (Requirements 7, 8, 9)**

Refactored `_consumeSubscription` to wrap all three NATS message acknowledgment methods in individual try/catch blocks. If the NATS connection drops between message receipt and the ack/nak/term call, the thrown error is silently swallowed and the consumer loop continues to the next message (rather than crashing).

- `msg.term()` on poison message (malformed JSON): wrapped in try/catch — error from dropped connection is caught silently.
- `msg.ack()` after successful handlers: wrapped in try/catch — error from dropped connection is caught silently.
- `msg.nak()` after handler failure: wrapped in try/catch — error from dropped connection is caught silently.

The refactored `_consumeSubscription` now parses JSON into a typed `Event` variable first (for validation), then re-serializes via `JSON.stringify(event)` when calling `_handleMessage`. The double-parse approach is intentional to keep `_handleMessage`'s testable `(eventName: string, messageData: string)` signature unchanged.

**Fix 2: Consumer loop .catch() instead of void (Requirement 15b)**

In `_createSubscriptionForEvent`:

- Replaced `void this._consumeSubscription(sub, eventName)` with `.catch()` that logs the termination error. If the async iterator throws (e.g., connection drop), the error is caught and logged rather than becoming an unhandled promise rejection.
- Also added error logging to the subscription creation catch block (previously silently swallowed).

### Modified: `packages/adapters/nats/src/__tests__/nats-event-bus.test.ts`

Added 4 new test cases (15 existing tests retained unchanged):

1. **`should not crash consumer loop when msg.term() throws (connection dropped)`** — throws from `msg.term()`, verifies `_consumeSubscription` resolves cleanly.
2. **`should not crash consumer loop when msg.nak() throws (connection dropped)`** — throws from `msg.nak()`, verifies `_consumeSubscription` resolves cleanly.
3. **`should not crash consumer loop when msg.ack() throws (connection dropped)`** — throws from `msg.ack()`, verifies `_consumeSubscription` resolves cleanly and handler was still invoked.
4. **`should use .catch() on consumer loop to prevent unhandled promise rejections`** — async iterator that throws, verifies `.catch()` on `_consumeSubscription` catches and logs the error without becoming an unhandled rejection.

---

## Test Results

```
Test Files  1 passed (1)
Tests       19 passed (19)
Duration    247ms
```

All 19 tests GREEN.

---

## TypeScript Check

3 pre-existing type errors remain (not introduced by this change, existed before this PR):

- `AsyncEventHandler` not matching export name in `@noddde/core`
- `BrokerResilience` not exported from `@noddde/core`
- `Connectable` not exported from `@noddde/core`

These are unrelated to the distributed audit fixes.

---

## Requirements Coverage

| Req        | Description                                                        | Status |
| ---------- | ------------------------------------------------------------------ | ------ |
| 7          | Poison message: msg.term() wrapped in try/catch                    | FIXED  |
| 8          | Handler failure: msg.nak() wrapped in try/catch                    | FIXED  |
| 9          | Success: msg.ack() wrapped in try/catch                            | FIXED  |
| 15b        | Consumer loop has .catch() handler (not fire-and-forget with void) | FIXED  |
| All others | Pre-existing requirements                                          | GREEN  |

---

## Files Modified

- `packages/adapters/nats/src/nats-event-bus.ts` — `_consumeSubscription()`, `_createSubscriptionForEvent()`
- `packages/adapters/nats/src/__tests__/nats-event-bus.test.ts` — 4 new test cases added
