---
name: implement-spec
description: "Internal procedure for Step 3. Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for implementing a spec (code only, no test generation)."
user-invocable: false
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# Step 3: Implement the Spec (Code Only)

Turn a behavioral specification into working code. Tests already exist and are RED — your job is to make them GREEN.

This is **step 3** of the 6-step pipeline:

```
  1. /new-spec or /edit-spec    ✅ Done
  2. /generate-tests            ✅ Done (tests are RED)
→ 3. /implement-spec            Write the implementation code
  4. /run-tests                  Run tests (GREEN)
  5. /validate-spec              Cross-check
  6. /update-docs                Update documentation
```

**Key principle**: This step writes ONLY implementation code. It does NOT generate tests — that was step 2. If tests don't exist yet, stop and tell the developer to run `/generate-tests` first.

## Step 1: Verify Prerequisites

1. **Read the spec** at the provided path
2. Check `status` is `ready` or `implementing` — if `draft`, ask the developer to promote it first
3. **Check that tests exist**: Look for the test file at the expected path:
   - `specs/core/<path>/<name>.spec.md` → `packages/core/src/__tests__/<path>/<name>.test.ts`
   - `specs/integration/<name>.spec.md` → `packages/core/src/__tests__/integration/<name>.test.ts`
4. **If tests don't exist**: STOP. Tell the developer:
   ```
   ⚠️  No test file found at <expected-path>.
   Tests must be generated before implementation (RED-GREEN workflow).
   Run `/generate-tests <spec-path>` first.
   ```

## Step 2: Read Everything

1. **Read the spec** completely — all sections
2. **Read the source file** at `source_file` from frontmatter
3. **Read the existing test file** — understand what the tests expect
4. **Read dependency specs** listed in `depends_on` — understand input types and contracts
5. **Read dependency source files** — understand what's already implemented
6. **Read sample usage** if relevant — search `packages/samples/src/` for usage of the module

## Step 3: Set Status

Update the spec frontmatter: `status: implementing`

## Step 4: Implement

Replace `throw new Error("Not implemented")` stubs with working code.

**Order**: Implement behavioral requirements in their numbered order. Each requirement should be satisfiable independently.

**Follow these conventions** (from CLAUDE.md):

- Functional style: no classes for domain concepts
- Strict TypeScript: `strict: true`, `noUncheckedIndexedAccess: true`
- JSDoc on all public exports
- No decorators, no DI containers, no base classes for domain concepts
- Handler signatures must match exactly:
  - Command handlers: `(command, state, infrastructure) => Event | Event[] | Promise<Event | Event[]>`
  - Apply handlers: `(event.payload, state) => newState` — pure, sync
  - Event handlers: `(event.payload, infrastructure) => void | Promise<void>`
  - Saga handlers: `(event, state, infrastructure & CQRSInfrastructure) => SagaReaction | Promise<SagaReaction>`
  - Query handlers: `(query.payload, infrastructure) => Result | Promise<Result>`
  - Projection reducers: `(event, view) => view | Promise<view>`

**For each behavioral requirement**:

1. Read the requirement
2. Implement it
3. Check: does the implementation satisfy the invariants?
4. Check: does it handle the edge cases mentioned in the spec?

**Do NOT modify the test file.** If a test seems wrong, flag it — but the spec (and its tests) are the authority. Fix the code, not the tests.

## Step 5: Type Check

Run the type checker:

```bash
cd packages/core && npx tsc --noEmit
```

- If errors in the implementation: fix the implementation
- If errors in the test file (because the implementation changed types): this suggests the spec's type contract may need updating — flag for the developer, do not silently change tests

## Step 6: Summary

```
✅ Implementation complete: <source-file>

From spec: <spec-path>
Behavioral requirements implemented: <N>/<N>
Remaining stubs: <none | list>
Type check: ✅ passing / ❌ N errors

Next step:
  Run `/run-tests <spec-path>` to verify tests are now GREEN.
```
