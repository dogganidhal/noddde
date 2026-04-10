## Build Report: NatsEventBus

- **Spec**: specs/adapters/nats/nats-event-bus.spec.md
- **Source**: packages/adapters/nats/src/nats-event-bus.ts
- **Tests**: packages/adapters/nats/src/__tests__/nats-event-bus.test.ts
- **Result**: GREEN
- **Tests passing**: 23/23
- **Loop count**: 1

### Test Results

| Test | Status |
|------|--------|
| should publish event to subject derived from event name | PASS |
| should prepend subjectPrefix to event name for subject | PASS |
| should throw when dispatching before connect | PASS |
| should invoke registered handler when event is consumed | PASS |
| should invoke all handlers concurrently via Promise.all | PASS |
| should reject if any handler throws during parallel invocation | PASS |
| should map BrokerResilience to nats reconnection options | PASS |
| should configure prefetchCount as maxAckPending on JetStream consumer options | PASS |
| should drain connection and clear handlers on close | PASS |
| should not throw when close is called multiple times | PASS |
| should serialize the full event object including metadata | PASS |
| should set maxDeliver on consumer options when resilience.maxRetries is configured | PASS |
| should term a poison message (malformed JSON) and continue | PASS |
| should nak message when handler throws and not ack | PASS |
| should ack message when all handlers succeed | PASS |
| should not crash consumer loop when msg.term() throws (connection dropped) | PASS |
| should not crash consumer loop when msg.nak() throws (connection dropped) | PASS |
| should not crash consumer loop when msg.ack() throws (connection dropped) | PASS |
| should use .catch() on consumer loop to prevent unhandled promise rejections | PASS |
| should use consumerGroup as prefix in durable consumer name | PASS |
| should produce different durable names for different consumerGroup values on the same event | PASS |
| should reject connect() when subscription creation fails during _activateSubscriptions | PASS |
| should use provided logger for error and warn logging with structured data | PASS |

### Implementation Notes

- Added `@noddde/engine` as a runtime dependency to `packages/adapters/nats/package.json` (required for `NodddeLogger` default).
- Updated `vitest.config.mts` to add `@noddde/engine` alias pointing to `packages/engine/src/index.ts`.
- `_createSubscriptionForEvent` now accepts a `failFast: boolean` parameter (default `false`). During `connect()`, `_activateSubscriptions` passes `true` so subscription errors propagate and `connect()` rejects. Late `on()` calls use `false` (log only).
- All `console.error`/`console.warn` replaced with `this._logger.error`/`this._logger.warn` with structured `{ eventName, error }` data objects. Zero `console.*` calls remain in the implementation.
- Durable consumer name format changed from `sanitized(eventName)` to `${consumerGroup}_${sanitized(eventName)}`.
- `NatsEventBusConfig` updated with required `consumerGroup: string` field and optional `logger?: Logger` field.

### Concerns

None.
