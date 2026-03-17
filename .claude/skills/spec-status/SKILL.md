---
name: spec-status
description: Show the implementation status of all specs in the project, including which pipeline step each is on. Use when asked "what's the status", "which specs are implemented", "what's left to do", "show progress", or for sprint planning.
allowed-tools: Read, Glob, Grep, Bash
---

# Spec Status Report

Scan all specs and report implementation status across the entire project, mapping each to its position in the 5-step pipeline.

## Step 1: Gather Data

Find all spec files:
```bash
find specs/core specs/integration -name "*.spec.md" | sort
```

For each spec, extract:
- `title` from frontmatter
- `status` from frontmatter (`draft` | `ready` | `implementing` | `implemented` | `superseded`)
- `source_file` from frontmatter
- `exports` count
- `depends_on` list

## Step 2: Determine Pipeline Position

For each spec, check what artifacts exist:

| Has spec? | Has tests? | Has impl (no stubs)? | Tests pass? | Pipeline step |
|-----------|-----------|---------------------|-------------|--------------|
| ✅ draft | — | — | — | Step 1 (needs review) |
| ✅ ready | ❌ | — | — | Between step 1-2 (needs `/generate-tests`) |
| ✅ ready | ✅ | ❌ stubs remain | 🔴 failing | Step 2 complete (RED tests, needs `/implement-spec`) |
| ✅ implementing | ✅ | 🔧 partial | 🔴 some fail | Step 3 in progress |
| ✅ implementing | ✅ | ✅ no stubs | ✅ passing | Step 4 complete (needs `/validate-spec`) |
| ✅ implemented | ✅ | ✅ no stubs | ✅ passing | Step 5 complete |

Check for:
- Test file existence at the expected path
- Stubs in source file: `grep "throw new Error" <source-file>`
- This is a lightweight check — don't actually run the full test suite

## Step 3: Build Dependency Order

Using the `depends_on` graph, determine the recommended implementation order:
- Specs with no dependencies (leaves) should be implemented first
- Specs whose dependencies are all `implemented` are ready to implement next
- Specs with unimplemented dependencies are blocked

## Step 4: Report

```
## Spec Status Report

### Pipeline Overview

| Step | Count | Specs |
|------|-------|-------|
| 📝 Step 1 (draft/ready, no tests) | 3 | event, command, query |
| 🔴 Step 2 (tests RED, needs impl) | 2 | aggregate, projection |
| 🔧 Step 3 (implementing) | 1 | saga |
| ✅ Step 4-5 (implemented) | 0 | — |

### Detailed Status

| # | Pipeline | Module | Title | Dependencies |
|---|----------|--------|-------|-------------|
| 1 | 📝 1 | edd/event | Event & DefineEvents | — |
| 2 | 📝 1 | cqrs/command | Command & DefineCommands | edd/event 📝 |
| 3 | 🔴 2 | ddd/aggregate | Aggregate & defineAggregate | edd/event 📝 |
| 4 | 🔧 3 | engine/domain | Domain & configureDomain | ddd/aggregate 🔴 |
| 5 | ✅ 5 | infrastructure | Infrastructure | — |

### Progress

- Total specs: <N>
- 📝 Need tests generated: <N>
- 🔴 Tests RED (awaiting implementation): <N>
- 🔧 Implementing: <N>
- ✅ Complete: <N> (<percent>%)

### Recommended Next Actions

Ready to work on (all dependencies satisfied):
1. `/generate-tests specs/core/edd/event.spec.md` — leaf node, no blockers
2. `/generate-tests specs/core/cqrs/command.spec.md` — depends on event (✅)

Blocked (waiting on dependencies):
1. `specs/core/engine/domain.spec.md` — blocked by: aggregate (🔴), projection (📝)
```

### Pipeline Icons

| Icon | Meaning |
|------|---------|
| 📝 | Step 1: Spec exists, needs tests |
| 🔴 | Step 2: Tests exist and are RED, needs implementation |
| 🔧 | Step 3: Implementation in progress |
| ✅ | Steps 4-5: Tests GREEN, validated |
| ⏭️ | Superseded by newer spec |
