---
"@noddde/kafka": minor
"@noddde/nats": minor
"@noddde/rabbitmq": minor
---

Fix messaging-adapter blockers surfaced in the GA-readiness audit of `1.0.0-rc.1` (#134, #135): multi-instance delivery, poison-message handling, and default-config safety across Kafka, NATS, and RabbitMQ.

**Topology decision:** all three adapters keep per-event-name topic/queue/subject routing (topicPrefix/queuePrefix naming is unchanged). A true per-aggregate-type topology would need a core concept the `EventBus.on(eventName, handler)` contract doesn't have yet, so instead every adapter's ordering guarantee is now precisely documented: ordering holds only within one event name (and, for RabbitMQ, only per aggregate — see below); it does **not** hold across event names for the same aggregate. Any handler spanning multiple event types for one aggregate must be idempotent/order-tolerant (e.g. via `EventMetadata.sequenceNumber`).

**NATS — BREAKING**

- Subscriptions now set a JetStream deliver/queue group equal to the durable name, so a second replica of the same service can boot and competing-consume instead of crashing with "duplicate subscription". This changes server-side durable-consumer state.
- `subjectPrefix` is required at `connect()` time whenever `streamName` is configured (previously optional, silently defaulting the stream subject to `>` — claiming every subject on the server). Prefixes normalize to a trailing dot.
- A second `on()` handler for an already-subscribed event name no longer triggers a duplicate `js.subscribe`.
- Nak now backs off (capped exponential delay) instead of immediate redelivery; exhausted-retry messages are parked to a `dlq.<eventName>` subject with failure metadata instead of being silently server-discarded.

**RabbitMQ — BREAKING**

- `queuePrefix` is now a required config field (no more shared `"noddde"` default) — matches Kafka's required `groupId` and NATS's required `consumerGroup`, so two default-config services no longer become competing consumers on the same queue.
- Ack/nack after a mid-session reconnect now targets the channel instance captured at subscribe time, never the current `this._channel` — fixes silent event loss / wedged consumers when a handler resolves after a reconnect. Channel-level `error`/`close` now also route into the reconnection path.
- Deliveries sharing an `aggregateId` are now processed strictly in order (independent aggregates still run concurrently up to prefetch).
- The retry-count fallback key (used when no `messageId` is set) is now a full-body hash instead of a 24-byte content prefix, so a burst of distinct same-type events without an explicit event id is no longer misidentified as poison; counters are pruned on the discard path too.
- Exhausted-retry messages are dead-lettered with failure metadata instead of silently acked and dropped.
- Consumer setup failures after `on()` are now logged instead of swallowed by an empty catch.

**Kafka**

- Event topics are now auto-provisioned (configurable `topicPartitions`, default 3, and `replicationFactor`) at `connect()` for every registered handler, instead of relying on broker auto-create (which silently defeats `partitionKeyStrategy` and consumer-group scale-out at 1 partition).
- A message that exhausts retries (or fails to parse) is parked to a `<topic><dlqTopicSuffix>` DLQ topic (default suffix `.dlq`) with failure metadata, and consumption of other event types no longer head-of-line-blocks behind it.
- Default effective `maxRetries` is now `5` when unset (previously unbounded, which was the root cause of the head-of-line-blocking hot loop).

**All three**

- Published messages now carry a `content-type: application/vnd.noddde.event+json; version=1` header/property, and the wire format (JSON of the full `Event` object) is documented as a versioned, stable contract, including the caveat that `Date`/`Map`/`BigInt`/`undefined` payload fields serialize lossily.
