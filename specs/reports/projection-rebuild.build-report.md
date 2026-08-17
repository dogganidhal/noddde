## Build Report: Projection Rebuild API

- **Spec**: specs/engine/projection-rebuild.spec.md
- **Source**: packages/engine/src/projection-rebuild.ts
- **Tests**: packages/engine/src/**tests**/integration/projection-rebuild.test.ts
- **Result**: GREEN
- **Tests passing**: 14/14
- **Loop count**: 1

### Test Results

| Test                                                                          | Status |
| ----------------------------------------------------------------------------- | ------ |
| rebuildProjection: empty event log                                            | PASS   |
| rebuildProjection: single aggregate replay                                    | PASS   |
| rebuildProjection: truncates stale views                                      | PASS   |
| rebuildProjection: DeleteView during replay                                   | PASS   |
| rebuildProjection: unhandled events are skipped                               | PASS   |
| rebuildProjection: strong-consistency rejection                               | PASS   |
| rebuildProjection: missing EventReader                                        | PASS   |
| rebuildProjection: missing truncate()                                         | PASS   |
| rebuildProjection: unknown projection name                                    | PASS   |
| rebuildProjection: subscriptions detach during replay                         | PASS   |
| rebuildProjection: subscriptions re-attach after replay                       | PASS   |
| rebuildProjection: onProgress callback                                        | PASS   |
| rebuildProjection: upcasting (should upcast stored V1 events before reducing) | PASS   |
| rebuildProjection: type-level name inference                                  | PASS   |

### Concerns

The new Test Scenario's illustrative upcaster chain step in the spec was written as `(event: any) => { ... event.payload.name ... }` (treating the argument as the full event). This does not match the actual `UpcasterMap` step contract (`(payload: V1) => V2`, confirmed by `packages/core/src/edd/upcaster.ts`'s `upcastEvent`, which invokes `chain[i]!(payload)` with the raw payload, and by the existing usage in `command-lifecycle-executor.ts` and the `defineEventUpcasterChain` docs). This caused a `TypeError: Cannot use 'in' operator to search for 'name' in undefined` on the first RED run. Treated as a test-code authoring bug (not a source bug) and fixed by rewriting the single new `it()` block's upcaster step to operate on `payload` directly, consistent with the rest of the codebase. No other test blocks were touched. The Auditor may want to flag this discrepancy back to the spec's example code for a future spec edit.
