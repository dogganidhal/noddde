# @noddde/testing

## 1.0.0-rc.2

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

- dc769be: Fix `testDomain`'s command-bus spy silently swallowing every command dispatch error instead of only the intended "no handler registered" case (#140). A `decide` handler's business-rule violation — including one thrown by a saga reaction command — now rethrows to the caller as it would at runtime, and is recorded on two new `DomainSpy` fields: `unhandledCommands` (commands with no registered handler, the only case still suppressed) and `commandErrors` (`{ command, error }` for every other thrown/rejected dispatch). Both fields are additive — existing `publishedEvents`/`dispatchedCommands` are unchanged.
- Updated dependencies [ec58bd0]
- Updated dependencies [525513c]
- Updated dependencies [aed710c]
  - @noddde/core@1.0.0-rc.2
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
- Updated dependencies [9a3e3b7]
- Updated dependencies [40ba3d3]
  - @noddde/core@0.3.9
  - @noddde/engine@0.3.9
