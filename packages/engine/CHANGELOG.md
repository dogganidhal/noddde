# @noddde/engine

## 1.0.0-rc.1

### Minor Changes

- 69b9817: Add `KafkaEventBus.warmup()` / `warmupOnConnect` for Kafka cold-start latency, and a new `EventIdempotencyStore` + `withIdempotency()` primitive (`@noddde/core`) for deduplicating event handler invocations under Kafka/RabbitMQ at-least-once redelivery, with an in-memory implementation in `@noddde/engine` and durable table-backed implementations in `@noddde/typeorm`, `@noddde/drizzle`, and `@noddde/prisma`.

  `@noddde/nats` gets a permanent benchmark test (no API change) documenting that per-subscription inbox-subject memory is negligible at scale — no code change was needed after measuring against a real broker.

- e6d3e39: `SagaExecutor` now honors a per-saga `atomicity` mode (`saga.atomicity ?? "atomic"`):

  - **`atomic`** (default) — unchanged: the saga's unit of work spans the saga-state save and all reaction commands, so they commit or roll back together.
  - **`best-effort`** — commits the saga state first, then dispatches reaction commands outside that unit of work (each command obtains its own UoW via `CommandLifecycleExecutor`). Command handlers that publish events directly through the event bus — and the re-entrant saga executions they trigger — therefore observe the committed saga state, fixing the silent event loss in issue #119. Trade-off: a reaction-command failure no longer rolls back the saga-state transition.

  Sagas that do not set `atomicity` keep their current transactional behavior.

### Patch Changes

- Updated dependencies [69b9817]
- Updated dependencies [54a763d]
  - @noddde/core@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- e03a054: First release candidate for v1.0.0.

  This kicks off the pre-release cycle ahead of the stable v1.0.0 release. The public API surface is now considered stable; subsequent `rc` builds will focus on stabilization, documentation, and adapter robustness based on community feedback.

  Highlights since 0.3.9:

  - **Adapters** — pg/mysql portability fixes across Drizzle/Prisma/TypeORM (timestamp encoding, advisory-lock return shapes, optimistic-concurrency detection on mysql2). NATS push consumers now declare an explicit `deliverTo` inbox (required by NATS Server >= 2.10). Kafka `connect()` waits for `GROUP_JOIN` so producers can't publish into the consumer's not-yet-joined window.
  - **Build output** — all packages now ship dual CJS and ESM bundles.
  - **Type system** — stress-tested across core and engine; results captured in `specs/reports/type-perf.md`.
  - **Docs** — full pre-GA audit pass across the documentation site (API drift, naming, broken links, structure).
  - **Integration testing** — adapter integration test suite with testcontainers + path-filtered CI lane.

### Patch Changes

- Updated dependencies [e03a054]
  - @noddde/core@1.0.0-rc.0

## 0.3.9

### Patch Changes

- 9a3e3b7: build: emit dual CJS + ESM for all packages via tsup
- 40ba3d3: polish(v1): projection handler init refactor + NestJS README + audit annotation
- Updated dependencies [9a3e3b7]
  - @noddde/core@0.3.9
