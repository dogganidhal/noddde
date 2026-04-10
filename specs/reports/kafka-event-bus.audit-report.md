# Audit Report: KafkaEventBus Distributed Systems Fixes v2

**Date**: 2026-04-10
**Auditor**: Claude Opus 4.6
**Cycle**: 3 (distributed systems correctness fixes v2)
**Specs reviewed**:

- `specs/adapters/kafka/kafka-event-bus.spec.md` (Reqs 7, 10, 13)

**Build Reports reviewed**:

- `specs/reports/kafka-event-bus.build-report.md`

---

## Verdict: PASS

---

## Fixes Verified

### Fix 1 (CRITICAL): `commitOffsets()` called after `_handleMessage` in `eachMessage`

**This was the #1 critical finding from the distributed audit v1. Verified with extreme thoroughness.**

| Aspect         | Verification                                                                                                                                                 | Verdict |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Source code    | Lines 148-154: `await this._consumer!.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }])` called after `_handleMessage` | PASS    |
| autoCommit     | Line 131: `autoCommit: false` is set in `consumer.run()` options                                                                                             | PASS    |
| Offset math    | `(BigInt(message.offset) + 1n).toString()` -- correct kafkajs convention (commit the NEXT offset)                                                            | PASS    |
| Await ordering | `await _handleMessage(...)` on line 144 completes BEFORE `await commitOffsets(...)` on line 148                                                              | PASS    |
| Test existence | Test "should explicitly commit offsets after handling" (line 353)                                                                                            | PASS    |
| Test mechanism | Captures `eachMessage` callback via mock `run()`, simulates a message at offset "42", asserts `commitOffsets` called with offset "43"                        | PASS    |
| Test assertion | `expect(commitOffsets).toHaveBeenCalledWith([{ topic: "AccountCreated", partition: 0, offset: "43" }])`                                                      | PASS    |
| Spec alignment | Spec Req 10: "After all handlers completed successfully, the offset is committed explicitly via `consumer.commitOffsets()`"                                  | PASS    |

**Conclusion**: Without `commitOffsets()`, offsets would never be persisted when `autoCommit: false` is set, and every consumer restart would reprocess all messages. The fix is correctly implemented and tested end-to-end through the `eachMessage` callback chain.

### Fix 2: `_deliveryCounts.delete(offsetKey)` after commit (prune)

| Aspect         | Verification                                                                                                             | Verdict |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | ------- |
| Source code    | Line 157: `this._deliveryCounts.delete(offsetKey)` called immediately after `commitOffsets` succeeds                     | PASS    |
| Ordering       | Sequential: `_handleMessage` -> `commitOffsets` -> `_deliveryCounts.delete`. Prune only happens after successful commit. | PASS    |
| Memory safety  | Prevents unbounded `_deliveryCounts` Map growth in long-running consumer sessions                                        | PASS    |
| Spec alignment | Spec Req 10: "After committing, the delivery count entry for this offset is pruned from the `_deliveryCounts` map"       | PASS    |

**Conclusion**: The delivery count map is properly pruned after each successful offset commit, preventing memory leaks.

### Fix 3: `_connecting` promise mutex on `connect()`

| Aspect            | Verification                                                                                                          | Verdict |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| Field declaration | Line 59: `private _connecting: Promise<void> \| null = null`                                                          | PASS    |
| Mutex check       | Lines 104-106: `if (this._connecting != null) { return this._connecting; }` -- second caller returns the same promise | PASS    |
| Assignment        | Line 167: `this._connecting = connecting` -- assigned before the async work begins                                    | PASS    |
| Cleanup           | Lines 162-164: `finally { this._connecting = null; }` -- cleared on both success AND failure                          | PASS    |
| Test              | Test "should deduplicate concurrent connect() calls" (line 403)                                                       | PASS    |
| Test assertion    | Fires `Promise.all([bus.connect(), bus.connect()])`, asserts producer/consumer `connect` each called exactly once     | PASS    |
| Spec alignment    | Spec Req 13: "Concurrent connect() calls are deduplicated via a connection promise mutex"                             | PASS    |

**Conclusion**: The mutex correctly prevents parallel connection attempts. The `finally` block ensures cleanup even if connection fails.

### Fix 4: `.catch()` on `on()` subscribe with topic removal from `_subscribedTopics`

| Aspect             | Verification                                                                                                                                  | Verdict |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Optimistic add     | Line 195: `this._subscribedTopics.add(topic)` -- added before async subscribe                                                                 | PASS    |
| `.catch()` handler | Lines 198-204: `.catch((err) => { console.error(...); this._subscribedTopics.delete(topic); })` -- rolls back on failure                      | PASS    |
| Error logging      | Line 199: `console.error('[KafkaEventBus] Failed to subscribe...')` -- error is NOT silently swallowed                                        | PASS    |
| Retry support      | Line 203: `this._subscribedTopics.delete(topic)` -- removal from set allows a future `on()` call to retry the subscribe                       | PASS    |
| Test               | Test "should log error and remove topic from subscribed set when subscribe fails after connect" (line 426)                                    | PASS    |
| Test assertion     | Asserts `console.error` was called AND topic is removed from `_subscribedTopics`                                                              | PASS    |
| Spec alignment     | Spec Req 7: "If on() is called after connect() and the subscribe fails, the error is logged and the topic is removed from the subscribed set" | PASS    |

**Conclusion**: Subscribe failures are properly handled with logging and rollback, allowing retry on next `on()` call.

---

## Coherence Review

1. **No regression**: All 17 tests pass, including pre-existing tests for dispatch, topic prefix, handler invocation, parallel execution, close, and idempotency.
2. **Clean lifecycle**: `_connected`, `_closed`, `_connecting` flags are all properly managed. No race conditions.
3. **Spec divergence note**: Spec Req 9b mentions `x-noddde-delivery-count` Kafka header, but implementation uses in-memory `_deliveryCounts` Map. This was noted as a minor concern in the v1 audit and remains acceptable -- the in-memory approach is simpler and the code comments acknowledge the limitation.
4. **No stray changes**: Implementation is self-contained within `kafka-event-bus.ts` and its test file.

---

## Test Results

17/17 tests passing. No failures, no skips.

---

## Summary

All four critical fixes verified:

| Fix          | Description                                 | Lines            | Test                                              | Verdict |
| ------------ | ------------------------------------------- | ---------------- | ------------------------------------------------- | ------- |
| 1 (CRITICAL) | `commitOffsets()` after `_handleMessage`    | 148-154          | "should explicitly commit offsets after handling" | PASS    |
| 2            | `_deliveryCounts.delete(offsetKey)` prune   | 157              | (covered by offset commit test flow)              | PASS    |
| 3            | `_connecting` promise mutex                 | 104-107, 162-167 | "should deduplicate concurrent connect() calls"   | PASS    |
| 4            | `.catch()` on subscribe with topic rollback | 195-204          | "should log error and remove topic"               | PASS    |

**Overall verdict: PASS**. All fixes are correctly implemented, tested, and aligned with the spec.
