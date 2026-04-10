# NatsEventBus Distributed Systems Audit

**Date**: 2026-04-10
**Scope**: `packages/adapters/nats/src/nats-event-bus.ts`, spec, and tests
**NATS client version**: nats.js v2.29.3 (legacy JetStream API via `consumerOpts`)

## Verdict: NEEDS-WORK

The implementation correctly captures the basic shape of a JetStream-backed event bus and satisfies the spec's behavioral requirements. However, it has several gaps that would cause problems under real distributed load, particularly around error visibility, poison message handling, the fire-and-forget consumer loop, and missing `msg.nak()` calls. None of the issues are architectural dead-ends -- they are all fixable without redesigning the adapter.

---

## Findings

### F1. Silent error swallowing in `_consumeSubscription` catch block

**Severity**: CRITICAL

```ts
// Line 224-229
try {
  await this._handleMessage(eventName, messageData);
  msg.ack();
} catch {
  // Do not ack -- NATS will redeliver based on consumer config
}
```

The empty `catch {}` discards all error information. In production, this means:

- Handler failures are invisible. No log, no metric, no event. Operators cannot distinguish between "no events arriving" and "every event failing."
- Deserialization errors (malformed JSON) are silently swallowed on every redelivery, creating an infinite silent retry loop.
- There is no way to diagnose _why_ a consumer is stuck without attaching a debugger.

**Recommended fix**: At minimum, emit the error somewhere observable. Options:

1. Accept an optional `onError` callback in `NatsEventBusConfig`.
2. Call `msg.nak()` explicitly (with a delay) instead of relying on implicit ack timeout, which is much slower.
3. Log the error. Even `console.error` is better than silence for a production adapter.

Separately, deserialization errors (bad JSON) should be distinguished from handler errors. A deserialization failure will _never_ succeed on retry and will loop forever. These should be `msg.term()` (terminal ack, discard the message) or `msg.ack()` with an error log, not silently retried.

---

### F2. No `msg.nak()` -- relies on ack timeout for redelivery

**Severity**: CRITICAL

When a handler throws, the code simply does not call `msg.ack()`. This means NATS must wait for the **ack timeout** (default: 30 seconds) before redelivering. In a high-throughput system, this introduces massive redelivery latency for every transient failure.

The NATS JetStream API provides `msg.nak()` (negative acknowledgment) which triggers immediate redelivery, and `msg.nak(delayMs)` for delayed redelivery. Neither is used.

**Recommended fix**: Replace the empty catch with:

```ts
catch (error) {
  msg.nak();
  // or msg.nak(1000) for a 1-second backoff
}
```

For deserialization errors, use `msg.term()` to permanently discard the poison message.

---

### F3. No `maxDeliver` -- poison messages retry forever

**Severity**: CRITICAL

The consumer is created with no `maxDeliver` option. A message that consistently fails (e.g., a handler bug triggered by a specific payload, or malformed JSON) will be redelivered indefinitely. In production, this creates:

- A "stuck consumer" that spends all its time retrying the same message.
- If ordering matters (JetStream delivers in order within a consumer), _all subsequent messages for that consumer are blocked_ behind the poison message.

The spec does not mention `maxDeliver`, but this is a production necessity.

**Recommended fix**: Add a `maxDeliver` config option (default: 5-10) to `NatsEventBusConfig`, and pass it to the consumer options. When max deliveries are exhausted, NATS moves the message to the advisory stream or discards it (depending on stream config).

---

### F4. Fire-and-forget `_consumeSubscription` with `void`

**Severity**: IMPORTANT

```ts
// Line 211
void this._consumeSubscription(sub, eventName);
```

And in `on()` (line 117):

```ts
void this._createSubscriptionForEvent(eventName);
```

If the `for await` loop in `_consumeSubscription` throws an unrecoverable error (e.g., the subscription is terminated by the server), the promise rejection is silently discarded by the `void` operator. This is an unhandled rejection in Node.js, which can crash the process in newer Node versions or silently kill the consumer loop.

The same pattern in `_createSubscriptionForEvent` silently swallows subscription creation failures:

```ts
try {
  const sub = await this._js.subscribe(subject, opts);
  void this._consumeSubscription(sub, eventName);
} catch {
  // Subscription creation failed -- caller should handle reconnect logic
}
```

This means: if subscription creation fails after `connect()` (e.g., calling `on()` on a live bus), the handler is registered but the consumer never starts. The caller has no way to know.

**Recommended fix**:

1. Store the promise from `_consumeSubscription` and attach a `.catch()` handler that invokes an error callback or restarts the subscription.
2. For `_createSubscriptionForEvent` in the `on()` path, either throw or invoke an error callback so the caller knows the subscription failed.

---

### F5. Stream creation race condition (TOCTOU)

**Severity**: IMPORTANT

```ts
// Lines 83-92
try {
  await jsm.streams.info(this._config.streamName);
} catch {
  const subjects = this._buildSubjectsForStream();
  await jsm.streams.add({ name: this._config.streamName, subjects });
}
```

Two instances of the bus calling `connect()` simultaneously will both see the stream as missing (the `info()` call throws) and both attempt `streams.add()`. One will succeed and the other will fail with "stream already exists."

In practice, NATS JetStream `streams.add()` with identical config is idempotent when using the `update` API (`addOrUpdate`). But the current code does not handle the second add failing. The outer catch in `connect()` does not exist -- this error propagates to the caller.

**Recommended fix**: Use `streams.add()` unconditionally with the desired config. JetStream's `streams.add()` returns the existing stream if the configuration matches. Alternatively, catch the "stream already exists" error explicitly after the failed add.

---

### F6. Wildcard subject `${prefix}>` is too broad

**Severity**: IMPORTANT

```ts
private _buildSubjectsForStream(): string[] {
  const prefix = this._config.subjectPrefix ?? "";
  return [`${prefix}>`];
}
```

When `subjectPrefix` is empty (the default), this becomes just `>`, which captures **all subjects on the NATS server**. This will match system subjects, advisory subjects, and any other application's subjects. If multiple applications share a NATS cluster, this is a data isolation failure.

Even with a prefix like `"noddde."`, the `>` wildcard captures all sub-hierarchies, which may include subjects from other domains or services using the same prefix.

**Recommended fix**:

1. Require `streamName` and `subjectPrefix` to always be set together (or derive one from the other).
2. When prefix is empty, use a more restrictive pattern or require the user to provide explicit subjects.
3. At minimum, validate that `subjectPrefix` is non-empty when `streamName` is configured.

---

### F7. No stream retention/limits configuration

**Severity**: IMPORTANT

```ts
await jsm.streams.add({
  name: this._config.streamName,
  subjects,
});
```

The stream is created with NATS defaults:

- `retention`: LimitsPolicy (keep messages until limits are hit)
- `max_bytes`: -1 (unlimited)
- `max_age`: 0 (no expiration)
- `max_msgs`: -1 (unlimited)

In production, without retention limits, the stream grows unboundedly and will eventually exhaust disk. This is a common production incident with JetStream.

**Recommended fix**: Add optional stream configuration to `NatsEventBusConfig`:

```ts
streamConfig?: {
  maxAge?: number;  // nanoseconds
  maxBytes?: number;
  maxMsgs?: number;
  retention?: 'limits' | 'interest' | 'workqueue';
}
```

With sensible defaults (e.g., `maxAge: 7 days`, `maxBytes: 1GB`).

---

### F8. `for await` loop processes messages sequentially within a subscription

**Severity**: IMPORTANT

```ts
for await (const msg of sub) {
  // ... await handler ... then ack
}
```

The `for await` loop processes one message at a time per subscription. Even though `maxAckPending` is set to 256, the consumer only processes one message at a time because the loop `await`s the handler before pulling the next message from the iterator.

This means:

- Effective throughput is limited to one message per handler-execution-time per event type.
- The `prefetchCount`/`maxAckPending` config provides backpressure but not parallelism -- NATS will deliver up to 256 messages, but they queue up in the client's buffer.

The spec says handlers are invoked via `Promise.all` (for multiple handlers of the same event), but the _messages themselves_ are processed serially.

**Recommended fix**: This is a design decision, not necessarily a bug. Sequential processing preserves message ordering per consumer, which is often desirable. But the spec and config documentation should make this explicit. If parallel message processing is desired, a worker pool pattern around the iterator would be needed.

---

### F9. `close()` sets `_connected = false` before `drain()`

**Severity**: IMPORTANT

```ts
async close(): Promise<void> {
  if (this._closed) return;
  this._closed = true;
  this._connected = false;  // <-- Set before drain
  // ...
  await nc.drain();  // <-- This processes in-flight messages
}
```

Setting `_connected = false` before `drain()` means that if any in-flight handler calls `dispatch()` during drain (e.g., a saga reaction), it will fail with "not connected" even though the connection is still technically alive and processing messages.

The RabbitMQ adapter has the same issue. The Kafka adapter also sets `_connected = false` before `disconnect()`.

**Recommended fix**: Call `drain()` first, then set `_connected = false`. Drain waits for all in-flight messages to be processed, so the bus should remain usable during that window.

---

### F10. Duplicate consumer creation for same event name

**Severity**: IMPORTANT

There is no tracking of which event names already have active subscriptions. If `on()` is called twice for the same event name after `connect()`:

```ts
bus.on("AccountCreated", handler1); // creates subscription
bus.on("AccountCreated", handler2); // creates ANOTHER subscription
```

Each call to `on()` after `connect()` calls `_createSubscriptionForEvent(eventName)`, which creates a new durable consumer subscription for the same subject with the same durable name. In NATS JetStream, creating a durable consumer with the same name either returns the existing one or fails depending on config compatibility. But `_consumeSubscription` is called again, potentially creating duplicate message processing loops.

The Kafka adapter avoids this with `_subscribedTopics: Set<string>`.

**Recommended fix**: Track active subscriptions in a `Set<string>` and skip `_createSubscriptionForEvent` if a subscription for that event name already exists.

---

### F11. Durable name sanitization is lossy and may collide

**Severity**: NICE-TO-HAVE

```ts
const durableName = eventName.replace(/[^a-zA-Z0-9_-]/g, "_");
```

Event names like `order.created` and `order_created` both map to `order_created`, causing consumer name collisions. This silently merges two logically distinct consumers.

**Recommended fix**: Use a more collision-resistant sanitization, such as including a hash suffix when characters are replaced, or using a different separator strategy.

---

### F12. No health check / readiness probe support

**Severity**: NICE-TO-HAVE

There is no way for an orchestrator (Kubernetes, etc.) to check if the bus is healthy. The `_connected` flag is private. A distributed system needs a way to signal readiness to infrastructure.

**Recommended fix**: Expose a `isHealthy(): boolean` or `status(): { connected: boolean; subscriptions: number }` method.

---

### F13. No observability hooks

**Severity**: NICE-TO-HAVE

No metrics, no tracing spans, no event hooks for monitoring. In production, operators need:

- Messages dispatched/consumed per second
- Handler latency distribution
- Error rates per event type
- Redelivery count

**Recommended fix**: Accept an optional `hooks` or `metrics` object in the config for instrumenting dispatch, consume, ack, nak, and error events.

---

### F14. No TLS/authentication configuration

**Severity**: NICE-TO-HAVE

The `connect()` call passes only `servers` and reconnection options to the NATS client. NATS supports TLS, token auth, NKey auth, and user/password auth. None of these are configurable.

**Recommended fix**: Accept a `connectionOptions` passthrough or specific auth fields in the config.

---

### F15. Legacy JetStream API usage

**Severity**: NICE-TO-HAVE

The code uses `consumerOpts()` and `js.subscribe()`, which are the legacy JetStream API from nats.js v2.x. While still functional in v2.29.3, the NATS team has introduced a simplified JetStream API (`jetstream.consumers.get()`, `consumer.consume()`) that is the recommended path forward. The legacy API may be deprecated or removed in nats.js v3.x.

**Recommended fix**: Consider migrating to the new API when nats.js v3 compatibility is needed. Not urgent.

---

## Test Coverage Assessment

The tests are **unit tests against mocked internals** -- they verify the adapter's internal wiring but do not test any distributed behavior. Specific gaps:

| Gap                                                                            | Severity     |
| ------------------------------------------------------------------------------ | ------------ |
| No test for `_consumeSubscription` loop (the actual consumer path is untested) | CRITICAL     |
| No test for deserialization failure (malformed JSON from NATS)                 | CRITICAL     |
| No test for `on()` called after `connect()` creating a subscription            | IMPORTANT    |
| No test for duplicate `on()` calls for the same event name                     | IMPORTANT    |
| No test verifying `msg.ack()` is called after handler success                  | IMPORTANT    |
| No test verifying message is NOT acked after handler failure                   | IMPORTANT    |
| No test for stream creation logic in `connect()`                               | IMPORTANT    |
| No test for `close()` during in-flight message processing                      | NICE-TO-HAVE |
| No integration test with a real NATS server (e.g., via testcontainers)         | NICE-TO-HAVE |

The tests rely heavily on `(bus as any)._handleMessage()` to bypass the consumer loop entirely. While this tests handler dispatch, it means the entire message-receive-ack-nak lifecycle is untested. The most critical production path -- receive message from NATS, deserialize, run handlers, ack/nak -- has zero test coverage.

---

## Priority Summary

| #   | Finding                                           | Severity     | Effort             |
| --- | ------------------------------------------------- | ------------ | ------------------ |
| F1  | Silent error swallowing in catch block            | CRITICAL     | Low                |
| F2  | No `msg.nak()` -- slow redelivery via ack timeout | CRITICAL     | Low                |
| F3  | No `maxDeliver` -- poison messages retry forever  | CRITICAL     | Low                |
| F4  | Fire-and-forget consumer loop with `void`         | IMPORTANT    | Medium             |
| F5  | Stream creation TOCTOU race                       | IMPORTANT    | Low                |
| F6  | Wildcard subject too broad                        | IMPORTANT    | Low                |
| F7  | No stream retention/limits config                 | IMPORTANT    | Medium             |
| F8  | Sequential message processing despite prefetch    | IMPORTANT    | Spec clarification |
| F9  | `_connected = false` before `drain()`             | IMPORTANT    | Low                |
| F10 | Duplicate consumer creation for same event        | IMPORTANT    | Low                |
| F11 | Durable name collisions                           | NICE-TO-HAVE | Low                |
| F12 | No health check support                           | NICE-TO-HAVE | Low                |
| F13 | No observability hooks                            | NICE-TO-HAVE | Medium             |
| F14 | No TLS/auth configuration                         | NICE-TO-HAVE | Medium             |
| F15 | Legacy JetStream API                              | NICE-TO-HAVE | High               |

**Recommended triage**: Fix F1-F3 immediately (all are low-effort, high-impact). Fix F4, F5, F6, F9, F10 in the next iteration. The rest can be addressed as the adapter matures toward production use.
