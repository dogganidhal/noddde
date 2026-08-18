## Audit Report: OutboxRelay

- **Verdict**: PASS
- **Cycle**: 1

### Mechanical Checks

| Check               | Result | Details                                                                                              |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Export coverage     | PASS   | 2/2 (`OutboxRelay`, `OutboxRelayOptions`), re-exported via `packages/engine/src/index.ts:16`         |
| Stubs remaining     | PASS   | 0 (`grep "throw new Error"` on the source: no matches)                                               |
| Type check          | PASS   | `cd packages/engine && npx tsc --noEmit` clean                                                       |
| Tests               | PASS   | 8/8 GREEN (`src/__tests__/engine/outbox-relay.test.ts`), matches Build Report                        |
| Invariants enforced | PASS   | 6/6, including the new "`processOnce()` never rejects"                                               |
| Edge cases covered  | PASS   | 9/9 (the two new ones covered by the new test scenario; `drain()` behavior is documented, unchanged) |
| Scope of diff       | PASS   | Only `outbox-relay.ts` (+3 lines) and its test file (+65 lines) touched by the Builder               |
| Formatting          | PASS   | `prettier --check` clean on source, test, spec, doc page (spec reformatted by the Auditor)           |

### Coherence Review

- **Spec intent alignment**: Requirement 8 is implemented exactly as written. `processOnce()` now has `catch (error) { this.logger?.error("Outbox poll failed.", { error }); return 0; }` around the whole batch body (`packages/engine/src/outbox-relay.ts:118-120`), with the pre-existing `finally { this.processing = false; }` intact at :121-123. Since `loadUnpublished()` is awaited inside that `try`, a rejection is converted to a resolved `0`, so `void this.processOnce()` in `start()`'s `setInterval` (:49-51) can no longer produce an unhandled rejection. The per-entry inner `try/catch` (:100-110) is untouched — dispatch/markPublished failures still log `warn` and leave the entry unpublished. `drain()`'s `do/while` sees the failed poll as `0` and stops, exactly as the new Edge Case documents.
- **Closes the GA blocker**: Yes. Verified the crash vector rather than trusting the test name: the second new test drives the real `start()` → `setInterval` path with `pollIntervalMs: 10` and `advanceTimersByTimeAsync(35)`, not a direct `processOnce()` call. To confirm the assertion is not vacuous, I ran a throwaway probe test with the same harness (fake timers + `process.on("unhandledRejection")` + `void`-ed rejecting async fn and no outer catch): the probe **did** record an unhandled rejection, so the Builder's test genuinely fails without the fix. Probe file deleted after the run.
- **Unhandled scenarios**: None. The only remaining failure surface (`this.logger?.error` itself throwing) is out of contract for `Logger`.
- **Convention compliance**: Compliant. No `console.*`; the new `error` call reuses the existing optional-`Logger` style and the `{ error }` context shape used elsewhere in the file.
- **Breaking change propagation**: N/A — behavior-only widening of the error contract, no signature change.

### Findings (non-blocking, fixed by the Auditor)

1. **[DOC]** The class JSDoc still made the unscoped claim "Provides at-least-once delivery guarantees for domain events", now narrower in the spec's new scope note.

   - **Location**: `packages/engine/src/outbox-relay.ts:19-29`
   - **Fix applied**: appended a short scoping paragraph (marked-published-only-on-resolve, in-process bus caveat, pointer to the spec).

2. **[DOC]** `docs/content/docs/running/outbox-pattern.mdx` claimed at-least-once without the bus caveat and said nothing about transient poll failures.

   - **Location**: `docs/content/docs/running/outbox-pattern.mdx`, "At-Least-Once Delivery" section
   - **Fix applied**: two sentences added (bus-reporting scope, and transient poll failure logged at `error` + retried on the next tick). No restructuring.

3. **[SPEC HYGIENE]** The spec's `docs` frontmatter pointed at `domain-configuration/infrastructure.mdx`, which does not exist; the real page is `running/outbox-pattern.mdx`.

   - **Location**: `specs/engine/outbox-relay.spec.md` frontmatter
   - **Fix applied**: frontmatter now points at `running/outbox-pattern.mdx`.

4. **[SPEC HYGIENE]** Pre-existing (not introduced this cycle): Test Scenario "processOnce skips failed dispatches and continues" still asserted `count === 1` / one entry left unpublished, which contradicts both the spec's own new scope note / Edge Case and the actual (green) test in the repo, where `EventEmitterEventBus` isolates handler errors so both entries are marked published.
   - **Location**: `specs/engine/outbox-relay.spec.md`, Test Scenarios section
   - **Fix applied**: that scenario now mirrors the real test verbatim and is retitled "processOnce is bounded by what the bus reports (in-process bus swallows handler errors)". Behavioral Requirement 2 was left as-is — it is still correct for a bus that rejects.

### Documentation

- **Pages updated**: 1 (`docs/content/docs/running/outbox-pattern.mdx`)
- **Pages created**: 0
- **API reference updated**: 0 (`OutboxRelay` is engine-internal; no public signature changed)

### Notes for the Orchestrator

- Spec `status` flipped `implementing` → `implemented` per the validate-spec outcome.
- The other dirty files in the worktree (`domain.ts`, `projection-rebuild.ts`, the projection-rebuild spec/test, `command-lifecycle-executor.spec.md`) belong to sibling specs, not to this build — verified by inspecting their diffs.
