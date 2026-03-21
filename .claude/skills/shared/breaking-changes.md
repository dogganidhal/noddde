# Breaking Change Detection & Resolution

Shared procedure used by `new-spec`, `edit-spec`, and the `spec` orchestrator.

## Detection Criteria

A change is **breaking** if ANY of these apply:

1. **Removed or renamed export** from the `exports` list
2. **Changed function signature**: new required params, narrowed types, changed return type
3. **Changed interface shape**: new required field, removed field, narrowed field type
4. **Changed handler signature pattern**: any of the 6 handler types (command, apply, event, saga, query, projection reducer)
5. **Weakened behavioral guarantee** that downstream specs rely on

## Impact Analysis

When a breaking change is detected:

1. **Walk the dependency graph**: Read `depends_on` of ALL specs in `specs/core/` and `specs/integration/`. Build a list of every spec that transitively depends on the changed module.
2. **Check sample domains**: Search `packages/samples/src/` for usage of the affected exports.
3. **Quantify**: Count affected specs and sample files with line numbers.

## Developer Prompt

Present findings and ask:

```
⚠️  Breaking change detected: <what changed>

Impact: <N> downstream specs, <M> sample files
  - <spec-path> (uses <export>)
  - <sample-file>:<line>

Options:
  1. Make it additive (keep old API, add new alongside)
  2. Deprecate old API (@deprecated + migration notes)
  3. Accept the break (version bump required)
  4. Abort (revert the spec change)

Which approach?
```

## Resolution by Option

### Option 1: Additive

- Keep old exports in the type contract
- Add new exports alongside
- Update `exports` frontmatter to include both

### Option 2: Deprecate

- Add `@deprecated` JSDoc to old types in the type contract
- Add `## Migration` section to the spec describing what consumers need to change
- Add `## Deprecations` to the spec frontmatter for tracking

### Option 3: Accept

- List every downstream spec that needs updating
- For each: describe the specific change needed
- Ask developer: "Update all <N> downstream specs now, or flag for manual review?"
- If updating: edit each downstream spec's type contract, requirements, and test scenarios
- **Version inference**: `0.x.y` → breaking changes expected in minor; `>=1.0.0` → major version bump required

### Option 4: Abort

- Revert all changes to the spec
- Confirm to the developer
