# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) — small markdown files describing version bumps for the packages in this monorepo.

## Adding a changeset

When your PR changes a published package, run:

```bash
yarn changeset
```

You'll be prompted to:

1. Pick which packages changed.
2. Pick the bump type for each (`patch`, `minor`, `major`).
3. Write a short summary — this lands in the package's `CHANGELOG.md`.

Commit the generated `.changeset/<random-name>.md` file along with your code.

## Versioning model

Packages are versioned **independently** — `@noddde/core` and `@noddde/engine` can be on different versions. When an internal dependency bumps (e.g. `core`), changesets automatically bumps dependents (`engine`, `testing`, adapters) by a `patch` and rewrites their `dependencies` field.

Private packages (`samples/*`, `docs`, `@noddde/eslint-config`, `@noddde/typescript-config`) are skipped automatically.

## Release flow

1. Merge feature PRs containing `.changeset/*.md` files into `main`.
2. The `Release` workflow opens or updates a **Version Packages** PR that bumps `package.json` versions, updates `CHANGELOG.md` files, and deletes the consumed changeset files.
3. When you merge that Version Packages PR, the `Release` workflow publishes the changed packages to npm with provenance and pushes per-package git tags (e.g. `@noddde/core@0.2.0`).

## When you don't need a changeset

If your PR only touches `samples/*`, `docs`, CI config, tests, or other non-published files, you don't need a changeset. The Version Packages PR won't include those.
