# noddde — Claude Development Guide

## Project Overview

noddde is a TypeScript framework for building business applications using Domain-Driven Design (DDD), Command Query Responsibility Segregation (CQRS), and Event Sourcing. It follows the functional **Decider pattern**: no base classes, no decorators — just typed objects and pure functions.

**Current state**: The API surface (types, interfaces, `define*` identity functions) is complete. Runtime implementations are implemented with in-memory backends. Three sample domains exist as usage references.

**Monorepo layout** (Turborepo + Yarn workspaces):

- `packages/core/` — Types, interfaces, and definition functions (`@noddde/core`) — zero runtime dependencies
- `packages/engine/` — Runtime: Domain orchestration + in-memory implementations (`@noddde/engine`) — depends on `@noddde/core`
- `packages/samples/` — 3 sample domains (auction, banking, order-fulfillment)
- `docs/` — Fumadocs documentation site
- `specs/` — Spec-driven development specs (see below)

## Architecture Map

### Core Source Files (`packages/core/src/`)

| File                              | Purpose                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `index.ts`                        | Re-exports all public API                                                                |
| **ddd/**                          |                                                                                          |
| `ddd/aggregate-root.ts`           | `AggregateTypes`, `Aggregate`, `defineAggregate`, `CommandHandler`, `Infer*` types       |
| `ddd/projection.ts`               | `ProjectionTypes`, `Projection`, `defineProjection`, `ReducerMap`, `Infer*` types        |
| `ddd/saga.ts`                     | `SagaTypes`, `Saga`, `defineSaga`, `SagaReaction`, `SagaEventHandler`, `Infer*` types    |
| **edd/**                          |                                                                                          |
| `edd/event.ts`                    | `Event` interface, `DefineEvents` mapped type builder                                    |
| `edd/event-bus.ts`                | `EventBus` interface                                                                     |
| `edd/event-handler.ts`            | `EventHandler` type (impure, async, has infrastructure)                                  |
| `edd/event-sourcing-handler.ts`   | `ApplyHandler` type (pure, sync, no infrastructure)                                      |
| **cqrs/**                         |                                                                                          |
| `cqrs/command/command.ts`         | `Command`, `AggregateCommand`, `StandaloneCommand`, `DefineCommands`                     |
| `cqrs/command/command-bus.ts`     | `CommandBus` interface                                                                   |
| `cqrs/command/command-handler.ts` | `StandaloneCommandHandler` type                                                          |
| `cqrs/query/query.ts`             | `Query`, `QueryResult`, `DefineQueries`                                                  |
| `cqrs/query/query-bus.ts`         | `QueryBus` interface                                                                     |
| `cqrs/query/query-handler.ts`     | `QueryHandler` type                                                                      |
| **infrastructure/**               |                                                                                          |
| `infrastructure/index.ts`         | `Infrastructure` (empty base), `CQRSInfrastructure` (commandBus + eventBus + queryBus)   |
| **persistence/**                  |                                                                                          |
| `persistence/index.ts`            | `StateStoredAggregatePersistence`, `EventSourcedAggregatePersistence`, `SagaPersistence` |
| `persistence/snapshot.ts`         | `Snapshot`, `SnapshotStore`, `SnapshotStrategy`, `PartialEventLoad`, `everyNEvents`      |

### Engine Source Files (`packages/engine/src/`)

| File                                                 | Purpose                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `index.ts`                                           | Re-exports `@noddde/core` + all engine exports                                        |
| `domain.ts`                                          | `Domain` class, `DomainConfiguration`, `configureDomain`                              |
| `implementations/ee-event-bus.ts`                    | `EventEmitterEventBus` (Node.js EventEmitter-backed)                                  |
| `implementations/in-memory-command-bus.ts`           | `InMemoryCommandBus`                                                                  |
| `implementations/in-memory-query-bus.ts`             | `InMemoryQueryBus`                                                                    |
| `implementations/in-memory-aggregate-persistence.ts` | `InMemoryEventSourcedAggregatePersistence`, `InMemoryStateStoredAggregatePersistence` |
| `implementations/in-memory-saga-persistence.ts`      | `InMemorySagaPersistence`                                                             |
| `implementations/in-memory-snapshot-store.ts`        | `InMemorySnapshotStore`                                                               |

### Key Patterns

- **AggregateTypes bundle**: Single named type containing `state`, `events`, `commands`, `infrastructure` instead of 4+ positional generics
- **DefineCommands / DefineEvents / DefineQueries**: Mapped type builders that create discriminated unions from a payload map
- **Identity functions**: `defineAggregate`, `defineProjection`, `defineSaga` are identity functions for type inference
- **Decider pattern**: `initialState` + `commands` (decide) + `apply` (evolve)
- **Infrastructure injection**: Infrastructure passed as function parameters, not via service locators or DI containers

### Sample Domains (`packages/samples/src/`)

| Sample                   | Complexity | Concepts Demonstrated                                                                    |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------- |
| `auction/`               | Simple     | Aggregate, commands, events, infrastructure (Clock)                                      |
| `event-sourced-banking/` | Medium     | Aggregate, projection, queries, infrastructure (Logger, repositories)                    |
| `order-fulfillment/`     | Complex    | 3 aggregates (Order, Payment, Shipping), saga, projection, cross-aggregate orchestration |

## Spec System

Specs live in `specs/` and mirror the package source directories. See `specs/README.md` for the full format documentation.

**Finding a spec**:

- `packages/core/src/<path>.ts` → `specs/core/<path>.spec.md`
- `packages/engine/src/<path>.ts` → `specs/engine/<path>.spec.md`

Example: `packages/core/src/ddd/aggregate-root.ts` → `specs/core/ddd/aggregate.spec.md`

**Spec sections**:

- `## Type Contract` — What types/functions are exported and their signatures
- `## Behavioral Requirements` — Numbered behavioral guarantees (the contract)
- `## Invariants` — Always/never conditions
- `## Edge Cases` — Boundary conditions
- `## Integration Points` — How this module connects to others
- `## Test Scenarios` — Vitest-compatible test code (each `###` = one `it()` block)

## The `/spec` Command

**One command drives everything.** The developer describes what they want, Claude orchestrates the full pipeline:

```
  Step 1: SPEC          → Write/edit the spec (pauses for approval)
  Step 2: TEST (RED)    → Generate tests, confirm they fail
  Step 3: IMPLEMENT     → Write code to make tests pass
  Step 4: TEST (GREEN)  → Run tests — loop back to step 3 if RED
  Step 5: VALIDATE      → Final cross-check
  Step 6: DOCS          → Update documentation pages
```

| Command               | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `/spec <description>` | Full pipeline: describe what you want, Claude handles all 6 steps |
| `/spec-status`        | Show all specs and their pipeline position                        |

### How It Works

1. You describe the change: `"Add a PostgreSQL event store"`, `"Fix the empty event array bug"`, `"Add metadata to events"`
2. Claude **plans step 1** (the spec) and presents it for approval
3. You approve (or give feedback)
4. Claude **executes steps 2→3→4→5→6 autonomously**, looping step 3↔4 if tests fail
5. Claude **pauses only when**:
   - **Breaking change detected** — asks how to handle it
   - **Stuck** — same test fails 3 times, escalates to you
6. Claude presents the final report

### Breaking Change Detection

Detected automatically during step 1. When Claude modifies a type contract, handler signature, or behavioral guarantee:

1. Walks the `depends_on` dependency graph and scans `packages/samples/` for usage
2. Shows the impact radius and asks: make it additive, deprecate, or accept the break
3. If accepted: infers version bump, adds `@deprecated` markers, writes migration notes, flags downstream specs

You never need to think about breaking changes separately — it's part of the flow.

### Gate Points

| Gate                | When                                  | What Claude does                                                       |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| **Spec plan**       | After drafting the spec (step 1)      | Shows type contract summary, requirements, test count → waits for "go" |
| **Breaking change** | If detected during step 1             | Shows impact radius → asks for strategy                                |
| **Stuck loop**      | Step 3↔4 fails 3+ times on same test | Shows error + attempts → asks for guidance                             |

Everything between gates runs without asking.

## Development Workflows

### New Feature

```
/spec "Add a PostgreSQL event store"
  Claude:
    → drafts spec, shows plan → you approve
    → generates 8 tests (RED: 0/8 passing)
    → implements code
    → runs tests (GREEN: 8/8 passing)
    → validates (PASS)
    → updates documentation (2 pages updated)
    → done
```

### Bug Fix

```
/spec "dispatchCommand should handle empty event arrays gracefully"
  Claude:
    → finds the domain.spec.md, adds edge case → you approve
    → regenerates tests (1 new RED test)
    → fixes implementation
    → runs tests (all GREEN)
    → validates
    → updates documentation (1 code example updated)
    → done
```

### Breaking Change

```
/spec "Change command handlers to also receive the aggregate name"
  Claude:
    → edits aggregate.spec.md → you approve the plan
    → ⚠️ breaking change: CommandHandler signature changed
    → shows impact: 3 specs, 3 samples → you choose "deprecate"
    → adds @deprecated, migration notes
    → generates tests → implements → GREEN → validates
    → updates documentation (5 pages updated, deprecation notices added)
    → done
```

### Status Check

```
/spec-status
  → scans all specs
  → shows pipeline positions (📝 step 1, 🔴 step 2, 🔧 step 3, ✅ done)
  → recommends what to work on next
```

## Coding Conventions

### Style

- **Functional style**: No classes for domain concepts (aggregates, projections, sagas). Classes only for infrastructure implementations.
- **Strict TypeScript**: The project uses `strict: true`, `noUncheckedIndexedAccess: true`, target `ES2022`, module `NodeNext`.
- **JSDoc**: All public types and functions must have JSDoc documentation.
- **No decorators, no DI containers, no base classes** for domain concepts.

### Naming

- **Events**: Past tense (`AccountCreated`, `BidPlaced`, `PaymentCompleted`)
- **Commands**: Imperative (`CreateAccount`, `PlaceBid`, `CompletePayment`)
- **Queries**: Get/List prefix (`GetAccountById`, `ListTransactions`)
- **Types bundles**: `*Types` suffix (`AggregateTypes`, `ProjectionTypes`, `SagaTypes`)
- **Definition functions**: `define*` prefix (`defineAggregate`, `defineProjection`, `defineSaga`)
- **Inference helpers**: `Infer*` prefix (`InferAggregateState`, `InferProjectionView`)

### Handler Signatures

- **Command handlers** (aggregate): `(command, state, infrastructure) => Event | Event[] | Promise<Event | Event[]>`
- **Apply handlers**: `(event.payload, state) => newState` — **pure, sync, no infrastructure**
- **Event handlers**: `(event.payload, infrastructure) => void | Promise<void>` — impure, async OK
- **Saga handlers**: `(event, state, infrastructure & CQRSInfrastructure) => SagaReaction | Promise<SagaReaction>`
- **Query handlers**: `(query.payload, infrastructure) => Result | Promise<Result>`
- **Projection reducers**: `(event, view) => view | Promise<view>` — receive full event, not just payload

### Persistence

- Two strategies: `EventSourcedAggregatePersistence` (append events) and `StateStoredAggregatePersistence` (overwrite state)
- Saga persistence is always state-stored
- In-memory implementations use `Map<string, T>` with composite key `${name}:${id}`

## Test Generation Rules

Test files map from spec `## Test Scenarios`:

| Spec Path                                                              | Test File Path                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `specs/core/ddd/aggregate.spec.md`                                     | `packages/core/src/__tests__/ddd/aggregate.test.ts`                                            |
| `specs/engine/implementations/in-memory-aggregate-persistence.spec.md` | `packages/engine/src/__tests__/engine/implementations/in-memory-aggregate-persistence.test.ts` |
| `specs/integration/command-dispatch-lifecycle.spec.md`                 | `packages/engine/src/__tests__/integration/command-dispatch-lifecycle.test.ts`                 |

**Mapping rules**:

- Each `### Heading` in Test Scenarios → `it("heading", async () => { ... })`
- Group tests under `describe("<spec title>", () => { ... })`
- TypeScript code fences are the test body
- Use `import { ... } from "@noddde/core"` for type/definition imports
- Use `import { ... } from "@noddde/engine"` for runtime imports (Domain, configureDomain, InMemory\*, etc.)
- Use `expectTypeOf` from vitest for type-level assertions
- Use `expect` from vitest for runtime assertions

## Validation Checklist

Before marking a spec as `implemented`:

- [ ] All exports listed in frontmatter are present in the source file
- [ ] All behavioral requirements have corresponding test cases
- [ ] All invariants are enforced (via types or runtime checks)
- [ ] All edge cases from the spec have test coverage
- [ ] `npx tsc --noEmit` passes in `packages/core`
- [ ] `CODEARTIFACT_AUTH_TOKEN="" npx vitest run` passes in `packages/core`
- [ ] No `throw new Error("Not implemented")` remains in the source file
- [ ] Documentation pages referencing changed exports are up to date

## Spec Authority Principle

**Specs are the source of truth.** When there's a conflict between a spec and the implementation:

- The **spec wins** for behavioral requirements — fix the code, not the spec
- The **code wins** for type-level details that TypeScript enforces — update the spec to match
- When in doubt, run `/validate-spec` to see exactly where they diverge

**Spec-first development**: Always write or update the spec before changing code. The only exception is exploratory prototyping, which should be followed by a spec before merging.
