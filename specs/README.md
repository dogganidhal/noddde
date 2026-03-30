# noddde Spec System

Spec-driven development for the noddde framework. Specs are the source of truth for what the framework should do. Claude reads specs and implements code, generates tests, and validates correctness.

## Spec Format

Each spec file uses Markdown with YAML frontmatter:

```markdown
---
title: "Human-readable title"
module: path/relative/to/core/src
source_file: packages/core/src/path/to/file.ts
status: draft | ready | implementing | implemented | superseded
exports:
  - SymbolName1
  - SymbolName2
depends_on:
  - module/path/of/dependency
docs:
  - category/page-name.mdx
---

# Title

> One-paragraph summary of purpose.

## Type Contract

Precise description of every exported type and function signature.

## Behavioral Requirements

Numbered list of behavioral guarantees that constitute the contract.

## Invariants

Things that must ALWAYS or NEVER be true.

## Edge Cases

Boundary conditions and corner cases to handle.

## Integration Points

How this module connects to others.

## Test Scenarios

Vitest-compatible code blocks. Each ### heading becomes one `it()` block.
```

### Optional Sections (added when needed)

- `## Migration` — Added by `/edit-spec` when a breaking change introduces a deprecation. Describes what consumers need to change.
- `## Deprecations` — Tracks deprecated exports and their replacements.

## Spec Lifecycle

```
draft ──→ ready ──→ implementing ──→ implemented
  ↑         │            │               │
  │         │            │               │
  └─────────┴────────────┘               │
        (edit-spec loops back            │
         to ready if type contract       │
         or requirements change)         │
                                         ↓
                                    superseded
                                  (replaced by new spec)
```

| Status         | Meaning                            | Transition trigger                      |
| -------------- | ---------------------------------- | --------------------------------------- |
| `draft`        | Being written, not ready           | Initial creation via `/new-spec`        |
| `ready`        | Reviewed, ready for implementation | Developer approves the spec             |
| `implementing` | Claude is actively implementing    | `/implement-spec` starts work           |
| `implemented`  | Code + tests complete, all passing | `/implement-spec` finishes successfully |
| `superseded`   | Replaced by a newer spec           | New spec created that replaces this one |

**Important**: When `/edit-spec` modifies the type contract or behavioral requirements of an `implemented` spec, the status automatically resets to `ready` — because the implementation no longer matches.

## Directory Structure

`specs/` mirrors the package source directories:

```
specs/
  core/                  ← packages/core/src/
    ddd/                 ← aggregates, projections, sagas
    edd/                 ← events, event bus, handlers
    cqrs/                ← commands, queries, buses, handlers
    infrastructure/
    persistence/         ← persistence interface contracts
  engine/                ← packages/engine/src/
    implementations/     ← in-memory implementations
  integration/           ← end-to-end flow specs
  templates/             ← blank templates for new specs
```

To find the spec for any source file:

- `packages/core/src/<path>.ts` → `specs/core/<path>.spec.md`
- `packages/engine/src/<path>.ts` → `specs/engine/<path>.spec.md`

## Dependency Graph

Specs declare their dependencies via the `depends_on` frontmatter field. This creates a directed acyclic graph:

```
Layer 1 (leaves):     event, command, query, infrastructure
                           ↓
Layer 2 (handlers):   event-bus, event-handler, evolve-handler,
                      command-bus, command-handler, query-bus, query-handler
                           ↓
Layer 3 (definitions): aggregate, projection, saga
                           ↓
Layer 4 (impls):      ee-event-bus, in-memory-command-bus, in-memory-query-bus,
                      in-memory-aggregate-persistence, in-memory-saga-persistence
                           ↓
Layer 5 (engine):     persistence, domain
                           ↓
Layer 6 (integration): command-dispatch-lifecycle, event-projection-flow,
                       saga-orchestration, domain-bootstrap
```

**Implementation order**: Always implement from the leaves up. A spec is only implementable when all its `depends_on` specs are `implemented`.

**Breaking change propagation**: When a spec changes, all specs that transitively depend on it may be affected. The `/edit-spec` skill walks this graph automatically.

## The 6-Step Pipeline

Every change follows a strict RED→GREEN pipeline, driven by a single command:

```
/spec "describe what you want"
```

Claude orchestrates all 6 steps autonomously, only pausing at gate points:

```
  Gate ──→ Step 1: SPEC         Write/edit the spec → developer approves
           Step 2: TEST (RED)   Generate tests, confirm they fail
           Step 3: IMPLEMENT    Write code to make tests pass
  Loop ──→ Step 4: TEST (GREEN) Run tests — loop to step 3 if RED
           Step 5: VALIDATE     Final cross-check
           Step 6: DOCS         Update documentation pages → report
```

**Why RED before GREEN**: Tests are generated (step 2) before the implementation (step 3). This proves they catch missing behavior. You'll see `🔴 8 RED` become `✅ 8 GREEN`.

**Gate points** (where Claude pauses):

- After drafting the spec → "Does this look right?"
- If a breaking change is detected → "How do you want to handle this?"
- If stuck (same test fails 3+ times) → "Here's what's happening, what should I do?"

### Examples

```
/spec "Add a PostgreSQL event store"
  → Claude drafts spec, shows plan → you approve
  → generates 8 RED tests → implements → 8 GREEN → validates → updates docs → done

/spec "Fix: dispatchCommand crashes on empty event arrays"
  → Claude finds domain.spec.md, adds edge case → you approve
  → adds 1 RED test → fixes code → all GREEN → updates docs → done

/spec "Command handlers should also receive the aggregate name"
  → Claude edits aggregate.spec.md → you approve
  → ⚠️ breaking change detected → you choose "deprecate"
  → tests → implement → GREEN → updates docs → done
```

## Writing Specs

### Via `/spec` (recommended)

Just describe what you want. Claude selects the right template, writes the spec, and drives the full pipeline.

### Manually

1. Copy from `specs/templates/` (aggregate, projection, saga, bus, persistence)
2. Fill in frontmatter: `title`, `module`, `source_file`, `status: draft`, `exports`, `depends_on`
3. Write each section
4. Set `status: ready`, then tell Claude to implement it

### Quality Checklist

Before a spec reaches `ready`:

- [ ] Every exported symbol is listed in `exports` frontmatter
- [ ] Type contract has full signatures (not just names)
- [ ] Behavioral requirements are numbered and testable
- [ ] Invariants use "always" or "never" language
- [ ] Edge cases cover empty inputs, error states, boundary values
- [ ] Test scenarios have compilable TypeScript code blocks
- [ ] `depends_on` lists all specs this module consumes types from
- [ ] `docs` lists all documentation pages covering this module (paths relative to `packages/docs/content/docs/`)

## Test Generation

The `## Test Scenarios` section maps directly to vitest test files:

| Spec path                            | Test file path                                               |
| ------------------------------------ | ------------------------------------------------------------ |
| `specs/core/<path>/<name>.spec.md`   | `packages/core/src/__tests__/<path>/<name>.test.ts`          |
| `specs/engine/<path>/<name>.spec.md` | `packages/engine/src/__tests__/engine/<path>/<name>.test.ts` |
| `specs/integration/<name>.spec.md`   | `packages/engine/src/__tests__/integration/<name>.test.ts`   |

- Each `### Heading` becomes one `it("heading", ...)` block
- TypeScript code fences in each subsection are the test body
- `expectTypeOf` for type-level assertions, `expect` for runtime assertions

## Working with Claude

| Command               | Purpose                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `/spec <description>` | Full pipeline: spec → RED tests → implement → GREEN tests → validate → update docs |
| `/spec-status`        | Show all specs and their pipeline position                                         |

That's it. Two commands. Claude handles the rest.

See `CLAUDE.md` at the repo root for the full instruction set, coding conventions, and architecture map.
