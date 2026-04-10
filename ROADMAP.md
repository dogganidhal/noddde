# noddde Roadmap

Where noddde is headed: what is shipped, what is required for v1.0, and our vision for distributed TypeScript domains.

**Current Status:** Pre-1.0. The core Decider pattern, type-inference engine, persistence adapters, distributed event buses, and observability are all shipped. We are currently focused on error isolation and developer ergonomics ahead of our v1.0 Release Candidate.

---

## Shipped (Core Architecture Complete)

- [x] **The Decider Engine:** Pure functional aggregates, projections, and sagas.
- [x] **Event Metadata Envelope** — Structured eventId, timestamp, correlationId, causationId, userId, and sequenceNumber on every event.
- [x] **Correlation & Causation Propagation** — correlationId flows automatically through saga command chains; causationId links each event to its triggering command or event.
- [x] **Unit of Work** — Implicit per-command and explicit multi-command (`withUnitOfWork`) atomic commits across stores.
- [x] **Optimistic & Pessimistic Concurrency:** Version checks and advisory locks (PG/MySQL).
- [x] **Event Versioning (Upcasters):** Type-safe historical payload transformations.
- [x] **Transactional Outbox Pattern:** At-least-once delivery tied to Unit of Work.
- [x] **Idempotent Command Processing:** Command deduplication with TTL cleanup.
- [x] **State Snapshotting:** Configurable strategies (e.g., every N events).
- [x] **ORM Adapters:** Drizzle, Prisma, and TypeORM with UoW transaction support.
- [x] **Testing Toolkit:** Type-safe Given-When-Then test harnesses (`@noddde/testing`).
- [x] **Observability & OpenTelemetry (OTel):** Native OTel trace context propagation spanning the full asynchronous lifecycle: API -> Command Bus -> Aggregate -> Event Bus -> Saga -> Read Model. Zero required configuration — auto-detects `@opentelemetry/api` at runtime.
- [x] **Distributed Event Bus Adapters:** Official adapters for RabbitMQ (`@noddde/rabbitmq`), NATS (`@noddde/nats`), and Kafka (`@noddde/kafka`) with consumer group support, at-least-once delivery, manual acknowledgment, and configurable retry policies.

---

## Next: The v1.0 Release Candidate (Reliability & DX)

_These items must be completed to guarantee state consistency and developer ergonomics before we stamp v1.0._

- [x] **Graceful Shutdown & Connection Draining**
  - `Domain.shutdown()` drains in-flight commands, waits for active Sagas/Outbox relays to finish, and auto-closes infrastructure implementing `Closeable`.
- [ ] **Projection & Handler Error Isolation**
  - Granular error boundaries so a single failing read-model reducer does not crash the event bus or block other successful projections.
- [x] **The CLI & "Golden Path" Scaffolding**
  - `@noddde/cli` with 5 commands: `new project`, `new domain`, `new aggregate`, `new projection`, `new saga`. Project-aware generators auto-place files in the correct layered structure. Extracted handlers (command-handlers, query-handlers, view-reducers, transition-handlers) keep files focused as domains grow.
- [ ] **Type System Stress Testing**
  - Formal benchmarks for the type inference bundles to ensure IDE performance and TS compilation remain instant even with large domains.
- [ ] **Projection Rebuild API**
  - A standardized utility to truncate a read-model and safely replay the entire event store through a specific projection.

---

## Later: Distributed Systems & Scale (v1.x)

_Features required for deploying noddde across multi-node, high-throughput microservice environments._

- [ ] **Advanced Outbox Management**
  - Add poison pill detection, exponential backoff, and Dead Letter Queues (DLQ) to the Outbox Relay to handle downstream event bus outages.
  - Optimize ORM outbox polling with `SKIP LOCKED` to prevent contention in multi-node deployments.
- [ ] **Saga Timeouts & Compensation Hooks**
  - Native timeout handlers for process managers to trigger compensating commands if a distributed workflow stalls.
- [ ] **Global Event Stream**
  - Cross-aggregate ordering support, enabling global feeds and third-party data lake ingestion.

---

## Future: Ecosystem Integrations

- [ ] **Framework Integrations**
  - Optional `@noddde/nestjs` and `@noddde/fastify` plugins to drastically reduce setup boilerplate in existing web applications.
- [ ] **Aggregate Write-Through Caching**
  - In-memory/Redis caching layers with automatic invalidation to bypass database rehydration for high-throughput aggregates.
- [ ] **Command Audit Log**
  - Standardized persistence of every command, its execution duration, and the user/correlation IDs that triggered it.

---

## Contributing

We build `noddde` using a strict spec-driven development pipeline.

Items marked with `[ ]` are open for contribution. Each item must have a corresponding spec in the `specs/` directory before implementation begins. See [specs/README.md](./specs/README.md) and our [CLAUDE.md](./CLAUDE.md) for details on our workflow.

If you are interested in picking something up, please open an issue to discuss the architectural approach first.
