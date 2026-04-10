# noddde — Claude Development Guide

## Project Overview

noddde is a TypeScript framework for DDD, CQRS, and Event Sourcing using the functional Decider pattern: no base classes, no decorators — just typed objects and pure functions.

**Current state**: API surface complete, in-memory runtime implemented, 5 sample domains as references. See `docs/ARCHITECTURE.md` for design philosophy, anti-goals, and competitive context.

## Spec Authority Principle

**Specs are the source of truth.** Spec wins for behavioral requirements — fix the code, not the spec. Code wins for type-level details TypeScript enforces — update the spec. Spec-first: always write or update the spec before changing code.

## Monorepo Layout (Turborepo + Yarn)

- `packages/core/` — Types, interfaces, definition functions (`@noddde/core`) — zero runtime deps
- `packages/engine/` — Runtime: Domain orchestration + in-memory implementations (`@noddde/engine`)
- `packages/cli/` — CLI tool for scaffolding aggregates, projections, sagas (`@noddde/cli`)
- `packages/samples/` — 3 reference domains (auction, banking, order-fulfillment)
- `docs/` — Fumadocs documentation site
- `specs/` — Behavioral specs (mirror source directories). See `specs/README.md`

## Architecture

**Core** (`packages/core/src/`): `ddd/` (aggregate, projection, saga), `edd/` (event, event-bus, handlers), `cqrs/` (command/query buses + handlers), `infrastructure/`, `persistence/`. See `index.ts` for exports.

**Engine** (`packages/engine/src/`): `domain.ts` (orchestrator), `implementations/` (in-memory backends for all buses, persistence, snapshots, locking).

**Key patterns**: `*Types` bundles (named type containing state/events/commands/infrastructure), `Define*` mapped type builders, `define*` identity functions for inference, Decider pattern (initialState + decide + evolve), infrastructure as function parameters.

## Spec System

Specs live in `specs/` mirroring source: `packages/core/src/<path>.ts` → `specs/core/<path>.spec.md`.

Sections: Type Contract, Behavioral Requirements (numbered), Invariants, Edge Cases, Integration Points, Test Scenarios (vitest code blocks). See `specs/README.md` for full format documentation.

## The `/spec` Command

Drives the full pipeline: spec → RED tests → implement → GREEN tests → validate → update docs. Details in `.claude/skills/spec/SKILL.md`.

| Command               | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `/spec <description>` | Full 6-step pipeline from description    |
| `/spec-status`        | Show all specs and their pipeline status |

## Multi-Agent Pipeline Architecture

The `/spec` pipeline uses three agent roles. The developer workflow is unchanged — `/spec` remains the single entry point.

| Role             | Model  | Steps              | Responsibility                                                                  |
| ---------------- | ------ | ------------------ | ------------------------------------------------------------------------------- |
| **Orchestrator** | Opus   | 0-1 + coordination | Understand intent, write/edit spec, Gate 1, spawn agents, handle feedback loops |
| **Builder**      | Sonnet | 2-4                | Generate RED tests, implement code, run GREEN tests. Produces Build Report      |
| **Auditor**      | Opus   | 5-6                | Independent validation, coherence review, docs. Produces Audit Report           |

The Builder and Auditor run in **separate agent contexts** — the Auditor has no memory of the Builder's implementation decisions (fresh-eyes review). Communication happens through file artifacts in `specs/reports/`.

**Feedback loop**: If the Auditor FAILs, the Builder re-runs with Audit findings (max 2 cycles). If issues persist or the Auditor raises a CONCERN, the developer decides.

**Skills**: `build-spec/SKILL.md` (Builder), `audit-spec/SKILL.md` (Auditor). Handoff formats: `shared/build-report.md`, `shared/audit-report.md`.

## Coding Conventions

### Style

- Functional: no classes for domain concepts. Classes only for infrastructure.
- Strict TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`, ES2022, NodeNext.
- JSDoc on all public types and functions.
- No decorators, no DI containers, no base classes for domain concepts.
- Never use `console.log`, `console.warn`, or `console.error` in library code. Use the framework `Logger` interface from `@noddde/core` instead. Infrastructure classes should accept an optional `Logger` in their config and default to `NodddeLogger` from `@noddde/engine`.

### Naming

- Events: past tense (`AccountCreated`), Commands: imperative (`CreateAccount`), Queries: Get/List prefix
- Types bundles: `*Types`, Definition functions: `define*`, Inference helpers: `Infer*`

### Handler Signatures

- **Decide** (aggregate): `(command, state, infrastructure) => Event | Event[] | Promise<Event | Event[]>`
- **Evolve**: `(event.payload, state) => newState` — pure, sync, no infrastructure
- **Event**: `(event.payload, infrastructure) => void | Promise<void>` — impure, async OK
- **Saga**: `(event, state, infrastructure & CQRSInfrastructure) => SagaReaction | Promise<SagaReaction>`
- **Query**: `(query.payload, infrastructure) => Result | Promise<Result>`
- **Projection reducer**: `(event, view) => view | Promise<view>` — full event, not just payload

### Persistence

- Two strategies: `EventSourcedAggregatePersistence` (append) and `StateStoredAggregatePersistence` (overwrite)
- Saga persistence is always state-stored
- In-memory uses `Map<string, T>` with composite key `${name}:${id}`

## Test Generation

Spec `## Test Scenarios` → vitest files. Path: `specs/core/<path>.spec.md` → `packages/core/src/__tests__/<path>.test.ts`. Each `### Heading` → one `it()` block. `@noddde/core` for types, `@noddde/engine` for runtime. Full rules in `generate-tests` skill.

## Validation

Before `implemented`: all exports present, all requirements tested, invariants enforced, edge cases covered, `tsc --noEmit` passes, `vitest run` passes, no stubs, docs updated. Full checklist in `validate-spec` skill.

## CLI Template Maintenance

When a spec changes or a new spec is added that affects aggregate, projection, or saga patterns (types, handler signatures, folder structure), reassess whether `packages/cli/` templates need updating. The `/spec` pipeline (step 5) enforces this automatically — see `.claude/skills/spec/SKILL.md`.

## Pre-Push Checklist

**Before every `git push`, run these checks and fix any issues:**

1. **Prettier**: `npx prettier --check "**/*.{ts,tsx,md}"` — fix with `npx prettier --write "**/*.{ts,tsx,md}"`
2. **ESLint**: `yarn lint` (or `npx turbo lint`) — must pass with zero warnings (`--max-warnings 0`)
3. **TypeScript**: `npx tsc --noEmit` in each affected package

Never push code that fails formatting or lint. CI runs `yarn format:check` and `yarn lint` — both must pass.

## Non-Spec Work

For tasks outside the spec pipeline (debugging, CI, docs-only, code review): follow coding conventions above. No spec needed for config changes, CI, or docs-only edits.
