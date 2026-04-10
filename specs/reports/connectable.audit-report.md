# Audit Report: BrokerResilience maxRetries Field

**Date**: 2026-04-10
**Auditor**: Claude Opus 4.6
**Cycle**: 2 (maxRetries addition to BrokerResilience)
**Specs reviewed**:

- `specs/core/infrastructure/closeable.spec.md` (BrokerResilience.maxRetries field)

**Build Reports reviewed**:

- `specs/reports/connectable.build-report.md`

---

## Verdict: PASS

---

## Phase A: Validation

### A1: Mechanical Checks

| Check                              | Result | Details                                                                                                                                                                                                                        |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `maxRetries?: number` field exists | PASS   | `connectable.ts` line 74: `maxRetries?: number` -- optional number field, exactly as spec mandates                                                                                                                             |
| JSDoc on maxRetries                | PASS   | Lines 65-73: comprehensive JSDoc documenting purpose (delivery attempt limit), adapter mapping (Kafka = consumer-side tracking, NATS = `maxDeliver`, RabbitMQ = delivery count tracking), and default (`undefined` = no limit) |
| Export chain                       | PASS   | `connectable.ts` -> `infrastructure/index.ts` line 7 (`export type { Connectable, BrokerResilience }`) -> root `index.ts` wildcard -> available at `@noddde/core`                                                              |
| Type check: core                   | PASS   | `npx tsc --noEmit` -- 0 errors                                                                                                                                                                                                 |
| Tests: closeable.test.ts           | PASS   | 16/16 tests passed. BrokerResilience test (lines 107-127) verifies `toHaveProperty("maxRetries")`, empty `{}` assignable, full object with `maxRetries: 3` assignable                                                          |
| Stub check                         | PASS   | No stubs or TODO placeholders                                                                                                                                                                                                  |

### A2: Spec-to-Code Traceability

| Spec Requirement                                                    | Implementation                                                                                                                 | Test                                                                                               | Verdict |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------- |
| `maxRetries?: number` field in BrokerResilience                     | `maxRetries?: number` at line 74 of `connectable.ts`                                                                           | `expectTypeOf<BrokerResilience>().toHaveProperty("maxRetries")` and `{ maxRetries: 3 }` assignable | PASS    |
| JSDoc documents adapter mapping                                     | JSDoc lines 65-73 describe Kafka (consumer-side tracking via headers), NATS (`maxDeliver`), RabbitMQ (delivery count tracking) | N/A (JSDoc inspection)                                                                             | PASS    |
| Default: undefined (no limit, legacy behavior)                      | Field is optional with no default value applied                                                                                | Empty `{}` is valid `BrokerResilience`                                                             | PASS    |
| BrokerResilience remains a plain interface with no runtime behavior | No type guard, no default factory, no validation -- pure type                                                                  | N/A (code inspection)                                                                              | PASS    |

### A3: Coherence Review

1. **Field semantics**: The `maxRetries` field name accurately describes its purpose -- limiting delivery attempts per message. The JSDoc clearly distinguishes it from `maxAttempts` (connection-level retries) vs `maxRetries` (message-level delivery limit). **PASS.**

2. **No breaking changes**: Adding an optional field to an existing interface is backward-compatible. Existing code using `BrokerResilience` without `maxRetries` continues to compile. **PASS.**

3. **Consistency with adapter implementations**: The Kafka adapter uses in-memory offset tracking (acceptable consumer-side approach). The NATS adapter maps to `maxDeliver` on JetStream consumer opts. Both approaches match the documented adapter mapping in the JSDoc. **PASS.**

---

## Summary

The `maxRetries?: number` field is correctly added to `BrokerResilience` with proper JSDoc, exports, and test coverage. The field is optional (no breaking change), documents adapter-specific behavior, and is tested via type-level assertions confirming property existence and value assignability. No issues found.
