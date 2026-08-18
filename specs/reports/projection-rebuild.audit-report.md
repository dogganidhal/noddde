## Audit Report: Projection Rebuild API

- **Verdict**: PASS
- **Cycle**: 1

### Mechanical Checks

| Check               | Result | Details                                                                                                                                |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Export coverage     | PASS   | 7/7 spec exports present in `packages/engine/src/projection-rebuild.ts` and re-exported via `packages/engine/src/index.ts`             |
| Stubs remaining     | PASS   | 0 stubs. The 2 `throw new Error` sites (lines 213, 245) are the spec-mandated bus-without-`off` and undeliverable-`viewId` errors      |
| Type check          | PASS   | `cd packages/engine && npx tsc --noEmit` clean                                                                                         |
| Tests               | PASS   | 14/14 GREEN, including the 13 pre-existing scenarios — no silent regression                                                            |
| Invariants enforced | PASS   | 6/6. `eventsRead >= eventsApplied`, `eventsApplied >= viewsDeleted`, `finally` re-attach, validation-before-I/O all verified in source |
| Edge cases covered  | PASS   | 13/13 handled; the 2 new upcasting edge cases are handled and the primary one is tested                                                |
| Lint / format       | PASS   | `eslint --max-warnings 0` clean; `prettier --check` clean on all touched files                                                         |
| Blast radius        | PASS   | No edits in `packages/core/**` or `packages/engine/src/implementations/**` (confirmed via `git status` / `git diff --stat`)            |
| CLI templates       | N/A    | Spec states no template change required; projection definition shape is unchanged                                                      |

### Coherence Review

- **Spec intent alignment**: Requirement 11/11a is implemented as written, not worked around. The table is built once per rebuild call in `Domain.rebuildProjection` (`packages/engine/src/domain.ts:1599-1609`) by one pass over `definition.writeModel.aggregates`, threaded into `RebuildContext.aggregateUpcasters`, and applied per-event by `event.metadata.aggregateName` lookup **before** the `projection.on[event.name]` handler lookup (`packages/engine/src/projection-rebuild.ts:229-237`) — so the reducer, the `id` extractor and the handler lookup all see the upcasted event, exactly as the spec's step ordering requires. Reuse of core's `upcastEvents` means rebuild and the aggregate-replay path cannot drift in semantics.

  The fallback is real, not assumed: an aggregate with no `upcasters` is never inserted into the map, `aggregateUpcasters.get(name)` returns `undefined` for unknown names, and a missing `metadata.aggregateName` short-circuits the lookup entirely — all three land on the unchanged-replay branch. `upcastEvent`'s own `chain`-empty and `storedVersion >= currentVersion` guards give a second layer of pass-through.

  I also checked the version bookkeeping that makes this safe in production, not just in the test: `command-lifecycle-executor.ts:308-319` stamps `metadata.version` via `currentEventVersion` whenever the aggregate declares upcasters, so events written after the schema change are skipped by `upcastEvent` rather than double-upcasted, while pre-change events (version absent → treated as 1) are upcasted. The fix therefore addresses the audited bug — a rebuild after a schema change no longer writes stale-shape payloads into views — rather than passing one test through a technicality.

- **Unhandled scenarios**: None blocking. Live event-bus delivery to projections/sagas still does not upcast; the spec's new Integration Points scope note declares this a known, separate limitation, and it is now documented on both doc pages.

- **Convention compliance**: Compliant. Logger-only (no `console.*`), JSDoc present on the new `RebuildContext.aggregateUpcasters` field, no new public surface, no new core types. The `for await (let event ...)` reassignment is the pragmatic minimal diff and reads clearly.

- **Breaking change propagation**: N/A — no `## Migration` / `## Deprecations` sections; additive behavior fix.

### Documentation

- **Pages updated**: 2
  - `docs/content/docs/read-model/projection-rebuild.mdx` — replay step 4 now notes upcasting; new short `### Upcasting during replay` subsection; new bullet in "What rebuild explicitly does **not** do" recording the live-delivery gap.
  - `docs/content/docs/modeling/event-versioning.mdx` — paragraph in "How It Works" stating that `rebuildProjection` applies the chain before the reducer, and that live delivery does not.
- **Pages created**: 0 (a bug fix to existing behavior does not warrant a new page)
- **API reference updated**: 0 (no signature change)

### Non-blocking notes (for the Orchestrator, not the Builder)

1. **Spec text vs core capability.** Requirement 11 says the handler lookup uses "the possibly-upcasted event's name — an upcaster chain may rename an event across versions". Core's `upcastEvent` returns `{ ...event, payload }` and never rewrites `name`, so cross-version renaming is not actually expressible today. The implementation's ordering is correct regardless; the parenthetical should be dropped or reworded in a future spec edit.
2. **Spec 11a's table type.** The spec states `Map<string, Map<string, EventUpcaster[]>>`; the implementation uses `Map<string, UpcasterMap>` (aggregate name → core's `UpcasterMap` object). Semantically identical, and 11a's own prose sanctions reusing the core shape ("no new core type"). Per the Spec Authority Principle (code wins for type-level details), the spec sentence should be updated to `Map<string, UpcasterMap>`.
3. **Builder's flagged discrepancy is resolved.** The spec's Test Scenario code block now uses `(payload: any) => ...` returning a new payload, which matches both `UpcasterMap`'s `(payload: V1) => V2` step contract in `packages/core/src/edd/upcaster.ts` and the actual test the Builder wrote. Only cosmetic delta remaining: the test file obtains `InMemoryEventSourcedAggregatePersistence` via a dynamic `await import("@noddde/engine")` while the spec block uses a static import — consistent with the sibling EventReader scenario's existing style, no action needed.
4. **Cosmetic.** `upcastEvents([event], upcasters)[0]!` could be core's single-event `upcastEvent(event, upcasters)`. Not grounds for a re-run.
5. **Frontmatter.** Spec `status` is still `implementing` (flip to `implemented`), and the `docs` list names only `read-model/projection-rebuild.mdx` — consider adding `modeling/event-versioning.mdx`, which this audit also updated.
6. The working tree additionally contains unrelated `outbox-relay` changes (separate spec/task); they were out of scope for this audit and were not touched.
