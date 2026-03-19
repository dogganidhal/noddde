# noddde Production Readiness Report — Banking-Grade Gaps

## Overview

This report catalogs every gap between noddde's current state and what a production banking application requires. Gaps are organized by domain (consistency, audit, performance, operations, resilience, security) and prioritized by severity.

---

## 1. DATA CONSISTENCY

### 1.1 Optimistic Concurrency Control

**Severity: P0 — Blocker**

**Current state**: `EventSourcedAggregatePersistence.save()` appends events without checking the expected stream version. Two concurrent commands on the same aggregate both succeed, potentially producing invalid state (e.g., overdrawing an account).

**Required changes**:

- Add `expectedVersion: number` parameter to `EventSourcedAggregatePersistence.save()`
- Add `version` return to `EventSourcedAggregatePersistence.load()` (return `{ events, version }` or track via event count)
- `save()` must throw `ConcurrencyError` if current version != expected
- `StateStoredAggregatePersistence` needs an equivalent (ETag or version column)
- `Domain.executeAggregateCommand()` must catch `ConcurrencyError` and support retry strategy (configurable: retry N times, or propagate)
- Drizzle adapter: use `WHERE sequence_number = expectedVersion` guard on insert, or database-level unique constraint on `(aggregate_name, aggregate_id, sequence_number)`

**Files to modify**: `packages/core/src/persistence/index.ts`, `packages/engine/src/domain.ts`, `packages/adapters/drizzle/src/persistence.ts`, all ORM adapter persistence classes

---

### 1.2 Idempotent Command Processing

**Severity: P1 — High**

**Current state**: No deduplication. If a command is dispatched twice (network retry, saga re-delivery), it produces duplicate events. For banking: a double-charge.

**Required changes**:

- Add optional `commandId: string` to `Command` interface (or a separate `IdempotencyKey`)
- `Domain.executeAggregateCommand()` checks if commandId was already processed (lookup table)
- Persist processed commandIds alongside events (within the same UoW transaction)
- Return cached result for duplicate commands instead of re-executing
- TTL-based cleanup of processed command IDs

**Files to modify**: `packages/core/src/cqrs/command/command.ts`, `packages/engine/src/domain.ts`, new `IdempotencyStore` interface in `packages/core/src/persistence/`

---

### 1.3 Outbox Pattern for Event Publishing

**Severity: P1 — High**

**Current state**: Events are published to the in-process `EventEmitterEventBus` after UoW commit. If the process crashes between commit and event dispatch, events are lost — projections and sagas never see them.

**Required changes**:

- Persist events to an outbox table within the same database transaction as aggregate state
- Background poller or CDC (Change Data Capture) reads outbox and publishes to event bus
- Mark events as published in outbox after successful dispatch
- Guarantee at-least-once delivery with consumer-side idempotency
- Add `OutboxEventBus` implementation that writes to outbox instead of publishing directly

**New files**: `packages/core/src/persistence/outbox.ts` (interface), adapter implementations in each ORM package

---

### 1.4 Saga Atomicity Guarantees

**Severity: P2 — Medium**

**Current state**: Saga handler creates its own UoW spanning saga state + dispatched commands. If a dispatched command fails, the saga state is already enlisted. The catch block rolls back, but the error propagation path could leave saga state inconsistent if rollback itself fails.

**Required changes**:

- Saga state and all command-triggered persistence must be in the same DB transaction
- If using outbox pattern, saga-dispatched commands' events go through outbox too
- Add saga compensation hooks: `onError(event, state, error) => SagaReaction` for explicit compensation logic
- Document the exactly-once vs at-least-once guarantees clearly

**Files to modify**: `packages/engine/src/domain.ts` (saga handler lifecycle)

---

## 2. AUDIT & COMPLIANCE

### 2.1 Event Metadata Envelope

**Severity: P0 — Blocker for regulated banking**

**Current state**: `Event = { name: string; payload: any }`. No metadata.

**Required changes** — extend Event to:

```ts
interface Event<TPayload = any> {
  name: string;
  payload: TPayload;
  metadata?: EventMetadata;
}

interface EventMetadata {
  eventId: string; // Globally unique event identifier
  timestamp: string; // ISO 8601 timestamp
  correlationId: string; // Traces a user action across aggregates/sagas
  causationId: string; // ID of the command or event that caused this
  userId?: string; // Who initiated the action
  version?: number; // Event schema version (for evolution)
  aggregateName?: string; // Which aggregate produced this
  aggregateId?: string; // Which instance
  sequenceNumber?: number; // Position in the aggregate's event stream
}
```

- `Domain.executeAggregateCommand()` should auto-populate metadata (eventId, timestamp, correlationId from command, causationId = commandId, aggregate info, sequence)
- Saga handlers should propagate correlationId from triggering event to dispatched commands
- Persistence must store and retrieve metadata
- Drizzle schema needs metadata columns

**Files to modify**: `packages/core/src/edd/event.ts`, `packages/engine/src/domain.ts`, all persistence interfaces and implementations, all ORM adapter schemas

---

### 2.2 Command Audit Log

**Severity: P1 — High**

**Current state**: No record of commands dispatched. Only events are persisted.

**Required changes**:

- Add `CommandLog` interface: `log(command, result: 'success' | 'error', error?): Promise<void>`
- `Domain.executeAggregateCommand()` logs every command (before execution and after, with result)
- Include: commandId, name, targetAggregateId, payload, userId, timestamp, correlationId, duration, result
- Queryable for compliance auditors ("show me all commands by user X between dates Y-Z")

**New files**: `packages/core/src/persistence/command-log.ts`, adapter implementations

---

### 2.3 Immutable Event Store Guarantees

**Severity: P1 — High**

**Current state**: The event store `save()` appends, but nothing prevents deleting or updating existing events. The Drizzle schema has no constraints preventing modification.

**Required changes**:

- Database-level: append-only constraint (no UPDATE/DELETE on events table via row-level security or application-level enforcement)
- Add unique constraint on `(aggregate_name, aggregate_id, sequence_number)` to prevent gaps or duplicates
- Add event store integrity check: verify sequence numbers are contiguous
- Consider cryptographic chaining (each event includes hash of previous event) for tamper detection
- Add `EventStore.verify(aggregateName, aggregateId): Promise<IntegrityResult>` for audit tooling

**Files to modify**: Drizzle/Prisma/TypeORM schema definitions, potentially new `EventStoreIntegrity` interface

---

## 3. PERFORMANCE

### 3.1 Snapshotting

**Severity: P0 — Blocker at scale**

**Current state**: Every command replays ALL events from genesis. An account with 100K transactions replays 100K events per command.

**Required changes**:

- Add `SnapshotStore` interface:
  ```ts
  interface SnapshotStore {
    save(
      aggregateName: string,
      aggregateId: string,
      snapshot: { state: any; version: number },
    ): Promise<void>;
    load(
      aggregateName: string,
      aggregateId: string,
    ): Promise<{ state: any; version: number } | null>;
  }
  ```
- `EventSourcedAggregatePersistence.load()` should support loading events **after** a given sequence number: `load(name, id, afterVersion?: number): Promise<Event[]>`
- `Domain.executeAggregateCommand()` flow becomes:
  1. Load latest snapshot (if exists)
  2. Load events after snapshot version
  3. Replay only new events on top of snapshot state
  4. Periodically save new snapshot (every N events, configurable)
- Snapshot strategy should be configurable (every N events, every N minutes, manual)
- Drizzle adapter needs snapshot table

**Files to modify**: `packages/core/src/persistence/index.ts` (new interface), `packages/engine/src/domain.ts`, all persistence implementations and ORM adapters

---

### 3.2 Aggregate Caching

**Severity: P2 — Medium**

**Current state**: No caching. Every command re-loads from the database, even for the same aggregate within milliseconds.

**Required changes**:

- In-memory aggregate state cache with configurable TTL and max size
- Cache invalidation on write (write-through or invalidate-on-write)
- Optional: read-through cache with version check
- Must integrate with optimistic concurrency (cached version must match DB version)

**New files**: `packages/engine/src/cache/` with `AggregateCache` interface and in-memory implementation

---

### 3.3 Async/Parallel Event Dispatch

**Severity: P2 — Medium**

**Current state**: `EventEmitterEventBus` dispatches events to handlers sequentially (await one, then next). If a projection reducer takes 100ms, all downstream handlers wait.

**Required changes**:

- Option for parallel handler execution: `Promise.allSettled()` for independent handlers
- Configurable: sequential (current) vs parallel vs priority-ordered
- Handler failure isolation: one failing handler shouldn't block others
- Dead letter queue for failed handlers

**Files to modify**: `packages/engine/src/implementations/ee-event-bus.ts`

---

## 4. OPERATIONAL READINESS

### 4.1 Projection Rebuild / Catch-up

**Severity: P0 — Blocker for operations**

**Current state**: Projections are populated only by live event bus subscriptions. No way to rebuild from the event store. If a projection has a bug, fixing it doesn't retroactively correct the view.

**Required changes**:

- `EventStore.loadAll(aggregateName?: string): AsyncIterable<Event>` — stream all events
- `ProjectionRebuilder` utility: reads all events from store, replays through projection reducers
- Track projection position (last processed event sequence) for catch-up capability
- Support for rebuilding a single projection without affecting others
- Progress reporting during rebuild (for ops dashboards)

**New files**: `packages/core/src/persistence/event-store.ts` (read-side query interface), `packages/engine/src/projection-rebuilder.ts`

---

### 4.2 Event Store Global Stream

**Severity: P1 — High**

**Current state**: Events are stored per-aggregate. There's no global ordered stream across all aggregates. This makes it impossible to:

- Rebuild projections that span multiple aggregate types
- Feed events to external systems (data lake, analytics)
- Implement event subscriptions with "start from position X"

**Required changes**:

- Add global sequence number (auto-increment across all events)
- Add `EventStore.loadGlobalStream(afterPosition?: number): AsyncIterable<Event>`
- Drizzle schema: add `global_position` column (bigint auto-increment)
- Subscription API: `subscribe(fromPosition, handler)` for catch-up subscriptions

**Files to modify**: Drizzle/Prisma/TypeORM schemas, new `EventStore` query interface

---

### 4.3 Health Checks and Observability

**Severity: P1 — High**

**Current state**: No metrics, no health checks, no structured logging.

**Required changes**:

- `Domain.health()`: checks DB connectivity, event store integrity, projection lag
- Metrics hooks: command latency, event count, projection lag, saga active count
- OpenTelemetry integration points (spans for command execution, event dispatch)
- Structured logging interface (pluggable: pino, winston, etc.)
- Command execution tracing (correlationId propagation through the full lifecycle)

**New files**: `packages/core/src/observability/` with metrics and tracing interfaces

---

### 4.4 Graceful Shutdown

**Severity: P2 — Medium**

**Current state**: No shutdown lifecycle. If the process is killed during command execution, in-flight UoW may be in an inconsistent state.

**Required changes**:

- `Domain.shutdown()`: waits for in-flight commands to complete, stops accepting new ones
- Drain event bus handlers
- Close database connections
- Signal-based graceful shutdown integration (SIGTERM handler)

**Files to modify**: `packages/engine/src/domain.ts`

---

## 5. RESILIENCE

### 5.1 Saga Timeouts and Dead Letters

**Severity: P1 — High**

**Current state**: Sagas have no timeout mechanism. A saga stuck in "awaiting_payment" stays there forever.

**Required changes**:

- Saga timeout configuration: `timeout: { after: Duration, action: 'compensate' | 'alert' }`
- Timeout scheduler that checks saga age and triggers timeout handler
- `onTimeout(state, infrastructure) => SagaReaction` handler on saga definition
- Dead letter store for failed saga reactions (inspect, retry, or discard)
- Saga admin API: list active sagas, inspect state, manually trigger compensation

**Files to modify**: `packages/core/src/ddd/saga.ts`, `packages/engine/src/domain.ts`, new scheduler infrastructure

---

### 5.2 Command Retry with Backoff

**Severity: P2 — Medium**

**Current state**: Commands throw on failure. No retry. The caller must handle retries.

**Required changes**:

- Configurable retry policy per command: `{ maxRetries: 3, backoff: 'exponential', retryOn: [ConcurrencyError] }`
- Built-in retry for `ConcurrencyError` (optimistic concurrency conflicts)
- Circuit breaker for infrastructure failures (DB down → fail fast instead of queuing)
- Retry metrics (how many retries per command type)

**Files to modify**: `packages/engine/src/domain.ts`, new `RetryPolicy` type in core

---

### 5.3 Event Handler Error Isolation

**Severity: P2 — Medium**

**Current state**: If a projection reducer throws, the error propagates up and may prevent other handlers from running.

**Required changes**:

- Catch errors per handler, log, continue to next handler
- Failed events go to a dead letter queue with handler name and error
- Retry mechanism for failed event handlers
- Alert on persistent handler failures

**Files to modify**: `packages/engine/src/implementations/ee-event-bus.ts`, `packages/engine/src/domain.ts`

---

## 6. TYPE SYSTEM & API IMPROVEMENTS

### 6.1 Typed Persistence Interfaces

**Severity: P2 — Medium**

**Current state**: Persistence uses `any` for state and events. No compile-time guarantee that persisted data matches the aggregate definition.

**Required changes**:

- Make persistence interfaces generic:
  ```ts
  interface StateStoredAggregatePersistence<TState = any> {
    save(name: string, id: string, state: TState): Promise<void>;
    load(name: string, id: string): Promise<TState | undefined>;
  }
  ```
- Aggregate registration should carry state type to persistence layer
- Serialization/deserialization should be schema-aware (not raw `JSON.stringify`)

**Files to modify**: `packages/core/src/persistence/index.ts`, `packages/engine/src/domain.ts`, all adapters

---

### 6.2 Decouple Bus Registration from Concrete Types

**Severity: P2 — Medium**

**Current state**: `Domain.init()` casts `commandBus as InMemoryCommandBus` to call `.register()`. The `CommandBus` interface only has `dispatch()`.

**Required changes**:

- Either: add `register()` to the `CommandBus`/`EventBus`/`QueryBus` interfaces
- Or: introduce `CommandRouter`, `EventRouter`, `QueryRouter` interfaces that the Domain uses for wiring, and keep `CommandBus` etc. as consumer-facing
- This enables swapping in message broker-backed bus implementations

**Files to modify**: `packages/core/src/cqrs/command/command-bus.ts`, `packages/core/src/edd/event-bus.ts`, `packages/core/src/cqrs/query/query-bus.ts`, `packages/engine/src/domain.ts`

---

### 6.3 Event Schema Evolution

**Severity: P1 — High (for long-lived systems)**

**Current state**: No versioning on events. No upcasting/downcasting mechanism.

**Required changes**:

- Event version field in metadata
- `EventUpcaster` registry: `(eventName, fromVersion, toVersion) => transformFn`
- Applied transparently during event load (before replay)
- Version stored alongside events in DB
- Migration tooling: scan event store, apply upcasters, rewrite events (optional, for major migrations)

**New files**: `packages/core/src/edd/event-upcaster.ts`, integration in persistence layer

---

## 7. DISTRIBUTED SYSTEM SUPPORT

### 7.1 Distributed Event Bus Adapter

**Severity: P1 — High (for multi-instance deployment)**

**Current state**: `EventEmitterEventBus` is in-process only. Multiple application instances don't share events.

**Required changes**:

- `EventBus` adapter for at least one durable message broker (Kafka, NATS, RabbitMQ)
- Consumer group support for projections and sagas (only one instance processes each event)
- Ordered delivery per aggregate ID (partition key = aggregateId)
- At-least-once delivery with consumer-side idempotency
- Dead letter topic for failed messages

**New packages**: `@noddde/kafka`, `@noddde/nats`, etc.

---

### 7.2 Distributed Saga Coordination

**Severity: P2 — Medium (for multi-instance)**

**Current state**: Saga state is loaded and saved without locking. Two instances processing events for the same saga instance will conflict.

**Required changes**:

- Pessimistic or optimistic locking on saga state load/save
- Saga instance "claimed by" mechanism (only one node processes a given saga instance)
- Or: route all events for a saga instance to the same node (partition by saga ID)

**Files to modify**: `packages/core/src/persistence/index.ts` (saga persistence), `packages/engine/src/domain.ts`

---

## Summary — Priority Matrix

| Priority | Gap                            | Category    | Effort     |
| -------- | ------------------------------ | ----------- | ---------- |
| **P0**   | Optimistic Concurrency Control | Consistency | Medium     |
| **P0**   | Event Metadata Envelope        | Audit       | Medium     |
| **P0**   | Snapshotting                   | Performance | Medium     |
| **P0**   | Projection Rebuild             | Operations  | Medium     |
| **P1**   | Idempotent Command Processing  | Consistency | Medium     |
| **P1**   | Outbox Pattern                 | Consistency | High       |
| **P1**   | Command Audit Log              | Audit       | Low        |
| **P1**   | Immutable Event Store          | Audit       | Low-Medium |
| **P1**   | Event Store Global Stream      | Operations  | Medium     |
| **P1**   | Health Checks & Observability  | Operations  | Medium     |
| **P1**   | Saga Timeouts                  | Resilience  | Medium     |
| **P1**   | Event Schema Evolution         | Type System | High       |
| **P1**   | Distributed Event Bus          | Distributed | High       |
| **P2**   | Saga Atomicity Guarantees      | Consistency | Medium     |
| **P2**   | Aggregate Caching              | Performance | Low        |
| **P2**   | Async Event Dispatch           | Performance | Low        |
| **P2**   | Graceful Shutdown              | Operations  | Low        |
| **P2**   | Command Retry with Backoff     | Resilience  | Medium     |
| **P2**   | Event Handler Error Isolation  | Resilience  | Low        |
| **P2**   | Typed Persistence Interfaces   | Type System | Low        |
| **P2**   | Decouple Bus Registration      | Type System | Low        |
| **P2**   | Distributed Saga Coordination  | Distributed | High       |

---

## Recommended Implementation Order

**Phase 1 — Minimum Viable Production (P0s)**: ~3-4 weeks

1. Optimistic Concurrency Control
2. Event Metadata Envelope
3. Snapshotting
4. Projection Rebuild

**Phase 2 — Banking Grade (P1 Consistency + Audit)**: ~3-4 weeks 5. Outbox Pattern 6. Idempotent Command Processing 7. Immutable Event Store + Command Audit Log 8. Event Store Global Stream

**Phase 3 — Operational Maturity (P1 Ops + Resilience)**: ~3-4 weeks 9. Health Checks & Observability 10. Saga Timeouts 11. Event Schema Evolution 12. Distributed Event Bus Adapter

**Phase 4 — Polish (P2s)**: ~2-3 weeks 13. Everything else, prioritized by immediate need
