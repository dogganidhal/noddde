# noddde Roadmap

Where noddde is headed — what's shipped, what's next, and what's further out.

## Shipped

- [x] **Optimistic concurrency control** — version checks, `ConcurrencyError`, automatic retries
- [x] **Pessimistic concurrency** — advisory locks for PostgreSQL, MySQL, MSSQL
- [x] **Event metadata envelope** — eventId, timestamp, correlationId, causationId, userId, sequenceNumber
- [x] **Correlation propagation** — correlationId flows automatically through saga command chains
- [x] **State snapshotting** — configurable strategies (`everyNEvents`), partial event loading
- [x] **Idempotent command processing** — `commandId` deduplication with TTL-based cleanup
- [x] **Unit of Work** — implicit per-command, explicit multi-command (`withUnitOfWork`)
- [x] **ORM adapters** — Drizzle, Prisma, TypeORM with transaction support and advisory locks
- [x] **Testing toolkit** — `testAggregate`, `testProjection`, `testSaga`, `testDomain` harnesses

## Next: Production Hardening

- [ ] **Projection rebuild** — replay all events through a projection to rebuild or repair read models
- [ ] **Event handler error isolation** — per-handler error catching so one failing handler doesn't block others
- [ ] **Event store global stream** — cross-aggregate ordering with `loadGlobalStream()` for projections and external feeds
- [ ] **Event schema evolution** — upcaster registry for version-based event transforms during replay
- [ ] **Observability hooks** — command latency, event counts, projection lag, OpenTelemetry integration points

## Later: Distributed Systems

- [ ] **Outbox pattern** — persist events to an outbox table within the DB transaction for at-least-once delivery
- [ ] **Distributed event bus** — Kafka or NATS adapter with consumer groups and ordered delivery
- [ ] **Saga timeouts** — configurable timeout with compensation hooks (`onTimeout` handler)
- [ ] **Distributed saga coordination** — instance-level locking to prevent concurrent saga processing
- [ ] **Command audit log** — persist every command with result, duration, and user attribution

## Future

- [ ] **Aggregate caching** — in-memory cache with TTL and write-through invalidation
- [ ] **Async/parallel event dispatch** — configurable parallel handler execution with `Promise.allSettled`
- [ ] **Graceful shutdown** — drain in-flight commands, stop accepting new ones, close connections
- [ ] **Typed persistence interfaces** — eliminate `any` in persistence layer for compile-time safety

## Contributing

Items marked with `[ ]` are open for contribution. Each item will have a corresponding spec in `specs/` before implementation begins — see [specs/README.md](specs/README.md) for the spec format and the `/spec` workflow.

If you're interested in picking something up, open an issue to discuss the approach first.
