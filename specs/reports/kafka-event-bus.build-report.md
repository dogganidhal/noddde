## Build Report: KafkaEventBus (warmup feature)

- **Spec**: specs/adapters/kafka/kafka-event-bus.spec.md
- **Source**: packages/adapters/kafka/src/kafka-event-bus.ts
- **Tests**: packages/adapters/kafka/src/**tests**/kafka-event-bus.test.ts
- **Result**: GREEN
- **Tests passing**: 29/29
- **Loop count**: 2 (one loop to fix a TDZ bug in the initial warmup implementation, described below)

### Test Results

| Test                                                                                            | Status |
| ----------------------------------------------------------------------------------------------- | ------ |
| should publish event to topic derived from event name                                           | PASS   |
| should prepend topicPrefix to event name for topic                                              | PASS   |
| should throw when dispatching before connect                                                    | PASS   |
| should invoke registered handler when event is consumed                                         | PASS   |
| should invoke all handlers concurrently via Promise.all                                         | PASS   |
| should reject if any handler throws during parallel invocation                                  | PASS   |
| should map BrokerResilience to kafkajs retry configuration                                      | PASS   |
| should configure consumer with sessionTimeout and heartbeatInterval                             | PASS   |
| should disconnect and clear handlers on close                                                   | PASS   |
| should not throw when close is called multiple times                                            | PASS   |
| should pass autoCommit: false to consumer.run()                                                 | PASS   |
| should call consumer.stop() before consumer.disconnect() on close                               | PASS   |
| should skip poison messages without throwing on deserialization failure                         | PASS   |
| should serialize the full event object including metadata                                       | PASS   |
| should explicitly commit offsets after handling                                                 | PASS   |
| should deduplicate concurrent connect() calls                                                   | PASS   |
| should log error and remove topic from subscribed set when subscribe fails after connect        | PASS   |
| should use aggregateId as message key by default                                                | PASS   |
| should use null key when event has no aggregateId                                               | PASS   |
| should use custom function for partition key when provided                                      | PASS   |
| should use provided logger for warn logging with structured data                                | PASS   |
| should run every handler to completion even when an earlier one throws                          | PASS   |
| should log once per failed handler with handlerName and error fields                            | PASS   |
| should not commit the offset when any handler fails (existing redelivery behavior is preserved) | PASS   |
| **should create the warmup topic, dispatch, and resolve once the round-trip is observed** (new) | PASS   |
| **should not repeat the round-trip on a second call after success** (new)                       | PASS   |
| **should throw when warmup is called before connect** (new)                                     | PASS   |
| **should perform the warmup round-trip during connect when warmupOnConnect is true** (new)      | PASS   |
| **should reject with a timeout error when the handler never observes the warmup event** (new)   | PASS   |

Note: the task brief mentioned "6 NEW scenario headings," but the spec's Test Scenarios section under warmup actually contains 5 new `###` headings (listed above, all now covered). No discrepancy in the spec content itself — just the count in the task description.

### Implementation summary

- `KafkaEventBusConfig`: added `warmupOnConnect?: boolean` and `warmupTimeoutMs?: number` (default 60000ms), documented with JSDoc, matching the spec's Type Contract.
- `_kafka` field type widened from `Pick<Kafka, "producer" | "consumer">` to `Pick<Kafka, "producer" | "consumer" | "admin">` so tests can inject a mock `admin()`.
- Added `_warmedUp: boolean` and `_warmingUp: Promise<void> | null` fields, mirroring the existing `_connecting` mutex pattern.
- Added public `warmup(): Promise<void>`:
  - Throws the existing "KafkaEventBus is not connected. Call connect() first." error when called before `connect()` or after `close()`.
  - Idempotent via `_warmedUp` (no-op after first success) and deduplicates concurrent calls via `_warmingUp` in-flight promise.
  - Creates topic `` `__noddde_warmup_${clientId}` `` via `this._kafka.admin()` (`connect()` → `createTopics({ waitForLeaders: true, topics: [...] })` → `disconnect()`).
  - Delegates the actual round-trip to a new private `_performWarmupRoundTrip(topic)`, which registers an internal handler via the bus's own `on()`, dispatches a throwaway event immediately and then every 1s via `setInterval`, and races against a `setTimeout(warmupTimeoutMs)` that rejects with a message containing "timed out".
- Wired `warmupOnConnect` into `connect()`: after `this._connected = true` is set (inside the existing async IIFE, before the outer `connect()` promise resolves), calls `await this.warmup()` when the config flag is set, so a warmup failure propagates through `connect()`'s returned promise.

### Bug found and fixed during the GREEN loop

The first implementation of `_performWarmupRoundTrip` declared `intervalId`/`timeoutId` as `const` at their `setInterval`/`setTimeout` call sites, referenced from a `finish()` closure defined earlier in the function. In unit tests (and potentially against a very fast real broker), the mock producer's `send()` synchronously drives the consumer's `eachMessage` callback, which synchronously invokes the internal warmup handler and thus `finish()` — before the `const intervalId = setInterval(...)` line had executed. This threw `ReferenceError: Cannot access 'intervalId' before initialization` (TDZ), which the code swallowed via `dispatch().catch()` logging, but the round-trip's `resolve()` was never reached, causing the first three warmup tests to hang until the 5000ms vitest timeout. Fixed by declaring `intervalId`/`timeoutId` with `let` up front (undefined initially) before the `finish`/`dispatchOnce` closures are defined, then assigning them later — `clearInterval(undefined)` / `clearTimeout(undefined)` are safe no-ops. After the fix, all warmup tests pass in well under a second (the timeout test intentionally waits out its 50ms `warmupTimeoutMs`).

### Integration test refactor

Refactored the `beforeAll` cold-start warmup workaround in `packages/adapters/kafka/src/__tests__/integration/kafka.integration.test.ts` (previously ~lines 14-56) to use the new `KafkaEventBus.warmup()` method via `warmupOnConnect: true`, instead of manually creating a throwaway admin client + bus + `waitFor` polling loop:

```ts
const warmupBus = new KafkaEventBus({
  brokers: kafka_.brokers,
  clientId: `warmup-${uniqueSuffix()}`,
  groupId: `warmup-group-${uniqueSuffix()}`,
  warmupOnConnect: true,
  warmupTimeoutMs: 60_000,
});
await warmupBus.connect();
await warmupBus.close();
```

This removes ~30 lines of manual admin-client/topic-creation/`waitFor`-polling boilerplate while preserving identical behavior: `connect()` now internally creates the warmup topic via the admin client, registers an internal handler, and polls/dispatches until observed or timed out (same 60s budget as before). The `waitFor` import is still required and retained, since it's used by three other (non-warmup) tests later in the same file (partition-routing convergence, consumer-group fan-out, and a maxRetries poison-message test). The `Kafka` import from `kafkajs` is also still required and retained — it's used by five other admin/probe-consumer usages elsewhere in the file.

This file requires a running Kafka test container (via testcontainers/Docker) and **could not be executed in this environment** (no Docker available). The change was made by careful manual reading of the surrounding contract-test setup and cross-checking every remaining usage of the removed/kept imports (`Kafka`, `waitFor`) to confirm neither became unused. Recommend verifying this file passes in CI, specifically:

- The `beforeAll` hook completes within its 300s timeout.
- The subsequent `defineEventBusContract("kafka", ...)` and `KafkaEventBus broker-specific behaviour` tests still pass against a warmed broker (i.e., the warmup actually mitigates the cold-start latency it replaced).

### Concerns

None. All spec requirements 20-23 (Warmup) and associated Invariants/Edge Cases are implemented and covered by unit tests. `tsc --noEmit` and `npx vitest run` (full package suite, excluding integration) both pass cleanly; `prettier --check` and `eslint --max-warnings 0` pass on all touched files.
