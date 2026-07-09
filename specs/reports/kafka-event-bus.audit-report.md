## Audit Report: KafkaEventBus (warmup feature)

- **Verdict**: PASS
- **Cycle**: 1

### Mechanical Checks

| Check                                     | Result             | Details                                                                                                                                                                          |
| ----------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export: `warmup()` public method          | PASS               | `warmup(): Promise<void>` on `KafkaEventBus` (kafka-event-bus.ts:332).                                                                                                           |
| Export: `warmupOnConnect` config          | PASS               | `KafkaEventBusConfig.warmupOnConnect?: boolean` (kafka-event-bus.ts:52), JSDoc present.                                                                                          |
| Export: `warmupTimeoutMs` config          | PASS               | `KafkaEventBusConfig.warmupTimeoutMs?: number` (kafka-event-bus.ts:57), default 60000, JSDoc present.                                                                            |
| Req 20 — explicit warmup round-trip       | implemented+tested | Admin `createTopics({waitForLeaders:true})` on `__noddde_warmup_${clientId}`, internal handler, 1s-interval dispatch. Test: "create the warmup topic, dispatch, and resolve...". |
| Req 21 — idempotent + concurrent dedupe   | implemented+tested | `_warmedUp` guard + `_warmingUp` in-flight mutex. Test: "not repeat the round-trip on a second call".                                                                            |
| Req 22 — `warmupOnConnect`                | implemented+tested | `await this.warmup()` inside connect IIFE after `_connected=true` (line 240-242). Test: "perform the warmup round-trip during connect...".                                       |
| Req 23 — warmup timeout                   | implemented+tested | `setTimeout` rejects with "...timed out after ${ms}ms..." Test: "reject with a timeout error...".                                                                                |
| Invariant — at most one real round-trip   | PASS               | `_warmedUp` set only after success; guard returns early on repeat (line 337-339). First call not short-circuited.                                                                |
| Edge — warmup() before connect throws     | PASS               | Line 333-335 throws "not connected". Test present.                                                                                                                               |
| Edge — warmup() after close throws        | PASS               | `_closed` checked in same guard (line 333).                                                                                                                                      |
| Edge — concurrent dedupe                  | PASS               | `_warmingUp` returned to second caller (line 343-345).                                                                                                                           |
| Edge — warmupOnConnect propagates failure | PASS               | `await this.warmup()` in IIFE; rejection rejects connect()'s promise (finally only clears `_connecting`).                                                                        |
| Stub check (`throw new Error`)            | PASS               | Only the two legitimate "not connected"/"closed" guards; no TODO stubs.                                                                                                          |
| console.\* check                          | PASS               | No `console.` calls; warmup logging uses `this._logger.warn`.                                                                                                                    |
| `tsc --noEmit`                            | PASS               | Exit 0.                                                                                                                                                                          |
| Unit tests (verbose)                      | PASS               | 29/29 GREEN, incl. all 5 warmup scenarios.                                                                                                                                       |
| Full package suite                        | PASS               | 29/29 GREEN, no regressions.                                                                                                                                                     |
| `eslint --max-warnings 0`                 | PASS               | Exit 0.                                                                                                                                                                          |

### Coherence Review

- **Spec intent alignment**: Strong. `warmup()` genuinely forces a publish/consume round-trip and resolves only when the internal handler observes the event — not a technicality. Timeout path rejects with a real timeout error (message contains "timed out"), does not hang or silently resolve. The idempotency guard checks `_warmedUp` (set post-success) so the FIRST call always runs; only 2nd+ calls short-circuit. `warmupOnConnect` failures propagate through `connect()`'s returned promise (awaited inside the IIFE; `finally` only clears the connect mutex).
- **Unhandled scenarios**: None spec-violating. Note (non-blocking): under `warmupOnConnect: true`, `warmup()` calls `on()` on an already-connected bus, which subscribes after `consumer.run()`. This reuses the same subscribe-after-connect path the spec already establishes in Req 7, so it is spec-conformant and not new risk introduced by this feature. It cannot be exercised without Docker; recommend confirming the integration `beforeAll` completes in CI (builder already flagged this).
- **Convention compliance**: JSDoc on `warmup()`, `warmupOnConnect`, `warmupTimeoutMs`. Functional style, framework `Logger` used, mirrors the existing `_connecting` mutex pattern. The TDZ fix (declaring `intervalId`/`timeoutId` as `let` up front) is sound given the synchronous mock-driven round-trip.

### Integration Test Refactor

`kafka.integration.test.ts` `beforeAll` now warms the broker via `new KafkaEventBus({ warmupOnConnect: true, warmupTimeoutMs: 60_000 })` → `connect()` → `close()`, replacing the manual admin-client + `waitFor` polling loop. Static read confirms the original intent (warm the broker before contract tests, same 60s budget) is preserved. `waitFor` and `Kafka` imports remain used by later tests (partition routing, consumer-group fan-out, maxRetries redelivery, and `prepareTopics`). No unused imports. Not executed (no Docker) — recommend CI verification.

### Documentation

- **Pages updated**: 2
  - `packages/adapters/kafka/README.md` — added warmup bullet to "What's Inside" and a "Cold-start warmup" section documenting `warmup()`, idempotency, timeout, and `warmupOnConnect`.
  - `docs/content/docs/event-bus/kafka.mdx` — added `warmupOnConnect` and `warmupTimeoutMs` rows to the config table and a "Cold-start warmup" section.
  - Verified `docs/.../running/infrastructure.mdx` and `event-bus-adapters.mdx` reference Kafka only generally (no config-field tables) — no staleness introduced.
  - Prettier clean on both edited files.
