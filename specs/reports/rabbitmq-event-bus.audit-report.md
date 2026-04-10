# Audit Report: RabbitMqEventBus (messageId + framework logger)

**Spec**: `specs/adapters/rabbitmq/rabbitmq-event-bus.spec.md`
**Auditor**: Claude Opus 4.6
**Date**: 2026-04-10
**Cycle**: 1
**Verdict**: **PASS** (with minor fix applied by Auditor)

---

## Phase A: Validation

### A1: Read Everything

All five artifacts read and cross-referenced:

- Spec: 18 behavioral requirements, 9 invariants, 13 edge cases.
- Source: `rabbitmq-event-bus.ts` (427 lines).
- Tests: `rabbitmq-event-bus.test.ts` (657 lines, 24 tests).
- Build Report: Confirms two fixes (messageId, logger).
- Logger interface: `Logger` from `@noddde/core` -- `data?` parameter is optional.

### A2: Mechanical Checks

| Check               | Result                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Export coverage** | PASS -- `RabbitMqEventBus` + `RabbitMqEventBusConfig` both exported via `index.ts`                                         |
| **Stub check**      | PASS -- only 2 `throw new Error` calls (lines 237, 268): both are intentional guard clauses (closed-state + not-connected) |
| **Console check**   | PASS -- zero `console.*` calls in source                                                                                   |
| **TypeScript**      | PASS -- `tsc --noEmit` zero errors                                                                                         |
| **Tests**           | PASS -- 24/24 green, 300ms                                                                                                 |

### Behavioral Requirement Audit

| #   | Requirement                           | Implemented | Tested   |
| --- | ------------------------------------- | ----------- | -------- |
| 1   | Exchange routing                      | Yes         | Yes      |
| 2   | JSON serialization                    | Yes         | Yes      |
| 3   | Persistent messages + messageId       | Yes         | Yes      |
| 3b  | Publisher confirms                    | Yes         | Yes      |
| 4   | Dispatch before connect throws        | Yes         | Yes      |
| 5   | on registers handlers                 | Yes         | Yes      |
| 6   | Queue binding                         | Yes         | Yes      |
| 7   | Consumer setup                        | Yes         | Yes      |
| 7b  | Poison message protection             | Yes         | Yes      |
| 8   | Parallel handler invocation           | Yes         | Yes      |
| 8b  | maxRetries delivery limit (in-memory) | Yes         | Yes      |
| 9   | Manual ack after handlers (try/catch) | Yes         | Yes      |
| 10  | Prefetch configuration                | Yes         | Yes      |
| 11  | connect with retry + confirm channel  | Yes         | Yes      |
| 11b | Mid-session reconnection              | Yes         | Yes      |
| 12  | connect is idempotent                 | Yes         | Yes      |
| 13  | close closes channel and connection   | Yes         | Yes      |
| 14  | close is idempotent                   | Yes         | Yes      |
| 15  | Handler errors cause nack (try/catch) | Yes         | Yes      |
| 16  | Serialization errors on dispatch      | Yes         | Implicit |
| 17  | Connection errors on dispatch         | Yes         | Yes      |
| 18  | Framework logger (no console.\*)      | Yes         | Yes      |

### Invariant Check

| Invariant                               | Status |
| --------------------------------------- | ------ |
| Events serialized as JSON               | PASS   |
| Handlers receive full Event object      | PASS   |
| Ack only after success; nack on failure | PASS   |
| No deduplication                        | PASS   |
| Exchange durable                        | PASS   |
| Queues durable                          | PASS   |
| Messages persistent                     | PASS   |
| messageId from eventId when available   | PASS   |
| No console.\* calls                     | PASS   |

### Edge Case Coverage

| Edge Case                      | Covered                                            |
| ------------------------------ | -------------------------------------------------- |
| No handler for consumed queue  | Yes                                                |
| Handler throws                 | Yes                                                |
| Dispatch with no payload       | Yes                                                |
| Multiple handlers same event   | Yes                                                |
| on() before connect()          | Yes                                                |
| on() after close()             | Yes                                                |
| Exchange does not exist        | Yes                                                |
| Fanout exchange type           | Config stored, not specifically tested but trivial |
| Dispatch without metadata      | Yes                                                |
| Dispatch with metadata.eventId | Yes                                                |
| No logger provided             | Yes                                                |

### A3: Coherence Review

**Requirement 3 (messageId)**: The `dispatch()` method at lines 274-279 correctly extracts `event.metadata?.eventId` and conditionally includes it in publish options via spread. When metadata is absent, the spread of an empty object means `messageId` is simply not set. The `_setupConsumer` method at lines 379-381 correctly uses `msg.properties.messageId` as the preferred key for delivery counting, falling back to a base64 content hash. The messageId flow is end-to-end correct and benefits the retry counter as expected.

**Requirement 18 (logger)**: After the Auditor's fix, all logger calls include structured context data. Two calls in `_handleUnexpectedClose` (lines 214 and 218) were missing the structured second parameter. The Auditor added `{ url: this._url }` to both. All other logger calls already had structured data (e.g., `{ eventName }`, `{ error: String(err) }`, `{ eventName, maxRetries, count }`).

**Convention compliance**: JSDoc present on all public methods and the class. TypeScript strictness honored (`noUncheckedIndexedAccess` safe via optional chaining). Infrastructure class pattern is appropriate. No decorators, no DI.

---

## Phase B: Documentation

Updated `docs/content/docs/running/event-bus-adapters.mdx`:

1. **Config table**: Added `logger` row with type `Logger`, default `NodddeLogger("warn", "noddde:rabbitmq")`, and description.
2. **Publishing bullet**: Added sentence about `messageId` being set from `event.metadata.eventId` for consumer retry tracking.
3. **Logging bullet**: Added new "Logging" entry to "How It Works" section, consistent with the NATS adapter documentation pattern.
4. **Formatting**: Ran `prettier --write` to fix table alignment.

---

## Auditor Fixes Applied

1. **Source fix** (Req 18 compliance): Added structured context data (`{ url: this._url }`) to two logger calls in `_handleUnexpectedClose` at lines 214 and 218 of `rabbitmq-event-bus.ts`. This brings all logger calls into compliance with the spec requirement that "All log calls pass structured context data as the second parameter."
2. **Doc updates**: Three additions to `event-bus-adapters.mdx` as described above.

---

## Final Verification

- `tsc --noEmit`: PASS (zero errors)
- `vitest run`: PASS (24/24 tests, 300ms)
- `console.*` grep: zero hits
- `prettier --check`: PASS (after auto-format)
