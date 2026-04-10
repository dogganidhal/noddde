# Engine Distributed Systems Audit

**Date**: 2026-04-10
**Scope**: Event dispatch patterns, atomicity, ordering, error handling, shutdown, and multi-process fitness
**Files reviewed**: `domain.ts`, `command-lifecycle-executor.ts`, `saga-executor.ts`, `event-bus.ts`, `ee-event-bus.ts`, `outbox-relay.ts`, `unit-of-work.ts`, `kafka-event-bus.ts`, `nats-event-bus.ts`, `rabbitmq-event-bus.ts`

---

## Verdict: NEEDS-WORK

The engine has a solid architectural foundation. The transactional outbox pattern is present and correctly integrated. The shutdown drain mechanism is well-designed. However, several issues would cause data loss, ordering violations, or correctness problems in a distributed, broker-backed deployment. None are show-stoppers that require a full rewrite, but they must be addressed before production use with message brokers.

---

## Findings

### 1. Parallel event dispatch breaks ordering within a single command

**Severity: CRITICAL**

Events produced by a single command execution are dispatched in parallel via `Promise.all(events.map(e => eventBus.dispatch(e)))`. This pattern appears in three locations:

- `command-lifecycle-executor.ts` line 166
- `saga-executor.ts` line 160
- `domain.ts` `withUnitOfWork()` line 1332

For event-sourced aggregates, a single command can produce multiple events in a specific order (e.g., `OrderCreated` then `OrderItemAdded`). With the in-memory `EventEmitterEventBus`, ordering is preserved because `dispatch()` awaits handlers sequentially. But with broker-backed buses (Kafka, NATS, RabbitMQ), `Promise.all` launches N independent network writes concurrently. The broker makes no guarantee about arrival order for messages published concurrently to the same topic/subject.

For Kafka specifically, even though messages to the same partition arrive in order, `Promise.all` does not guarantee that the producer `send()` calls complete in array order. A network hiccup on event 1's publish could cause event 2 to arrive at the partition before event 1.

**Recommended fix**: Replace `Promise.all(events.map(...))` with sequential dispatch:

```ts
for (const event of events) {
  await eventBus.dispatch(event);
}
```

Or, better yet, add a `dispatchBatch(events: Event[]): Promise<void>` method to the `EventBus` interface. Broker-backed implementations can use native batch send (Kafka `producer.send({ messages: [...] })`, RabbitMQ confirms with channel batching) which preserves ordering atomically and is also more efficient. The in-memory implementation would iterate sequentially. This is the idiomatic pattern for all three major broker clients.

---

### 2. Partial dispatch after UoW commit is possible (without outbox)

**Severity: CRITICAL (when outbox is not configured) / MITIGATED (when outbox is configured)**

The event dispatch happens AFTER `uow.commit()` succeeds. If the process crashes or the broker connection drops between the commit and completing all dispatches, some events are persisted but never published. Consumers never see them. This is the classic dual-write problem.

When the outbox is configured, this is correctly mitigated:

- Events are written to the outbox atomically within the same UoW transaction
- The `OutboxRelay` polls for unpublished entries and retries dispatch
- The happy-path `onEventsDispatched` callback marks entries published so the relay does not re-dispatch them
- If the process crashes mid-dispatch, the relay picks up the remaining entries on restart

**However**, there is no enforcement or warning that production broker-backed deployments MUST configure the outbox. The outbox is entirely optional. A user could wire up a `KafkaEventBus` without an outbox and silently have at-most-once delivery semantics with no indication of data loss.

**Recommended fix**:

1. When a broker-backed EventBus (one implementing `Connectable`) is detected and no outbox is configured, emit a `warn`-level log: "EventBus implements Connectable but no outbox is configured. Events may be lost if the process crashes after UoW commit. Configure `wiring.outbox` for at-least-once delivery guarantees."
2. Document this prominently in the EventBus adapter guide.
3. Consider a `requireOutbox` flag in `DomainWiring` that throws during `init()` if a connectable bus is used without an outbox.

---

### 3. The outbox relay marks entries published one-at-a-time, creating a partial-publish window

**Severity: IMPORTANT**

In `outbox-relay.ts` `processOnce()`, the relay iterates entries sequentially:

```ts
for (const entry of entries) {
  await this.eventBus.dispatch(entry.event);
  await this.outboxStore.markPublished([entry.id]);
}
```

If the process crashes after dispatching entry N but before `markPublished([entry.id])`, entry N will be re-dispatched on the next relay run. This is correct for at-least-once semantics.

However, if the process crashes after marking entry N published but before dispatching entry N+1, entry N+1 is still unpublished and will be picked up next time. This is also correct.

The real issue is that entries from the same command (same `correlationId`) may be partially published. On restart, some events from a single command are already published (and consumed), while others are pending re-dispatch. Consumers that depend on receiving all events from a command atomically will see an inconsistent view during the relay catch-up window.

**Recommended fix**: The relay should process entries grouped by `correlationId` (or `aggregateId` + version range) and mark an entire group published together. This ensures that either all events from a single command are published and marked, or none are. The current per-entry approach is acceptable for systems where consumers are idempotent and eventually consistent, but it should be documented as a known behavior.

---

### 4. `onEventsDispatched` failure is silently swallowed

**Severity: IMPORTANT**

In `command-lifecycle-executor.ts` lines 169-175 and `saga-executor.ts` lines 164-170:

```ts
if (this.onEventsDispatched && events.length > 0) {
  try {
    await this.onEventsDispatched(events);
  } catch {
    // Best-effort: relay will catch unpublished entries
  }
}
```

The `onEventsDispatched` callback marks outbox entries as published. If this fails, the outbox relay will re-dispatch those events, causing duplicate delivery. The comment says "relay will catch unpublished entries" but this actually means consumers receive events twice: once from the initial direct dispatch, and once from the relay re-dispatch.

This is acceptable for at-least-once semantics, but:

1. The `catch` block should log a warning, not silently swallow. Currently there is no visibility into how often this happens.
2. The documentation should state that consumers MUST be idempotent when the outbox is configured.

**Recommended fix**: Add a `logger.warn()` in the catch block. Add a JSDoc note on `onEventsDispatched` documenting that failure leads to duplicate delivery via the relay.

---

### 5. Handler registration after `connect()` has a race window

**Severity: IMPORTANT**

In `Domain.init()`, the sequence is:

1. Line 571-579: Auto-connect buses (`bus.connect()`)
2. Lines 1027-1181: Register command handlers, query handlers, projection listeners, saga listeners via `bus.on()`

For broker-backed buses, `connect()` starts the consumer. If the broker has messages queued (e.g., from a previous crash recovery), those messages could arrive between `connect()` and `on()` registration. Messages arriving before handlers are registered would be delivered to an empty handler list and effectively dropped.

Looking at the Kafka adapter specifically: `connect()` calls `consumer.run()` on line 110, which starts consuming messages. Handlers registered via `on()` after `connect()` add to the `_handlers` map, and `_handleMessage` looks them up. If a message arrives between `run()` starting and the handler being registered, `_handleMessage` finds an empty handler list and silently drops the message.

The NATS adapter has the same issue: `_activateSubscriptions()` starts consuming, and `on()` after connect creates new subscriptions. But messages on subjects where `on()` hasn't been called yet are missed.

**Recommended fix**: Reverse the order. Register all handlers via `on()` BEFORE calling `connect()`. All three adapter implementations already support this: they buffer handlers registered before `connect()` and activate subscriptions during `connect()`. The engine should leverage this:

```ts
// Step 10-12: Register all event handlers FIRST
for (...) { eventBus.on(eventName, handler); }
// Step 2b: THEN connect
if (isConnectable(eventBus)) await eventBus.connect();
```

This is a one-line reorder in `init()` but it eliminates an entire class of race conditions.

---

### 6. Shutdown does not wait for in-flight event dispatches

**Severity: IMPORTANT**

The `_acquireOperation()` / `_releaseOperation()` mechanism tracks in-flight command/query dispatches. But event dispatch happens AFTER `_releaseOperation()` is called (it's outside the `try/finally` block in `dispatchCommand`). The sequence in `dispatchCommand()` is:

1. `_acquireOperation()` (line 1441)
2. Execute command via `_commandExecutor.execute()` (line 1471) -- this includes UoW commit AND event dispatch
3. `_releaseOperation()` in `finally` (line 1493)

Wait -- on closer inspection, `_commandExecutor.execute()` does include the event dispatch on line 166. So the operation counter IS held during dispatch. This is correct for `dispatchCommand`.

However, for `withUnitOfWork()`, the event dispatch (line 1332) is inside the `_uowStorage.run()` block and inside the `try` block that has `_acquireOperation` in the outer scope. So this is also correctly tracked.

For saga execution, the saga handler is invoked as an event handler on the bus. Event handlers are NOT wrapped in `_acquireOperation`/`_releaseOperation`. If shutdown is called while a saga is processing, the saga's UoW could be mid-commit when the event bus is closed (Phase 3 of shutdown). The drain mechanism only waits for operations started via `dispatchCommand`/`dispatchQuery`/`withUnitOfWork`, not for event-bus-triggered saga reactions.

**Recommended fix**: Wrap saga event handlers (and projection handlers) in `_acquireOperation`/`_releaseOperation` so the drain phase waits for them. Alternatively, introduce a separate counter for event-driven operations and wait for both during shutdown.

---

### 7. Kafka dispatch uses `correlationId` as message key -- incorrect partition routing

**Severity: IMPORTANT**

In `kafka-event-bus.ts` line 172:

```ts
const key = event.metadata?.correlationId ?? undefined;
```

The Kafka message key determines partition assignment. Using `correlationId` means all events with the same correlation ID go to the same partition, which preserves ordering within a correlation context. However, `correlationId` is typically a request-level or saga-level ID, not an aggregate ID.

For event-sourced systems, ordering should be preserved per aggregate instance. Two commands on the same aggregate with different correlation IDs would land on different partitions, and consumers rebuilding state from events would see them out of order.

**Recommended fix**: Use `event.metadata?.aggregateId` as the default message key, with a configurable key extraction function. This ensures all events for the same aggregate instance land on the same Kafka partition and are consumed in order:

```ts
const key =
  this._config.keyExtractor?.(event) ??
  event.metadata?.aggregateId?.toString() ??
  null;
```

---

### 8. No multi-process awareness for saga deduplication or projection idempotency

**Severity: IMPORTANT**

The engine provides `IdempotencyStore` for command deduplication, but there is no equivalent mechanism for:

1. **Saga deduplication**: In a multi-process deployment with a shared broker, the same event could be delivered to multiple processes (e.g., during Kafka rebalance). Two processes could start the same saga instance simultaneously, leading to duplicate saga state initialization and duplicate reaction commands.

2. **Projection idempotency**: If the same event is consumed by two processes (redelivery, rebalance), the projection reducer runs twice. For non-idempotent reducers (e.g., incrementing a counter), this produces incorrect state.

The engine's `SagaPersistence.load()` + `save()` is not atomic -- a process could load `null`, decide to bootstrap the saga, and then find that another process already bootstrapped it when it tries to save.

**Recommended fix**:

1. Add optimistic concurrency to `SagaPersistence` (version check on save, similar to aggregate persistence). This prevents two processes from simultaneously bootstrapping the same saga instance.
2. Document that projection reducers MUST be idempotent in multi-process deployments, or suggest using the event's `metadata.eventId` + a processed-events table to detect duplicates.
3. Consider adding a `processedEventId` check in the saga executor before executing the handler.

---

### 9. RabbitMQ dispatch does not await publisher confirms

**Severity: NICE-TO-HAVE**

In `rabbitmq-event-bus.ts` line 198:

```ts
this._channel.publish(this._exchangeName, event.name, body, {
  persistent: true,
});
```

`channel.publish()` in amqplib is synchronous (writes to the internal buffer) and does not guarantee the broker has received the message. Without publisher confirms enabled (`channel.confirmChannel()`), a message could be buffered locally and lost if the connection drops before the broker acknowledges it.

**Recommended fix**: Use a confirm channel (`connection.createConfirmChannel()`) and await the publish confirmation. This changes `dispatch()` to truly await broker acknowledgment.

---

### 10. The in-memory EventEmitterEventBus processes handlers sequentially, masking concurrency bugs

**Severity: NICE-TO-HAVE**

The `EventEmitterEventBus.dispatch()` method processes handlers with `for...of` + `await`, meaning each handler completes before the next starts. The broker-backed implementations use `Promise.all(handlers.map(...))` in `_handleMessage`, meaning handlers run concurrently.

This difference means code that works correctly in development/testing (sequential handler execution) could exhibit concurrency bugs in production (parallel handler execution). For example, two handlers for the same event that both read-modify-write a shared resource could have a race condition in production but not in tests.

**Recommended fix**: Either:

1. Make the in-memory bus also use `Promise.all` for consistency (preferred -- surfaces bugs early), or
2. Document this behavioral difference prominently.

---

## Summary Table

| #   | Finding                                                          | Severity     | Status                                 |
| --- | ---------------------------------------------------------------- | ------------ | -------------------------------------- |
| 1   | Parallel event dispatch breaks ordering within a single command  | CRITICAL     | Needs fix                              |
| 2   | Partial dispatch without outbox loses events                     | CRITICAL     | Needs enforcement/warning              |
| 3   | Outbox relay marks entries published one-at-a-time               | IMPORTANT    | Needs documentation or grouped marking |
| 4   | `onEventsDispatched` failure silently swallowed                  | IMPORTANT    | Needs logging                          |
| 5   | Handler registration after `connect()` has race window           | IMPORTANT    | Needs reorder in init()                |
| 6   | Shutdown does not wait for saga/projection handlers              | IMPORTANT    | Needs operation tracking               |
| 7   | Kafka uses correlationId as message key                          | IMPORTANT    | Needs aggregateId-based keying         |
| 8   | No saga deduplication or projection idempotency in multi-process | IMPORTANT    | Needs design work                      |
| 9   | RabbitMQ dispatch does not use publisher confirms                | NICE-TO-HAVE | Use confirm channel                    |
| 10  | In-memory bus handler execution order differs from broker buses  | NICE-TO-HAVE | Align behavior or document             |

---

## Recommended Priority

**Phase 1 (before any production broker deployment)**:

- Fix #1 (sequential or batch dispatch)
- Fix #5 (reorder handler registration before connect)
- Fix #2 (warn when connectable bus + no outbox)

**Phase 2 (before multi-process production deployment)**:

- Fix #6 (saga/projection drain on shutdown)
- Fix #7 (Kafka message key)
- Fix #8 (saga deduplication)
- Fix #4 (logging on swallowed errors)

**Phase 3 (hardening)**:

- Fix #3 (grouped outbox marking)
- Fix #9 (RabbitMQ confirms)
- Fix #10 (handler execution order consistency)
