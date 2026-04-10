# RabbitMqEventBus -- Distributed Systems Design Audit

**Date**: 2026-04-10
**Scope**: `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`, spec, and tests
**Verdict**: **CRITICAL-GAPS** -- Not production-ready for distributed, high-throughput deployments without addressing findings #1-#4.

---

## Summary

The implementation is a clean, well-structured starting point that correctly covers the happy path: connect, publish with persistence, consume with manual ack, parallel handler invocation, prefetch-based backpressure, and idempotent lifecycle. However, it has several critical gaps that would cause data loss or service outages in a production distributed environment. The most severe is the complete absence of mid-session reconnection -- amqplib does not reconnect automatically, so a single transient network partition or broker restart will permanently kill the bus without recovery.

---

## Findings

### #1 -- No mid-session reconnection (CRITICAL)

**Description**: amqplib does not auto-reconnect. If the TCP connection drops (network blip, broker restart, load balancer timeout), the `connection` and `channel` objects become permanently dead. The existing retry logic only applies to the initial `connect()` call. After a successful connect, any connection loss silently kills the bus -- `dispatch()` will throw, consumers stop receiving messages, and no recovery is attempted.

**Impact**: In any production environment, connections will eventually drop. Without reconnection, the service is permanently degraded until manually restarted. This is the single most dangerous gap.

**Evidence**: Lines 112-152 of the implementation show retry logic only inside `connect()`. There are no `connection.on('error')` or `connection.on('close')` handlers registered anywhere.

**Recommended fix**: Register `connection.on('close')` and `connection.on('error')` handlers that trigger a reconnection loop with exponential backoff. On reconnection, re-assert the exchange, re-create the channel, re-set prefetch, and re-establish all consumers from the `_handlers` registry. During reconnection, `dispatch()` should either queue messages or reject with a clear "reconnecting" error. Consider using a library like `amqp-connection-manager` that wraps this pattern, or implement it manually. The NATS adapter handles this correctly via NATS's built-in `reconnect: true` option (line 72 of `nats-event-bus.ts`).

---

### #2 -- Publisher confirms not enabled (CRITICAL)

**Description**: `channel.publish()` in amqplib returns a boolean indicating whether the write buffer is full (backpressure signal), but this is NOT a delivery confirmation. The current code ignores this return value entirely (line 198). Without enabling publisher confirms via `channel.confirmSelect()`, the bus has no way to know if a published message was actually persisted by the broker.

**Impact**: Messages can be silently lost during broker memory pressure, slow disk writes, or partial broker failures. The spec claims "at-least-once delivery" but the publish side provides at-most-once semantics.

**Evidence**: Line 198 -- `this._channel.publish(...)` return value is discarded. No call to `channel.confirmSelect()` anywhere. No `waitForConfirms()` or confirm callback pattern.

**Recommended fix**: Call `await this._channel.confirmSelect()` during `connect()` after creating the channel, and call `await channel.waitForConfirms()` after each `publish()` call in `dispatch()`. Alternatively, use `createConfirmChannel()` instead of `createChannel()` which returns a channel that automatically tracks confirms. This will make `dispatch()` properly async and reject on broker nack.

---

### #3 -- Infinite redelivery loop on persistent handler failures (CRITICAL)

**Description**: When a handler throws, the message is nacked with `requeue: true` (line 272). If the handler failure is deterministic (e.g., deserialization bug, business logic invariant violation, schema mismatch), the message will be redelivered and fail again in an infinite loop. This creates a "poison message" scenario that blocks the queue and consumes resources.

**Impact**: A single poison message will block all subsequent messages in the queue (since prefetch limits unacked messages). In high-throughput systems, this can cascade into a full consumer stall.

**Evidence**: Line 272 -- `this._channel?.nack(msg, false, true)` always requeues. No retry counter, no dead letter exchange, no maximum redelivery limit.

**Recommended fix**: Multiple complementary strategies:

1. Configure queues with a dead-letter exchange (`x-dead-letter-exchange` argument in `assertQueue`). After a configurable number of redeliveries, messages move to the DLX instead of looping forever.
2. Check `msg.fields.redelivered` -- if true, the message has already been redelivered at least once. Consider nacking without requeue after a threshold.
3. Use `msg.properties.headers['x-death']` (populated by RabbitMQ DLX) to track retry count.
4. Add a `maxRetries` config option. If not using DLX, track retries via a custom header incremented on each nack-and-republish cycle.
5. At minimum, add a `deadLetterExchange` config option and pass `{ 'x-dead-letter-exchange': config.deadLetterExchange }` to `assertQueue` arguments.

---

### #4 -- No deserialization error handling (IMPORTANT)

**Description**: In `_handleMessage` (line 243), `JSON.parse(content.toString())` can throw on malformed messages. This error propagates to `_setupConsumer`'s catch block (line 271), which nacks with requeue. A malformed message therefore enters the same infinite redelivery loop as finding #3.

**Impact**: A single corrupted or non-JSON message permanently blocks the queue.

**Evidence**: Line 244 -- `JSON.parse(content.toString()) as Event` has no try/catch. The caller's catch block on line 270 treats all errors identically with nack+requeue.

**Recommended fix**: Wrap `JSON.parse` in a try/catch inside `_handleMessage`. On deserialization failure, either: (a) nack without requeue (`channel.nack(msg, false, false)`) and log the error, or (b) route to a dead-letter exchange. Deserialization errors are always deterministic and should never be retried.

---

### #5 -- `close()` does not drain in-flight messages (IMPORTANT)

**Description**: `close()` immediately sets `_connected = false` and calls `channel.close()`. Any in-flight messages being processed by handlers will have their ack/nack calls fail because the channel is already closed. The NATS adapter correctly uses `nc.drain()` (line 158 of `nats-event-bus.ts`) which waits for in-flight processing before closing.

**Impact**: Graceful shutdown loses in-flight messages. On restart, those messages will be redelivered by RabbitMQ (since they were never acked), which is correct for at-least-once semantics, but the handlers' side effects from the partial processing are not rolled back -- leading to duplicate processing without the handler knowing it was a retry.

**Evidence**: Lines 207-233 -- `close()` clears handlers and closes channel immediately. No cancellation of consumers or waiting for pending message processing.

**Recommended fix**: Before closing the channel, cancel all consumers via `channel.cancel(consumerTag)` for each active consumer (store consumer tags from `channel.consume()` return values). Then wait a brief period for in-flight handler promises to settle. Only then close the channel and connection. Consider adding a configurable `shutdownTimeoutMs`.

---

### #6 -- Prefetch is per-channel, not per-consumer (IMPORTANT)

**Description**: `channel.prefetch(count)` in amqplib applies globally to the channel by default (the second parameter `global` defaults to `false` in amqplib >= 1.0, meaning per-consumer). However, since all consumers share a single channel, if N event types are subscribed, each consumer gets `prefetchCount` unacked messages, meaning total unacked messages can be `N * prefetchCount`. The spec and config documentation suggest this is a global limit, which is misleading.

**Impact**: With many event types, the effective concurrency is higher than expected. If a user sets `prefetchCount: 10` and subscribes to 20 event types, they may have 200 unacked messages in flight.

**Evidence**: Line 128 -- `this._channel.prefetch(this._prefetchCount)` sets per-consumer prefetch. Multiple consumers are then created on lines 264-274 via `_setupConsumer`.

**Recommended fix**: Document that `prefetchCount` is per-event-type (per-consumer), not global. Alternatively, consider using `channel.prefetch(count, true)` for global prefetch if that's the desired semantics. Or use separate channels per consumer for better isolation (though this adds overhead).

---

### #7 -- `_setupConsumer` failure is silently swallowed (IMPORTANT)

**Description**: When `on()` is called after `connect()`, `_setupConsumer` is invoked with `.catch(() => {})` (line 179). If queue assertion or consumer creation fails, the error is silently swallowed. The handler is registered in memory but never receives messages.

**Impact**: Silent data loss -- the handler appears registered but never fires. No logging, no error surfacing.

**Evidence**: Line 179 -- `.catch(() => { /* Consumer setup failure is non-fatal */ })`.

**Recommended fix**: At minimum, log the error. Consider making `on()` async (or returning a Promise) when called after connect so callers can handle failures. Alternatively, emit an error event or store the failure for health check queries.

---

### #8 -- Consumer tags not tracked (IMPORTANT)

**Description**: `channel.consume()` returns a `{ consumerTag }` object, but the consumer tag is never stored. Without consumer tags, there is no way to cancel specific consumers during graceful shutdown, topic unsubscription, or reconnection.

**Impact**: Cannot implement graceful shutdown (finding #5). Cannot cancel consumers during reconnection without closing the entire channel.

**Evidence**: Line 264 -- `await this._channel.consume(...)` return value is not captured.

**Recommended fix**: Store consumer tags in a `Map<string, string>` (eventName -> consumerTag). Use them in `close()` to cancel consumers before closing the channel.

---

### #9 -- `publish()` backpressure return value ignored (IMPORTANT)

**Description**: `channel.publish()` returns `false` when the write buffer is full, signaling that the caller should wait for the `'drain'` event before publishing more. The current code ignores this return value (line 198), which can lead to unbounded memory growth if the publisher outruns the broker.

**Impact**: Under high publish throughput, memory grows without bound until the process crashes.

**Evidence**: Line 198 -- return value of `this._channel.publish(...)` is discarded.

**Recommended fix**: Check the return value. If `false`, await the channel's `'drain'` event before returning from `dispatch()`:

```ts
const ok = this._channel.publish(...);
if (!ok) {
  await new Promise(resolve => this._channel!.once('drain', resolve));
}
```

---

### #10 -- No SSL/TLS configuration (NICE-TO-HAVE)

**Description**: The config accepts a bare `url` string. There is no way to pass TLS options (`amqplib.connect` accepts a second `socketOptions` parameter for TLS).

**Impact**: Cannot connect to production RabbitMQ clusters that require TLS (which is nearly all of them).

**Recommended fix**: Add an optional `socketOptions` or `tls` field to `RabbitMqEventBusConfig` and pass it through to `amqplib.connect()`.

---

### #11 -- No health check / readiness probe support (NICE-TO-HAVE)

**Description**: No way to query whether the bus is healthy (connected, channel open, consumers active).

**Impact**: Kubernetes/ECS health checks cannot determine if the bus is functional. A silently dead connection (finding #1) cannot be detected externally.

**Recommended fix**: Add an `isHealthy(): boolean` or `status(): BusStatus` method that checks connection and channel state.

---

### #12 -- No dead-letter exchange configuration (NICE-TO-HAVE)

**Description**: Queues are asserted without dead-letter arguments. There is no way to configure DLX, message TTL, or max-length policies.

**Impact**: Cannot handle poison messages (finding #3), cannot expire stale messages, cannot bound queue size.

**Recommended fix**: Add optional `deadLetterExchange`, `messageTtl`, and `maxLength` to config. Pass as queue arguments to `assertQueue`.

---

### #13 -- No metrics or observability hooks (NICE-TO-HAVE)

**Description**: No event counters, latency tracking, error rate metrics, or hook points for external observability systems.

**Impact**: Cannot monitor throughput, latency, error rates, or consumer lag in production dashboards.

**Recommended fix**: Add optional `onPublish`, `onConsume`, `onAck`, `onNack`, `onError` callback hooks or integrate with a metrics interface.

---

### #14 -- No configurable serializer/deserializer (NICE-TO-HAVE)

**Description**: JSON is hardcoded as the serialization format. No way to use Protocol Buffers, Avro, MessagePack, or other formats.

**Impact**: Performance-sensitive systems may need more efficient serialization. Multi-language systems may need schema-based serialization.

**Recommended fix**: Accept an optional `serializer: { serialize(event): Buffer; deserialize(buf: Buffer): Event }` in config.

---

## Test Coverage Assessment

The test suite covers the happy path adequately but has significant gaps for a distributed system:

**Covered**: dispatch routing, persistence flag, pre-connect errors, handler invocation, parallel handler execution, handler failure propagation, prefetch config, close lifecycle, idempotent close, JSON serialization.

**Not covered**:

- **Connection loss mid-operation** -- No tests for what happens when the channel or connection dies during dispatch or consume.
- **Reconnection behavior** -- No tests because reconnection is not implemented.
- **`nack` actually being called** -- The handler failure tests only verify that `_handleMessage` rejects. They don't test that `_setupConsumer`'s catch block actually calls `nack(msg, false, true)` on the channel mock. The nack behavior is only tested implicitly.
- **Deserialization errors** -- No test for malformed JSON messages.
- **`publish()` returning false** -- No test for backpressure scenario.
- **Consumer setup failure after connect** -- No test for `_setupConsumer` being called from `on()` after connect and failing.
- **Concurrent connect calls** -- No test for race conditions if `connect()` is called concurrently.
- **The retry backoff actually works** -- The retry test only checks config storage, not that retries with correct delays actually happen.

---

## Comparison with Sibling Adapters

| Concern                 | RabbitMQ                 | Kafka (kafkajs)                             | NATS                             |
| ----------------------- | ------------------------ | ------------------------------------------- | -------------------------------- |
| Mid-session reconnect   | Not implemented          | Built into kafkajs                          | Built-in `reconnect: true`       |
| Publisher confirms      | Not enabled              | `producer.send()` awaits acks               | JetStream `publish()` awaits ack |
| Poison message handling | Infinite requeue loop    | Consumer doesn't commit offset (same issue) | No ack (same issue)              |
| Graceful shutdown       | Channel.close() (abrupt) | consumer.disconnect()                       | nc.drain() (correct)             |
| Backpressure (publish)  | Return value ignored     | `producer.send()` is async                  | JetStream publish is async       |

All three adapters share the poison message problem (#3). NATS has the best lifecycle management. Kafka has the best reconnection story. RabbitMQ has the worst position on reconnection because amqplib uniquely requires manual reconnection logic.

---

## Priority Order for Remediation

1. **#1 Mid-session reconnection** -- Without this, the adapter is unusable in production. Single highest-impact fix.
2. **#2 Publisher confirms** -- Without this, "at-least-once" claim is false on the publish side.
3. **#3 Poison message / DLX** -- Without this, a single bad message takes down a consumer permanently.
4. **#4 Deserialization error handling** -- Subset of #3 but easier to fix independently.
5. **#5 Graceful shutdown / drain** -- Important for zero-downtime deployments.
6. **#8 Consumer tag tracking** -- Required for #5.
7. **#9 Publish backpressure** -- Important for high-throughput scenarios.
8. **#7 Silent consumer setup failure** -- Causes hard-to-debug data loss.
9. **#6 Prefetch documentation** -- Prevents misconfiguration.
10. **#10-#14** -- Nice-to-have improvements, not blocking for a v1 release.
