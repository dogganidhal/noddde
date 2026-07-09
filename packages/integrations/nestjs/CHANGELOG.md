# @noddde/nestjs

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
