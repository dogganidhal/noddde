# Audit Report: NatsEventBus Distributed Systems Fixes

**Date**: 2026-04-10
**Auditor**: Claude Opus 4.6
**Cycle**: 2 (distributed systems correctness fixes)
**Specs reviewed**:

- `specs/adapters/nats/nats-event-bus.spec.md` (Reqs 7, 8, 10b)

**Build Reports reviewed**:

- `specs/reports/nats-event-bus.build-report.md`

---

## Verdict: PASS

---

## Phase A: Validation

### A1: Mechanical Checks

| Check      | Result | Details                                                          |
| ---------- | ------ | ---------------------------------------------------------------- |
| Type check | PASS   | `npx tsc --noEmit` -- 0 errors                                   |
| Tests      | PASS   | 15/15 tests passed (including 4 new tests for distributed fixes) |
| Stub check | PASS   | No stubs or TODO placeholders                                    |

### A2: Fix #1 -- No Empty catch {}, Proper Error Handling in \_consumeSubscription (Reqs 7, 8)

**Previous state**: `_consumeSubscription` had an empty `catch {}` block that silently swallowed all errors, preventing both poison message detection and handler error recovery.

**Current state** (lines 223-253 of `nats-event-bus.ts`):

| Aspect                           | Verification                                                                                                                                                                               | Verdict |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Deserialization protection       | Lines 231-239: `JSON.parse(messageData)` in try/catch. On failure: `console.error(...)` with event name and error, then `msg.term()`, then `continue`                                      | PASS    |
| `msg.term()` for poison messages | Line 238: `msg.term()` permanently discards malformed messages. NATS will not redeliver a terminated message.                                                                              | PASS    |
| Handler error handling           | Lines 241-249: `await this._handleMessage(eventName, messageData)` in try/catch. On failure: `console.error(...)` with event name and error, then `msg.nak()`                              | PASS    |
| `msg.nak()` for handler errors   | Line 249: `msg.nak()` requests immediate redelivery from NATS. This is the correct response for transient handler failures.                                                                | PASS    |
| `msg.ack()` on success           | Line 243: `msg.ack()` called only after `_handleMessage` resolves successfully                                                                                                             | PASS    |
| Test: poison message term        | Lines 224-249 of test file: creates malformed JSON message, asserts `mockTerm` called, `mockAck` not called, handler not called                                                            | PASS    |
| Test: handler error nak          | Lines 251-276 of test file: creates valid message with throwing handler, asserts `mockNak` called, `mockAck` not called                                                                    | PASS    |
| Test: success ack                | Lines 278-303 of test file: creates valid message with successful handler, asserts `mockAck` called, `mockNak` not called, handler called with correct event                               | PASS    |
| Spec alignment (Req 7)           | Spec: "Deserialization is wrapped in try/catch. If JSON.parse throws, the error is logged and the message is terminated (msg.term()) to permanently discard it." -- implementation matches | PASS    |
| Spec alignment (Req 8)           | Spec: "If any handler rejects, the message is explicitly nacked (msg.nak()) for immediate redelivery" -- implementation matches                                                            | PASS    |

**Conclusion**: The empty `catch {}` has been replaced with two distinct error handling paths: `msg.term()` for deserialization failures (permanent discard) and `msg.nak()` for handler failures (immediate redelivery). Both paths log the error before taking action. Fix verified and tested.

### A3: Fix #2 -- maxDeliver on Consumer Options (Req 10b)

| Aspect                 | Verification                                                                                                                                                             | Verdict |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Source code            | Lines 210-213 of `nats-event-bus.ts`: `const maxRetries = this._config.resilience?.maxRetries; if (maxRetries !== undefined) { opts.maxDeliver(maxRetries); }`           | PASS    |
| Conditional activation | Only sets `maxDeliver` when `resilience.maxRetries` is configured. When not configured, NATS uses its default (unlimited redelivery) -- backward-compatible.             | PASS    |
| Test                   | Lines 185-222 of test file: spies on `consumerOpts` to intercept the mock, configures `resilience: { maxRetries: 5 }`, asserts `mockOpts.maxDeliver` was called with `5` | PASS    |
| Spec alignment         | Spec Req 10b: "If resilience.maxRetries is configured, set maxDeliver on the JetStream consumer options" -- implementation matches                                       | PASS    |

**Conclusion**: The `maxDeliver` JetStream consumer option is correctly set from `resilience.maxRetries`. This is the NATS-native approach to limiting delivery attempts -- NATS JetStream handles the tracking server-side, which is superior to client-side tracking. Fix verified and tested.

### A4: Fix #3 -- Error Logging in Consumer Loop

| Aspect                    | Verification                                                                                                                           | Verdict |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Deserialization error log | Lines 233-236: `console.error('[NatsEventBus] Failed to parse message for event "${eventName}". Discarding poison message.', err)`     | PASS    |
| Handler error log         | Lines 246-249: `console.error('[NatsEventBus] Handler error for event "${eventName}". Requesting redelivery.', err)`                   | PASS    |
| Log output verified       | Test stderr output shows both log messages during test execution -- confirms `console.error` is actually called                        | PASS    |
| Log content quality       | Both messages include: adapter name prefix, event name context, action taken (discarding vs redelivery), and the original error object | PASS    |

**Conclusion**: Error logging is present, informative, and tested (visible in test output). Both deserialization and handler errors are logged with sufficient context for debugging.

### A5: Coherence Review

1. **No regression**: Pre-existing tests (dispatch, subject prefix, handler invocation, parallel, close, idempotent, serialization) all continue to pass. **PASS.**

2. **`_handleMessage` still propagates errors**: The semi-public `_handleMessage` method (used directly by tests) still throws on handler errors -- this is correct. The `_consumeSubscription` wrapper is what catches those errors and calls `msg.nak()`. Tests for `_handleMessage` correctly verify the throw behavior, while `_consumeSubscription` tests verify the nak behavior. Clean separation. **PASS.**

3. **Double parse concern**: `_consumeSubscription` calls `JSON.parse(messageData)` (line 232) to validate, then `_handleMessage` calls `JSON.parse(messageData)` again (line 174). This means valid messages are parsed twice. However, this is a minor performance concern, not a correctness issue. The alternative (passing the parsed object through) would require changing `_handleMessage` signature and all its tests. Acceptable trade-off. **PASS (minor inefficiency noted).**

4. **No stray changes**: Implementation is self-contained within `nats-event-bus.ts` and its test file. No unrelated files modified. **PASS.**

---

## Phase B: Documentation

Documentation updates for `event-bus-adapters.mdx` included in combined docs update (Resilience section added with poison message protection and maxRetries/maxDeliver details for NATS).

---

## Summary

All three distributed systems fixes are verified:

1. **No empty catch, proper error handling** -- `_consumeSubscription` now has two distinct try/catch blocks: `msg.term()` for poison messages (permanent discard) and `msg.nak()` for handler errors (redelivery). Both paths log errors. Tested with three new tests covering term/nak/ack scenarios.
2. **maxDeliver from maxRetries** -- `opts.maxDeliver(maxRetries)` set on JetStream consumer options when configured. Tested with spy on `consumerOpts`. This leverages NATS-native server-side delivery tracking.
3. **Error logging** -- Both error paths use `console.error` with event name, action description, and error object. Confirmed in test output.

Overall verdict: **PASS**. No blocking issues. Minor note: valid messages are JSON-parsed twice (once in `_consumeSubscription` for validation, once in `_handleMessage` for handler dispatch) -- acceptable trade-off for clean separation of concerns.
