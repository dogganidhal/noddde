---
title: "noddde CLI generators — scaffolded output must compile against the current framework API"
module: cli/generators
source_file: packages/cli/src/generators
status: implemented
exports:
  - generateProject
  - generateDomain
  - generateAggregate
  - generateProjection
  - generateSaga
  - addCommandToAggregate
  - addQueryToProjection
  - addEventHandlerToProjection
depends_on:
  - core/cqrs/query/query-handler
  - core/infrastructure/index
  - core/ddd/saga
  - core/ddd/domain-definition
  - engine/domain
docs:
  - getting-started/cli.mdx
---

# noddde CLI generators

> The CLI scaffolds TypeScript source files from string templates (`packages/cli/src/templates/**`). Templates are not type-checked by the compiler at authoring time — they are plain string interpolation — so nothing stops a template from drifting out of sync with the framework API it targets. This spec pins the contract: **every file a generator produces, combined with every other file produced by the same command, must satisfy `tsc --noEmit` against the real `@noddde/*` packages**, and lists the framework-API alignment rules a template must never violate.

## Type Contract

Generators are `(name: string, basePath: string, ...) => Promise<void>` functions that write files under `basePath` (`add*` generators take a target directory instead of a name and mutate existing files in place via `packages/cli/src/utils/file-modifier.ts`). None of them return the generated source — correctness is only observable by reading the files they write and compiling them.

```ts
export function generateProject(
  name: string,
  basePath: string,
  adapter: PersistenceAdapter,
  eventBus?: EventBusAdapter,
): Promise<void>;

export function generateDomain(name: string, basePath: string): Promise<void>;
export function generateAggregate(
  name: string,
  basePath: string,
): Promise<void>;
export function generateProjection(
  name: string,
  basePath: string,
): Promise<void>;
export function generateSaga(name: string, basePath: string): Promise<void>;

export function addCommandToAggregate(
  commandName: string,
  aggregateDir: string,
  options: { eventName: string },
): Promise<void>;
export function addQueryToProjection(
  queryName: string,
  projectionDir: string,
): Promise<void>;
export function addEventHandlerToProjection(
  eventName: string,
  projectionDir: string,
): Promise<void>;
```

## Behavioral Requirements

1. **`generateProject` produces an installable, buildable package.** `package-json.ts` emits caret ranges anchored to the CLI's own published major version for every `@noddde/*` dependency (never a literal `^0.0.0`, which matches no published version). It does not depend on `@noddde/typescript-config` (a `private: true` package that is never published) — `tsconfig.ts` inlines the compiler options directly instead of extending it.
2. **Query handlers are payload-first.** `QueryHandler`'s first parameter _is_ the query payload (`packages/core/src/cqrs/query/query-handler.ts`), not a `Query` wrapper. `projection-query-handlers.ts` and `templates/add/query.ts` read fields directly off `query` (e.g. `query.id`), never `query.payload.*`.
3. **Every event-bus choice yields a `main.ts` that compiles.** `domainMainTemplate`'s `buses` factory always returns the full `CQRSInfrastructure` triple — `commandBus`, `eventBus`, `queryBus` — regardless of which broker is selected. Only the `eventBus` implementation varies by adapter (`EventEmitterEventBus` / `KafkaEventBus` / `NatsEventBus` / `RabbitMqEventBus`); `commandBus`/`queryBus` are always the in-memory implementations from `@noddde/engine`.
4. **Scaffolded sagas compile immediately, before the user fills in any TODO.** `saga.ts`'s `Def` declares a concrete placeholder event (via `DefineEvents`) so `startedBy` is a non-empty tuple of real event names (`Saga.startedBy: [T["events"]["name"], ...T["events"]["name"][]]`, `packages/core/src/ddd/saga.ts`) — never `startedBy: []`, which violates that type.
5. **Scaffolds use the current, non-deprecated `defineDomain` form.** `domain-wiring.ts`'s domain-definition template calls `defineDomain({ writeModel: {...}, readModel: {...} })` with no explicit generic, and additionally exports `type <Name>Domain = InferDomain<typeof definition>`. The explicit-generic overload is `@deprecated` and disables typed command/query dispatch (`packages/core/src/ddd/domain-definition.ts`).
6. **The generated domain entry is diagram-compatible.** The domain-definition template's exported definition constant is named `definition` (not `<camelName>Domain`), matching what `packages/cli/src/diagram/load-domain.ts` looks for by default, so `noddde diagram` with no arguments reads what `noddde new project` / `noddde new domain` just generated.
7. **`noddde --version` reports the CLI's real published version**, read from the CLI's own `package.json` at runtime — never a hardcoded literal.
8. **Compile coverage has no silent gaps.** For every generator, and for every `EventBusAdapter` choice accepted by `generateProject`, there is an automated test that writes the generated output to disk, resolves `@noddde/*` imports against the real workspace packages (not stubs), and asserts `tsc --noEmit` exits zero. String-containment assertions (`toContain(...)`) may supplement but never replace this check.

## Invariants

- A generator never writes a file whose content, combined with every other file the same invocation writes, fails `tsc --noEmit`.
- A generator never references a package, export, or field that does not exist in the currently-published `@noddde/*` API surface.
- `add*` generators preserve the target file's compileability: after insertion, the modified file still type-checks alongside its unmodified siblings.

## Edge Cases

- **`generateProject` with `eventBus: "event-emitter"`** (the default) needs no extra `@noddde/*` peer package — this is the path most likely to be exercised without any broker running locally, so it must never regress independently of the broker-specific branches.
- **`add-query` / `add-command` / `add-event-handler` run twice for the same name** — idempotency checks (`fileContains`) must short-circuit before any file is (re)written; the compile check only needs to cover the first run.
- **A saga generated by `generateSaga` before any real domain event exists** — the placeholder event in requirement 4 must be self-contained (defined inline in `saga.ts`, no cross-file import), since at scaffold time there is no aggregate to import a real event from.

## Integration Points

- **`@noddde/core`**: `defineDomain`, `defineAggregate`, `defineProjection`, `defineSaga`, `DefineEvents`, `DefineCommands`, `DefineQueries`, `InferDomain`, and the `QueryHandler`/`CQRSInfrastructure`/`Saga` type contracts that every template must match.
- **`@noddde/engine`**: `wireDomain`, `InMemoryCommandBus`, `InMemoryQueryBus`, `EventEmitterEventBus`.
- **`@noddde/kafka` / `@noddde/nats` / `@noddde/rabbitmq`**: broker-specific `EventBus` implementations selected by `generateProject`'s `eventBus` argument.
- **`packages/cli/src/diagram/load-domain.ts`**: consumes the `definition` export produced by the domain-wiring template (requirement 6).

## Test Scenarios

The compile-check harness lives at `packages/cli/src/__tests__/support/compile-project.ts` and symlinks a scaffold's `node_modules` to the monorepo root's (already-built) `node_modules`, so `@noddde/*` resolve to the real workspace packages. Full scenarios are in `packages/cli/src/__tests__/scaffold-compile.test.ts`.

### A freshly scaffolded project compiles for every event-bus choice

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateProject } from "../../generators/project.js";
import {
  linkWorkspaceNodeModules,
  typecheckProject,
} from "./support/compile-project.js";

describe.each(["event-emitter", "kafka", "nats", "rabbitmq"] as const)(
  "generateProject with %s event bus",
  (eventBus) => {
    it("produces a tsc-clean project", async () => {
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-compile-"));
      try {
        await generateProject("Shop", tmpDir, "in-memory", eventBus);
        const projectDir = path.join(tmpDir, "shop");
        await linkWorkspaceNodeModules(projectDir);
        const result = await typecheckProject(projectDir);
        expect(result.ok, result.output).toBe(true);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  },
);
```

### A scaffolded saga compiles with no TODOs filled in

```ts
it("generateSaga output type-checks standalone", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-compile-"));
  try {
    await generateProject("Shop", tmpDir, "in-memory", "event-emitter");
    const projectDir = path.join(tmpDir, "shop");
    const { generateSaga } = await import("../../generators/saga.js");
    await generateSaga(
      "Fulfillment",
      path.join(projectDir, "src", "domain", "process-model"),
    );
    await linkWorkspaceNodeModules(projectDir);
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
```
