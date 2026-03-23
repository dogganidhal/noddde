# Contributing to noddde

Thanks for your interest in contributing to noddde! This guide covers everything you need to get started.

## Prerequisites

- Node.js >= 18
- Yarn 1.22+

## Setup

```bash
git clone https://github.com/dogganidhal/noddde.git
cd noddde
yarn install
yarn build
```

## Spec-Driven Development

noddde follows a strict spec-driven development process. **Specs are the source of truth** for all behavioral requirements. Every new feature, behavioral change, or bug fix must start with a spec — and that spec must be reviewed and approved before any implementation begins.

### The Pipeline

All changes follow a 6-step RED-GREEN pipeline:

```
Step 1: SPEC          Write or edit the spec → get it approved
Step 2: TEST (RED)    Generate tests from the spec, confirm they fail
Step 3: IMPLEMENT     Write code to make the tests pass
Step 4: TEST (GREEN)  Run tests — loop back to step 3 if still RED
Step 5: VALIDATE      Cross-check implementation against spec
Step 6: DOCS          Update documentation pages
```

Tests are generated **before** implementation (step 2) to prove they catch missing behavior. You should see failing tests become passing as you implement.

### Writing Specs

Specs live in the `specs/` directory, mirroring the source structure:

- `packages/core/src/<path>.ts` → `specs/core/<path>.spec.md`
- `packages/engine/src/<path>.ts` → `specs/engine/<path>.spec.md`

Each spec includes: Type Contract, Behavioral Requirements, Invariants, Edge Cases, Integration Points, and Test Scenarios. See [`specs/README.md`](specs/README.md) for the full format and quality checklist.

### Approval Gate

**Do not start implementing until your spec is approved.** Open a PR with the spec in `draft` status, get feedback, then set it to `ready` once approved. This ensures alignment before any code is written.

### AI-Assisted Development

This project is configured for AI-assisted development with [Claude Code](https://claude.ai/claude-code). The `CLAUDE.md` file at the repo root contains the full development guide — coding conventions, handler signatures, naming patterns, test generation rules, and validation checklist.

Claude is configured with the `/spec` command to drive the full 6-step pipeline autonomously:

```
/spec "Add a PostgreSQL event store"     # Full pipeline from description
/spec-status                              # Show all specs and their status
```

Claude handles spec creation, test generation, implementation, and validation — pausing at gate points for your approval.

## Development Workflow

1. Create a feature branch from `main`
2. Write or update the spec first (see above)
3. Make your changes following the pipeline
4. Ensure all checks pass before opening a PR

## Code Standards

- **TypeScript**: Strict mode (`strict: true`, `noUncheckedIndexedAccess: true`)
- **Style**: Functional — no classes for domain concepts, no decorators, no DI containers
- **Formatting**: Prettier
- **Linting**: ESLint with zero warnings policy

```bash
yarn format        # Format all files
yarn format:check  # Check formatting
yarn lint          # Run linter across all packages
```

## Testing

Tests use [Vitest](https://vitest.dev/) and are generated from spec test scenarios.

```bash
yarn test          # Run all tests across all packages
```

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add PostgreSQL event store adapter
fix: handle empty event arrays in dispatchCommand
docs: update aggregate definition guide
refactor: simplify saga infrastructure types
```

Pre-commit hooks (Husky + lint-staged) automatically run Prettier and ESLint on staged files.

## Pull Requests

- Keep PRs focused on a single change
- Include the spec PR link if applicable
- Ensure CI passes (build, lint, test)
- Describe the "why", not just the "what"

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
