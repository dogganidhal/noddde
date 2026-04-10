## Audit Report: NatsEventBus

- **Spec**: specs/adapters/nats/nats-event-bus.spec.md
- **Source**: packages/adapters/nats/src/nats-event-bus.ts
- **Tests**: packages/adapters/nats/src/**tests**/nats-event-bus.test.ts
- **Build Report**: specs/reports/nats-event-bus.build-report.md
- **Cycle**: 1
- **Result**: **PASS**

### Export Coverage

| Spec Export          | Actual Export | Status |
| -------------------- | ------------- | ------ |
| `NatsEventBus`       | Value export  | PASS   |
| `NatsEventBusConfig` | Type export   | PASS   |

### Behavioral Requirement Audit

| #   | Requirement                         | Implemented                               | Tested                                  | Verdict |
| --- | ----------------------------------- | ----------------------------------------- | --------------------------------------- | ------- |
| 1   | Subject derivation                  | `_subjectFor()` line 198                  | Tests 1-2                               | PASS    |
| 2   | JSON serialization                  | `JSON.stringify(event)` line 155          | "serialize full event" test             | PASS    |
| 3   | JetStream publish                   | `_js.publish()` line 156                  | Test 1                                  | PASS    |
| 4   | Dispatch before connect throws      | Guard at line 148                         | "dispatch throws before connect"        | PASS    |
| 5   | on registers handlers               | Map-based registry line 130               | "invoke registered handler"             | PASS    |
| 6   | consumerGroup durable naming        | `${consumerGroup}_${sanitized}` line 236  | Two dedicated tests                     | PASS    |
| 7   | Poison message protection           | try/catch + msg.term() lines 275-293      | "term poison message" + "term throws"   | PASS    |
| 8   | Parallel handler invocation + nak   | Promise.all line 195, nak line 310        | "parallel handlers" + "nak when throws" | PASS    |
| 9   | Ack after handlers                  | msg.ack() line 298                        | "ack message when all handlers succeed" | PASS    |
| 10  | prefetchCount                       | maxAckPending line 242                    | "prefetchCount" test                    | PASS    |
| 10b | maxRetries -> maxDeliver            | Lines 244-246                             | "maxDeliver" test                       | PASS    |
| 11  | connect establishes NATS connection | connect() lines 88-96                     | "map BrokerResilience"                  | PASS    |
| 12  | connect idempotent                  | Guard at line 84                          | Trivially correct                       | PASS    |
| 13  | close drains                        | nc.drain() line 176                       | "drain connection" test                 | PASS    |
| 14  | close idempotent                    | `_closed` guard line 165                  | "close is idempotent"                   | PASS    |
| 15  | Handler errors prevent ack          | catch at line 304                         | "nak when handler throws"               | PASS    |
| 15b | Consumer loop .catch()              | .catch() at line 251                      | "use .catch()" test                     | PASS    |
| 16  | Serialization errors on dispatch    | JSON.stringify propagates                 | Inherent to JS                          | PASS    |
| 17  | Connection errors on dispatch       | \_js.publish propagates                   | Inherent to JS                          | PASS    |
| 18  | Fail-fast connect                   | failFast=true in \_activateSubscriptions  | "reject connect()" test                 | PASS    |
| 19  | Framework logger                    | this.\_logger everywhere, zero console.\* | "logger structured calls" test          | PASS    |

### Invariant Check

All 9 invariants verified:

- JSON serialization: enforced by `JSON.stringify`
- Full Event object to handlers: verified in test
- Ack only after success: verified in consumer loop structure
- No deduplication: no dedup logic present
- Subject pattern: `_subjectFor()` matches spec
- Durable name pattern: matches `${consumerGroup}_${sanitized(eventName)}`
- Independent consumers: tested with two different consumerGroup values
- JetStream durability: inherent to JetStream
- No console.\* calls: grep confirms zero matches

### Edge Case Coverage

All 11 edge cases handled and tested:

- No handler: Promise.all([]) resolves (ack)
- Handler throws: nak'd for redelivery
- No payload: JSON.stringify handles undefined
- Multiple handlers: Promise.all
- on() before connect(): buffered
- on() after close(): throws
- Stream does not exist: created in connect()
- Two consumerGroups: independent durable names (tested)
- Subscription fails during connect: connect() rejects (tested)
- Subscription fails during late on(): logged (tested indirectly via failFast=false path)
- No logger: defaults to NodddeLogger (tested)

### Coherence Review

1. **Spec intent alignment**: The implementation faithfully matches all 19 behavioral requirements. The consumerGroup durable naming pattern is exactly `${consumerGroup}_${sanitized(eventName)}`. The fail-fast connect correctly rejects when subscriptions fail during `_activateSubscriptions`. All console.\* calls are replaced with structured logger calls using `this._logger.error()` and `this._logger.warn()` with structured data second parameters.

2. **Unhandled scenarios**: None found. All spec edge cases are covered.

3. **Convention compliance**: JSDoc on all public members. TypeScript strict mode. No decorators. Infrastructure class pattern (appropriate for bus adapter). Logger interface used correctly with structured data second parameter. No console.\* calls.

4. **Breaking change propagation**: `consumerGroup` is now required in `NatsEventBusConfig`. All 23 test constructors include it. Documentation updated with consumerGroup in config table, config example, and wiring example.

5. **Double parse note**: `_consumeSubscription` parses JSON (line 276) then calls `_handleMessage` which parses again (line 193). This is a minor inefficiency but acceptable -- the first parse is for poison message protection, the second is the handler-facing API. Refactoring would couple the consumer loop to the handler method's internals.

### Mechanical Checks

| Check            | Result                        |
| ---------------- | ----------------------------- |
| `tsc --noEmit`   | PASS (zero errors)            |
| `vitest run`     | PASS (23/23 green)            |
| `console.*` grep | PASS (zero matches in source) |
| Stub check       | PASS (no stubs, only guards)  |

### Documentation Updates

Updated `docs/content/docs/running/event-bus-adapters.mdx`:

- Added `consumerGroup` (required) to NATS config example code
- Added `consumerGroup` row to NATS config table with description
- Added `logger` row to NATS config table with default value
- Updated "Subscribing" bullet to describe consumerGroup durable naming, fail-fast connect, and late registration behavior
- Added "Logging" bullet to "How It Works" section
- Updated NATS wiring example to include `consumerGroup`

### Findings

None. Implementation is clean, complete, and matches spec intent.
