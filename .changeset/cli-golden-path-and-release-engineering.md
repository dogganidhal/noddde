---
"@noddde/core": patch
"@noddde/engine": patch
"@noddde/cli": patch
"@noddde/testing": patch
"@noddde/drizzle": patch
"@noddde/prisma": patch
"@noddde/typeorm": patch
"@noddde/rabbitmq": patch
"@noddde/nats": patch
"@noddde/kafka": patch
"@noddde/nestjs": patch
---

Fix the CLI golden path and release-engineering hygiene ahead of GA (#136, #141):

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
