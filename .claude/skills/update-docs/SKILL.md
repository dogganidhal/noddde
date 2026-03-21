---
name: update-docs
description: "Internal procedure for Step 6. Use /spec instead — it orchestrates the full pipeline. This skill contains detailed instructions for updating documentation pages after a spec is implemented or updated."
user-invocable: false
model: sonnet
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Step 6: Update Documentation

Update documentation pages to reflect the spec changes. Docs must stay in sync with the implementation.

**Pipeline step 6 of 6.** Called by the `/spec` orchestrator after step 5 (validation).

**Why this step exists**: Code and tests can be perfect while documentation silently drifts — stale code examples, undocumented exports, behavioral changes not reflected in guides. This step catches that.

## Step 1: Find Spec and Identify Changed Exports

Accept either a spec path or source file path:

- Spec → source: read `source_file` from frontmatter
- Source → spec: replace `packages/core/src/` with `specs/core/`, `.ts` with `.spec.md`

Read the spec completely. Extract:

- The `exports` list from frontmatter
- The `docs` list from frontmatter (if present)
- All behavioral requirements (numbered items in `## Behavioral Requirements`)
- Any `## Migration` or `## Deprecations` sections

Determine what changed by comparing against the previous state:

- **New spec**: Everything is new — all exports need documentation
- **Edited spec**: Identify which exports were added, removed, or had their signatures changed; which behavioral requirements were added or modified

## Step 2: Identify Affected Documentation Pages

Use three strategies in order of priority:

### Strategy 1: Frontmatter `docs` field (primary)

Read the spec's `docs` frontmatter field. These are explicitly mapped documentation pages.

```yaml
docs:
  - aggregates/overview.mdx
  - aggregates/defining-aggregates.mdx
```

These paths are relative to `docs/content/docs/`.

### Strategy 2: Grep for export references (secondary)

Search for references to the spec's exported symbols in documentation:

```bash
grep -rl "ExportName1\|ExportName2" docs/content/docs/ --include="*.mdx"
```

This catches pages not listed in the `docs` frontmatter — for example, a `concepts/` or `design-decisions/` page that references `defineAggregate`.

Add any discovered pages NOT already in the `docs` list to the working set, but mark them as "discovered" (handle with more caution — they may only mention the export in passing).

### Strategy 3: Check auto-generated API reference

Search `docs/src/content/docs/api/` for files matching the spec's exports:

```bash
ls docs/src/content/docs/api/*/
```

**Do NOT edit auto-generated API reference files.** Only flag them in the report if the API surface changed (new exports added, existing signatures changed).

## Step 3: Classify Documentation Impact

For each affected page, determine the type of update needed:

| What Changed in the Spec             | Documentation Action                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| New export added                     | Add documentation for the new export; create new page if it's a major feature |
| Type/function signature changed      | Update code examples showing the old signature                                |
| Behavioral requirement added/changed | Update explanatory text describing the behavior                               |
| Entirely new spec (new module)       | Create stub documentation page(s) in the appropriate category                 |
| Handler signature pattern changed    | Update all code examples using the handler                                    |
| Deprecation introduced               | Add deprecation notice/callout near deprecated API usage                      |
| Export removed                       | Remove or update references to the removed export                             |

## Step 4: Update Existing Documentation Pages

For each affected page, apply **surgical, targeted updates**:

### 4a: Update Code Examples

1. Read the full MDX page
2. Find all TypeScript/JavaScript code blocks that import from `@noddde/core`
3. Check if those code blocks use any of the changed exports
4. Update the code to reflect the new API signatures

**Rules for code example updates**:

- Code examples must compile against the new API
- Preserve the example's intent and teaching purpose
- If the example used a removed export, replace it with the recommended alternative
- If a new required parameter was added, show it with a sensible default value
- Keep examples minimal — don't add complexity just because the API grew

### 4b: Update Explanatory Text

Only update prose if a **behavioral requirement changed**. Do NOT rewrite text just because an export was renamed.

When updating prose:

- Preserve the author's voice and writing style
- Update only the specific sentences/paragraphs affected by the behavioral change
- If a capability was added, add a brief mention in the relevant section
- If behavior was removed or changed, update the description to match

### 4c: Add Deprecation Notices

If the spec introduced deprecations (via `## Deprecations` or `@deprecated` markers):

1. Find doc pages that show usage of the deprecated API
2. Add a callout/admonition near the first usage:
   ```mdx
   <Callout type="warn">
     `OldExportName` is deprecated and will be removed in a future version. Use
     `NewExportName` instead. See the [migration guide](/docs/migration).
   </Callout>
   ```
3. Update the code example to show the new API, with the old API shown as a comment or in a "Before/After" comparison

### 4d: Preservation Rules

- **Never** rewrite an entire page — only touch what's affected by the spec change
- **Never** change a page's frontmatter (title, description) unless it's factually wrong
- **Never** remove sections or restructure a page — only update content within existing sections
- **Always** preserve formatting, heading levels, and page organization
- If unsure whether prose needs updating, **flag it in the report** rather than making a risky edit

## Step 5: Create New Documentation Pages (New Specs Only)

When the spec is **entirely new** (a new module, not an edit to an existing spec), create documentation:

### 5a: Determine the Documentation Category

Map from module path to docs category:

| Module Path Pattern        | Docs Category           |
| -------------------------- | ----------------------- |
| `ddd/aggregate*`           | `aggregates/`           |
| `ddd/projection*`          | `projections/`          |
| `ddd/saga*`                | `sagas/`                |
| `edd/event*`               | `events/`               |
| `cqrs/command*`            | `commands/`             |
| `cqrs/query*`              | `queries/`              |
| `engine/implementations/*` | `infrastructure/`       |
| `engine/*`                 | `domain-configuration/` |
| `infrastructure/*`         | `infrastructure/`       |

If the module doesn't fit any category, flag it in the report for manual placement.

### 5b: Create the MDX Page

Create a new file at `docs/content/docs/<category>/<name>.mdx`:

```mdx
---
title: <Human-readable title>
description: <One-line description of what this module does>
---

## What is <Name>?

<2-3 sentences explaining the concept and its role in the framework.>

## Basic Usage

<Code example derived from the spec's Test Scenarios section. Pick the simplest, most representative example.>

## Key Behaviors

<Brief list derived from the spec's Behavioral Requirements. Keep it concise — the spec has the full details.>
```

### 5c: Update `meta.json`

Add the new page to the appropriate category's `meta.json` file at `docs/content/docs/<category>/meta.json`.

Read the existing `meta.json`, add the new page name (without extension) to the `pages` array in a logical position (usually at the end, unless there's a clear ordering).

## Step 6: Flag API Reference Changes

If the spec added new exports, removed exports, or changed existing signatures:

1. List the affected auto-generated API pages in `docs/src/content/docs/api/`
2. Note these in the report as needing regeneration
3. **Do NOT manually edit these files** — they are auto-generated

## Step 7: Documentation Update Report

```
📖 Step 6 complete: Documentation updated

  Pages updated: <N>
    - docs/content/docs/<path>.mdx (<summary of changes>)
    - docs/content/docs/<path>.mdx (<summary of changes>)

  Pages created: <N>
    - docs/content/docs/<category>/<name>.mdx (new stub)

  API reference: <status>
    - <N> auto-generated pages may need regeneration (exports changed: <list>)
    — OR —
    - No API surface changes — auto-generated docs are up to date

  Flagged for review: <N>
    - docs/content/docs/<path>.mdx (prose may need updating — <reason>)

  No changes needed: <N> pages checked, all up to date
```

### If no documentation updates are needed

This can happen when:

- The spec change was purely internal (implementation detail, no API surface change)
- All affected documentation pages are already up to date
- The spec has no `docs` frontmatter and grep found no references

Report:

```
📖 Step 6 complete: No documentation updates needed
  Reason: <why — e.g., "Internal implementation change, no API surface affected">
```
