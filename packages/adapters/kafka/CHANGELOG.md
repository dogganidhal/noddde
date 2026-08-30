# @noddde/kafka

## 1.0.0-rc.2

### Minor Changes

- e0368ab: Fix messaging-adapter blockers surfaced in the GA-readiness audit of `1.0.0-rc.1` (#134, #135): multi-instance delivery, poison-message handling, and default-config safety across Kafka, NATS, and RabbitMQ.

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

### Patch Changes

- ec58bd0: Fix the CLI golden path and release-engineering hygiene ahead of GA (#136, #141):

  - **CLI scaffolds now install and compile.** `noddde new project` no longer pins `@noddde/*` deps at `^0.0.0` (which matched no published version) and no longer depends on the private, unpublished `@noddde/typescript-config` — the generated `tsconfig.json` inlines the base compiler options instead.
  - **Generated query handlers are payload-first**, matching `QueryHandler`'s actual signature (`query.id`, not `query.payload.id`) — fixes `noddde new projection`, `noddde new domain`, and `noddde add query`.
  - **Every event-bus choice compiles.** The Kafka/NATS/RabbitMQ `main.ts` scaffolds now wire the full `CQRSInfrastructure` triple instead of only `eventBus`; the NATS scaffold also supplies the required `consumerGroup`.
  - **`noddde new saga` compiles immediately** — it wires a concrete placeholder event instead of an empty `startedBy: []`, which violated `Saga.startedBy`'s non-empty-tuple type.
  - **Scaffolds use the non-deprecated `defineDomain` form**, exporting `definition` (not `<name>Domain`) plus `InferDomain`-based type — this also makes `noddde diagram`'s default entry path read what `new project`/`new domain` just generated.
  - **`noddde --version` reports the CLI's real version** instead of a hardcoded `0.0.0`.
  - Added a "compile the scaffold" test harness (`packages/cli/src/__tests__/scaffold-compile.test.ts`) that resolves every generator's output against the real, built `@noddde/*` packages and runs `tsc --noEmit` — closing the gap that let the above drift ship green under string-containment-only tests.
  - **Every published tarball now ships its LICENSE file** (verified via `npm pack --dry-run`).
  - **Internal `@noddde/*` dependencies use caret ranges** instead of exact pins, so npm/yarn can dedupe to a single `@noddde/core` install — an exact pin risked a duplicate copy silently breaking `ConcurrencyError`/`DeleteView` identity checks in `@noddde/engine`.
  - **Peer ranges are now honest about what's tested**: `drizzle-orm` (`>=0.30.0 <0.46.0`), `typeorm` (`>=0.3.0 <0.4.0`), and `amqplib` (`>=0.10.0 <0.11.0`) no longer claim compatibility with untested major/minor lines.
  - Added an `engines` field (`node >=22`, matching what CI actually builds against) to every published package.
  - `yarn release` now runs the test suite and re-syncs per-package LICENSE files before `changeset publish`.
  - `@noddde/prisma` no longer ships its integration-test-only Postgres/MySQL Prisma schemas in the published tarball.

- 03e816a: Fix `KafkaEventBus` never redelivering a message after a handler failure. kafkajs's `consumer.run()` only auto-restarts a crashed fetch loop when the crash error is marked `retriable`; handler failures rethrown by `_handleMessage` are plain `Error`s, so the consumer crashed permanently instead of redelivering the uncommitted offset, silently breaking the retry/DLQ mechanism. `_handleMessage` now flags those errors `retriable` before rethrowing, and the consumer is created with `retry.restartOnFailure` always resolving `true`, restoring the documented at-least-once redelivery behavior.
- Updated dependencies [ec58bd0]
- Updated dependencies [525513c]
- Updated dependencies [aed710c]
  - @noddde/core@1.0.0-rc.2
  - @noddde/engine@1.0.0-rc.2

## 1.0.0-rc.1

### Minor Changes

- 264f893: Fix adapter robustness bugs surfaced in `packages/testing-integration/ROBUSTNESS.md` (#102, #103, #112, #115):

  - **Kafka (#115)** — `KafkaEventBus.on()` after `connect()` for a topic that isn't already subscribed now **throws** a clear error instead of firing a never-retried `consumer.subscribe()` and logging a misleading "will be retried" message (kafkajs cannot subscribe on a running consumer, so the subscription was silently lost). Register all handlers before `connect()`; `wireDomain()` already does this. Registering an additional handler for an already-subscribed topic is still allowed.
  - **Prisma (#103)** — advisory locks are session-scoped, but Prisma multiplexes over its connection pool, so `acquire()` and `release()` could run on different sessions and leak the lock. New `PrismaAdvisoryLocker.fromUrl(url, dialect, options?)` owns a client pinned to `connection_limit=1` (guaranteeing session affinity) and implements `Closeable` (`close()` disconnects it; the engine auto-discovers it on shutdown). As a safety net, `release()` now throws an actionable error if it detects that a held lock was released on a different connection (PG `pg_advisory_unlock` → `false`, MySQL `RELEASE_LOCK` → `0`/`NULL`), while a double-release remains an idempotent no-op.
  - **TypeORM (#102)** — on MSSQL, `text` columns map to the legacy codepage-limited `TEXT` type and silently corrupted supplementary-plane Unicode (emoji, etc.) in event payloads. New `createNodddeEntities(dialect)` returns entities whose JSON/text columns use `nvarchar(max)` on MSSQL (and the unchanged default classes elsewhere). The adapter resolves each store by table name, so it works with whichever entity variant you register. MSSQL users must register `createNodddeEntities("mssql")`.
  - **Drizzle (#112)** — **BREAKING (already shipped in `1.0.0-rc.0`):** pg/mysql timestamp columns switched from `mode: "date"` to `mode: "string"`, emitting `YYYY-MM-DD HH:MM:SS.fff` (no `Z`). New regression tests confirm that because `created_at`/`published_at` are native `TIMESTAMPTZ`/`TIMESTAMP(3)` columns, the database parses both the old ISO-with-Z and new space-separated encodings to real timestamps, so `ORDER BY created_at` remains temporal for mixed-format (mid-migration) tables — no read-path normalization is required. See the migration runbook in `packages/adapters/drizzle/README.md`.

- 69b9817: Add `KafkaEventBus.warmup()` / `warmupOnConnect` for Kafka cold-start latency, and a new `EventIdempotencyStore` + `withIdempotency()` primitive (`@noddde/core`) for deduplicating event handler invocations under Kafka/RabbitMQ at-least-once redelivery, with an in-memory implementation in `@noddde/engine` and durable table-backed implementations in `@noddde/typeorm`, `@noddde/drizzle`, and `@noddde/prisma`.

  `@noddde/nats` gets a permanent benchmark test (no API change) documenting that per-subscription inbox-subject memory is negligible at scale — no code change was needed after measuring against a real broker.

### Patch Changes

- Updated dependencies [69b9817]
- Updated dependencies [54a763d]
- Updated dependencies [e6d3e39]
  - @noddde/core@1.0.0-rc.1
  - @noddde/engine@1.0.0-rc.1

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

- 830bcec: Fix dialect-portability and broker bugs in adapter persistence, locking, and event-bus subscriptions surfaced by the new integration test suite:

  - **Drizzle**: pg/mysql timestamp columns now use `mode: "string"` so the persistence layer can pass a portable string format (`YYYY-MM-DD HH:MM:SS.fff`, no `Z`); state-stored and saga `load()` defensively handle pre-parsed jsonb returns from pg; mysql advisory locker probes the multiple result shapes mysql2/drizzle expose and coerces the BIGINT `GET_LOCK` return value; state-stored `save()` now also reads `affectedRows` (mysql2 `ResultSetHeader`) when checking for the optimistic-concurrency conflict.
  - **Prisma**: pg advisory locker uses `$executeRawUnsafe` for the void-returning `pg_advisory_lock`; previously failed with a P2010 deserialize error.
  - **TypeORM**: `NodddeEventEntity.createdAt` / `NodddeOutboxEntryEntity.createdAt` no longer hardcode `type: "datetime"` (SQLite-only) — TypeORM now picks the dialect-native datetime; `NodddeOutboxEntryEntity.publishedAt` uses a text-backed value transformer to work around `Date | null` collapsing to `Object` in TS reflection; mysql advisory locker coerces the BIGINT GET_LOCK result with `Number()`.
  - **NATS**: JetStream push consumers now declare an explicit `deliverTo` inbox per subscription. NATS Server >= 2.10 rejects push consumer creation without one.
  - **Kafka**: `connect()` now waits for the `GROUP_JOIN` event (capped at 30s) before resolving so producers can't publish into a consumer's "not-yet-joined" window — the message would otherwise be lost because the default `fromBeginning: false` starts the offset at "latest" _after_ the publish.

- Updated dependencies [e03a054]
  - @noddde/core@1.0.0-rc.0
  - @noddde/engine@1.0.0-rc.0

## 0.3.9

### Patch Changes

- 9a3e3b7: build: emit dual CJS + ESM for all packages via tsup
- Updated dependencies [9a3e3b7]
- Updated dependencies [40ba3d3]
  - @noddde/core@0.3.9
  - @noddde/engine@0.3.9
