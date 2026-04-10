# Build Report: BrokerResilience.maxRetries Addition

**Date**: 2026-04-10
**Builder**: Claude Sonnet 4.6
**Spec**: `specs/core/infrastructure/closeable.spec.md`
**Status**: GREEN

---

## Summary

Additive change: the `maxRetries?: number` field was added to the existing `BrokerResilience` interface in `packages/core/src/infrastructure/connectable.ts`. The existing `BrokerResilience` test scenario was updated to assert the new property and include `maxRetries: 3` in the full object literal. No other files required changes.

---

## Files Changed

### Modified Files

- `packages/core/src/infrastructure/connectable.ts` — added `maxRetries?: number` to `BrokerResilience` with full JSDoc
- `packages/core/src/__tests__/infrastructure/closeable.test.ts` — updated `BrokerResilience` describe block to assert `maxRetries` property and include it in the full object literal

---

## Step 2: Tests Updated (RED → GREEN)

Updated existing test scenario:

| Test                                                                    | Change                                                                            | Final State |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------- |
| `BrokerResilience > should have all optional fields with correct types` | Added `toHaveProperty("maxRetries")` assertion and `maxRetries: 3` in full object | GREEN       |

---

## Step 3: Implementation

### `BrokerResilience.maxRetries` Field

Added to `packages/core/src/infrastructure/connectable.ts`:

```ts
/**
 * Maximum number of delivery attempts per message before giving up.
 * When a consumer handler fails repeatedly, this limits redelivery to
 * prevent poison messages from blocking the queue/partition indefinitely.
 * After `maxRetries` delivery attempts, the message is discarded (acked/terminated).
 * Adapter mapping: Kafka = consumer-side tracking via headers,
 * NATS = `maxDeliver` on JetStream consumer, RabbitMQ = delivery count tracking.
 * Default: undefined (no limit — infinite redelivery, legacy behavior).
 */
maxRetries?: number;
```

No exports needed to change — `BrokerResilience` was already fully exported.

---

## Step 4: Test Results

### Core Package

```
Test Files  1 passed (1)
Tests       16 passed (16)
Duration    163ms
```

TypeScript: `npx tsc --noEmit` in `packages/core` — no errors.
Dist rebuild: `npx tsc` in `packages/core` — clean build, updated `.d.ts` emitted.

---

## Requirements Coverage

| Req (Invariant)                  | Description                             | Covered              |
| -------------------------------- | --------------------------------------- | -------------------- |
| BrokerResilience plain interface | No runtime behavior, all optional       | YES (type-only test) |
| `maxAttempts` optional number    | Empty object assignable                 | YES                  |
| `initialDelayMs` optional number | Full object assignable                  | YES                  |
| `maxDelayMs` optional number     | Full object assignable                  | YES                  |
| `maxRetries` optional number     | Full object assignable, property exists | YES                  |

---

## Notes for Auditor

- `maxRetries` is a purely additive optional field on a plain configuration interface — no runtime behavior, no breaking change.
- Semantics: per-message delivery limit (distinct from `maxAttempts` which controls connection retries). JSDoc clearly distinguishes the two.
- No CLI templates needed updating (infrastructure config, not a domain scaffold pattern).
- No other packages or adapters required source changes; the dist rebuild propagates the updated type declaration to downstream adapter packages.
