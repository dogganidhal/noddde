# @noddde/nestjs

## 1.0.0-rc.2

### Minor Changes

- bde5a26: Fix `NodddeMetadataInterceptor` metadata propagation and harden the package's public API and dependency shape ahead of GA:

  - **Fix (blocker)**: `intercept()` was resolving `next.handle()`'s Observable inside `domain.withMetadataContext()`, but subscribing to it afterward via `switchMap` — outside the `AsyncLocalStorage` scope. Commands dispatched from a controller behind the interceptor never actually saw the extracted correlation/user ID. The subscription now happens inside the `withMetadataContext` callback, so metadata reaches the handler for the whole request lifecycle.
  - **API change**: `NodddeMetadataInterceptor`'s constructor now requires both the extractor and the `Domain` — the previous optional second parameter threw at class-decoration time when omitted (the documented inline usage never worked). Added `NodddeMetadataInterceptor.withExtractor(extractor)`, a `FactoryProvider` for registering the interceptor per-controller (`@UseInterceptors(NodddeMetadataInterceptor)`) or globally (`{ provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor }`).
  - **Lifecycle**: added `startOutboxRelay` option (default `true`) to `NodddeModuleOptions`/`NodddeModuleAsyncOptions` — the module now starts the outbox relay on bootstrap and stops it before shutdown, matching the docs' claim of no manual lifecycle management.
  - **Packaging**: `rxjs` and `reflect-metadata` are now `peerDependencies` instead of regular dependencies (every NestJS app already provides them, and a duplicate `rxjs` install risks `Observable` identity mismatches). Dropped the unused `@noddde/core` runtime dependency (moved to `devDependencies` — it's only used by tests). `@noddde/engine` now uses a caret range instead of an exact pin.

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

- Updated dependencies [ec58bd0]
- Updated dependencies [525513c]
- Updated dependencies [aed710c]
  - @noddde/engine@1.0.0-rc.2

## 1.0.0-rc.1

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

- Updated dependencies [e03a054]
  - @noddde/core@1.0.0-rc.0
  - @noddde/engine@1.0.0-rc.0

## 0.3.9

### Patch Changes

- 9a3e3b7: build: emit dual CJS + ESM for all packages via tsup
- 40ba3d3: polish(v1): projection handler init refactor + NestJS README + audit annotation
- Updated dependencies [9a3e3b7]
- Updated dependencies [40ba3d3]
  - @noddde/core@0.3.9
  - @noddde/engine@0.3.9
