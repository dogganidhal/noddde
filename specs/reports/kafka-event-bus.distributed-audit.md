# KafkaEventBus Distributed Systems Audit

**Date**: 2026-04-10
**Verdict**: **CRITICAL-GAPS**
**Summary**: The current implementation is a reasonable starting scaffold but has several correctness bugs and missing production concerns that make it unsafe for real traffic. The most severe issue is that the offset commit model is broken -- the spec promises manual commit-after-handler-success, but the code relies on kafkajs autoCommit defaults, meaning offsets can be committed before or independent of handler completion.

---

## CRITICAL Findings

### C1. AutoCommit is not disabled -- at-least-once delivery is broken

**Severity**: CRITICAL
**Location**: `kafka-event-bus.ts` line 110, `consumer.run()` call

The spec (Requirement 10) states: "The consumer commits the offset only after all handlers for a message have completed successfully." However, `consumer.run()` is called without `autoCommit: false`. In kafkajs, `autoCommit` defaults to `true` with `autoCommitInterval: 5000` and `autoCommitThreshold: null`. This means offsets are committed on a timer, completely independent of handler completion.

If a handler throws, the offset may already have been auto-committed, and the message will NOT be redelivered. This silently violates the at-least-once guarantee that the entire spec is built around.

**Fix**: Pass `autoCommit: false` to `consumer.run()`, and after `_handleMessage` resolves successfully, call `heartbeat()` and explicitly resolve the offset. Alternatively, keep `eachMessage` and rely on kafkajs's behavior where `eachMessage` auto-commits only after the callback resolves -- but this requires explicit `autoCommit: true` with `eachMessage` understanding. The safest path: set `autoCommit: false` and manually commit via `consumer.commitOffsets()` after handler success, or use `eachBatch` with `resolveOffset()`.

**Impact**: Without this fix, events WILL be lost in production when handlers fail.

---

### C2. `close()` does not call `consumer.stop()` before `consumer.disconnect()`

**Severity**: CRITICAL
**Location**: `kafka-event-bus.ts` lines 198-200

kafkajs requires calling `consumer.stop()` before `consumer.disconnect()` to allow in-flight `eachMessage` callbacks to complete. Calling `disconnect()` directly while messages are being processed can cause: (a) unhandled promise rejections from in-flight handlers, (b) offsets for partially-processed messages being committed or lost depending on timing, (c) the disconnect hanging or throwing.

**Fix**: Change `close()` to call `await this._consumer.stop()` before `await this._consumer.disconnect()`. The mock objects in tests already have a `stop` method, so tests will pass.

---

### C3. `on()` after `connect()` fire-and-forgets the subscribe promise

**Severity**: CRITICAL
**Location**: `kafka-event-bus.ts` line 153

```ts
void this._consumer.subscribe({ topic, fromBeginning: false });
```

The `void` keyword discards the promise. If `subscribe()` fails (e.g., topic doesn't exist and auto-creation is disabled, or broker is temporarily unreachable), the error is silently swallowed. The caller of `on()` has no way to know that subscription failed. Messages for that event name will never arrive, with no error reported.

Additionally, kafkajs documents that `subscribe()` must be called BEFORE `run()`. Calling it after `run()` is not officially supported and may not work reliably across kafkajs versions. The comment in the code says "kafkajs supports calling subscribe after run()" but this is not guaranteed behavior.

**Fix**: Either (a) make `on()` async and await the subscribe, or (b) queue topic subscriptions and provide a `resubscribe()` mechanism, or (c) document that all `on()` calls must happen before `connect()` and throw if called after.

---

### C4. `_handleMessage` deserialization errors crash the consumer

**Severity**: CRITICAL
**Location**: `kafka-event-bus.ts` line 229

```ts
const event = JSON.parse(rawValue) as Event;
```

If a message contains malformed JSON (corrupt message, schema evolution issue, producer bug), `JSON.parse` throws a `SyntaxError`. This error propagates up through `eachMessage`, which causes the consumer to stop processing. Because autoCommit is enabled (see C1), the offset may or may not have been committed. If not committed, the consumer will retry this message forever on restart -- a poison pill that blocks the entire partition.

**Fix**: Wrap `JSON.parse` in a try/catch. Log the deserialization error and either: (a) skip the message (acknowledge the offset to avoid poison pill), or (b) route to a dead-letter topic. The choice should be configurable.

---

## IMPORTANT Findings

### I1. `connect()` is not truly idempotent -- race condition on concurrent calls

**Severity**: IMPORTANT
**Location**: `kafka-event-bus.ts` lines 86-126

The idempotency guard checks `this._connected`, but `_connected` is only set to `true` at line 125, AFTER all the async work completes. If two callers invoke `connect()` simultaneously, both will pass the `if (this._connected)` check and proceed to create two producers and two consumers, connecting each. This creates resource leaks and duplicate message delivery.

**Fix**: Use a connection promise/mutex pattern:

```ts
private _connectPromise: Promise<void> | null = null;

async connect(): Promise<void> {
  if (this._connected) return;
  if (this._connectPromise) return this._connectPromise;
  this._connectPromise = this._doConnect();
  return this._connectPromise;
}
```

---

### I2. Parallel handler invocation (`Promise.all`) breaks partition ordering

**Severity**: IMPORTANT
**Location**: `kafka-event-bus.ts` line 232, spec Requirement 9

The spec explicitly states handlers run via `Promise.all()` for concurrency. However, the spec header also promises "partition-level ordering." These two claims are in tension.

Within a single message, yes, all handlers see the same event. But the `eachMessage` callback processes one message at a time per partition (kafkajs default). So ordering between messages within a partition IS preserved as long as `eachMessage` awaits all handlers before returning. This is currently the case, so partition-level ordering IS maintained for the happy path.

However, if a handler throws (causing redelivery), the ordering guarantee becomes weaker because: (a) successfully-completed handlers in the same `Promise.all` batch already executed side effects, (b) on redelivery, ALL handlers re-execute, meaning some handlers see the event twice while later events haven't been processed yet. The spec acknowledges this ("consumers must be idempotent") but does not acknowledge the ordering implications.

**Fix**: Document that the ordering guarantee is "at-least-once, in-order delivery to each handler assuming idempotent handlers." Consider offering a `sequential: true` mode that processes handlers one-by-one (matching EventEmitterEventBus behavior) for cases where ordering strictness matters more than throughput.

---

### I3. No dead-letter / poison-message strategy

**Severity**: IMPORTANT
**Location**: Entire implementation

The spec and implementation have exactly one error path: handler throws -> offset not committed -> infinite redelivery. There is no circuit breaker, no retry limit, no dead-letter topic routing. A single permanently-failing handler (e.g., schema incompatibility, downstream service permanently removed) will block its partition forever.

**Fix**: Add a configurable `maxRetries` per message (tracked via message headers or an in-memory retry counter keyed by topic+partition+offset). After exhausting retries, either: (a) publish to a DLT (dead letter topic), (b) skip and log, or (c) invoke a user-provided error callback.

---

### I4. No graceful shutdown / drain semantics

**Severity**: IMPORTANT
**Location**: `close()` method

There is no way to signal "stop accepting new messages but finish processing in-flight ones." The `close()` method immediately sets `_closed = true` and disconnects. If called while a handler is mid-execution, the handler may fail because downstream resources (other buses, persistence) may already be closed.

**Fix**: Implement a `drain()` or two-phase shutdown: (1) stop the consumer (no new messages), (2) await in-flight handler completion, (3) disconnect. The `consumer.stop()` call from C2 partially addresses this, but the `_closed` flag should only be set after stop completes.

---

### I5. `acks` not explicitly set on producer `send()`

**Severity**: IMPORTANT
**Location**: `kafka-event-bus.ts` line 174

The producer `send()` does not specify `acks`. kafkajs defaults to `acks: -1` (all ISR replicas), which is correct for at-least-once. However, this should be explicit in the code to make the guarantee visible and prevent accidental changes. The spec says "dispatch awaits the producer send() and resolves when Kafka acknowledges receipt" but doesn't specify the ack level.

**Fix**: Explicitly pass `acks: -1` in the producer send call, and document it in the spec.

---

### I6. No `consumer.stop()` on close -- duplicate of C2 but also an ordering issue

**Severity**: IMPORTANT (already CRITICAL as C2, but has additional implications)

Beyond the in-flight handler issue (C2), not calling `stop()` means `disconnect()` may hang waiting for the consumer to finish its internal loop, or it may force-kill it. This can cause the consumer group to not properly leave, triggering a full rebalance for remaining group members with the session timeout delay (30s by default).

---

## NICE-TO-HAVE Findings

### N1. No health check / readiness probe

**Severity**: NICE-TO-HAVE

Production Kafka consumers need a way to report their health to orchestrators (Kubernetes liveness/readiness). The implementation exposes no `isHealthy()` or `isReady()` method. kafkajs emits events (`consumer.group_join`, `consumer.crash`, etc.) that could feed a health check.

---

### N2. No metrics / observability hooks

**Severity**: NICE-TO-HAVE

No hooks for: messages dispatched (count, latency), messages consumed (count, latency per handler), consumer lag, handler errors, rebalance events. Without these, debugging production issues is guesswork.

---

### N3. No configurable serializer/deserializer

**Severity**: NICE-TO-HAVE

The implementation hardcodes `JSON.stringify` / `JSON.parse`. Production systems often need: Avro/Protobuf with schema registry, custom envelope formats, compression. A `serializer`/`deserializer` option in `KafkaEventBusConfig` would make this extensible.

---

### N4. No SSL/SASL authentication configuration

**Severity**: NICE-TO-HAVE

`KafkaEventBusConfig` only accepts `brokers` and `clientId`. Real Kafka clusters require SSL and/or SASL (SCRAM, GSSAPI, OAUTHBEARER). The kafkajs `Kafka` constructor accepts `ssl` and `sasl` options that are not exposed.

**Fix**: Add `ssl?: tls.ConnectionOptions | boolean` and `sasl?: SASLOptions` to `KafkaEventBusConfig`, pass through to the Kafka constructor.

---

### N5. No topic auto-creation configuration

**Severity**: NICE-TO-HAVE

The implementation assumes topics exist. If `allowAutoTopicCreation` is disabled on the broker (common in production), dispatching to a non-existent topic will fail. Consider: (a) an `ensureTopics` config option that creates topics via the admin client on connect, or (b) documenting that topics must be pre-created.

---

### N6. No consumer group rebalance strategy configuration

**Severity**: NICE-TO-HAVE

kafkajs supports `partitionAssigners` (roundRobin, range, cooperativeSticky). The implementation uses the default (roundRobin). For production systems processing stateful projections, cooperative-sticky assignment reduces partition churn during rebalances.

---

### N7. `message.key` is set to `null` instead of `undefined` when no correlationId

**Severity**: NICE-TO-HAVE
**Location**: `kafka-event-bus.ts` line 179

```ts
key: key ?? null,
```

The `key` variable is already `undefined` when there's no correlationId (line 172). Then `undefined ?? null` evaluates to `null`. Passing `null` as the key is subtly different from `undefined` in kafkajs -- `null` may be serialized differently. This is unlikely to cause issues but is imprecise.

---

## Test Coverage Assessment

### Current tests cover:

- Happy-path dispatch to correct topic
- Topic prefix
- Dispatch before connect throws
- Handler invocation on consume
- Parallel handler execution
- Handler failure rejection
- Resilience config mapping
- Session timeout / heartbeat config
- Close disconnects and clears handlers
- Close idempotency
- Full event serialization

### Missing test scenarios (for distributed system correctness):

- **No test verifies autoCommit is disabled** -- The most important invariant (offset committed only after handler success) is completely untested. The test for "parallel handler failure prevents offset commit" only tests that `_handleMessage` rejects; it does not verify that offsets are NOT committed at the kafkajs level.
- **No test for deserialization failure** -- What happens when `_handleMessage` receives malformed JSON?
- **No test for `on()` after `connect()`** -- The fire-and-forget subscribe path is untested.
- **No test for concurrent `connect()` calls** -- Race condition is untested.
- **No test for `close()` during in-flight processing** -- Shutdown safety is untested.
- **No test verifying `consumer.stop()` is called before `disconnect()`** -- Because it isn't called.
- **No test for messages with no registered handler** -- The spec says "acknowledged with no processing" but this is not tested.
- **No integration or contract test** -- All tests use mocks injected via `(bus as any)._kafka`. There is no test that validates the mock matches the real kafkajs API shape. A mock-contract drift could mask real bugs.

---

## Priority Summary

| #     | Severity     | Finding                                                   | Effort    |
| ----- | ------------ | --------------------------------------------------------- | --------- |
| C1    | CRITICAL     | AutoCommit not disabled -- events will be lost            | Low       |
| C2    | CRITICAL     | `close()` missing `consumer.stop()` -- unclean shutdown   | Low       |
| C3    | CRITICAL     | `on()` after connect fire-and-forgets subscribe errors    | Medium    |
| C4    | CRITICAL     | JSON.parse poison pill crashes consumer                   | Low       |
| I1    | IMPORTANT    | `connect()` race condition on concurrent calls            | Low       |
| I2    | IMPORTANT    | Ordering semantics under-specified with parallel handlers | Low (doc) |
| I3    | IMPORTANT    | No dead-letter / poison message strategy                  | Medium    |
| I4    | IMPORTANT    | No graceful drain on shutdown                             | Medium    |
| I5    | IMPORTANT    | Producer `acks` not explicit                              | Low       |
| N1-N7 | NICE-TO-HAVE | Observability, auth, serialization, etc.                  | Varies    |

**Recommendation**: Fix C1-C4 and I1 before any production deployment. These are correctness bugs, not missing features. I3 and I4 should follow shortly after, as they determine behavior under real failure conditions. The NICE-TO-HAVE items are genuine production concerns but can be addressed incrementally.
