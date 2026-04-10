# Build Report: RabbitMqEventBus (messageId + framework logger)

**Spec**: `specs/adapters/rabbitmq/rabbitmq-event-bus.spec.md`
**Builder**: Claude Sonnet 4.6
**Date**: 2026-04-10
**Status**: GREEN — 24/24 tests passing

---

## Changes Made (this iteration)

Two correctness fixes from the spec review (Requirements 3 and 18).

### Fix 1: Stable messageId on publish (Requirement 3)

**File**: `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`

In `dispatch()`, added `messageId` to the publish options when `event.metadata?.eventId` is present:

```ts
const messageId = (event as { metadata?: { eventId?: string } }).metadata
  ?.eventId;
this._channel.publish(this._exchangeName, event.name, body, {
  persistent: true,
  ...(messageId !== undefined ? { messageId } : {}),
});
```

When metadata is absent, `messageId` is omitted (no crash). This gives consumers a stable, globally unique identifier for retry tracking via `msg.properties.messageId`.

### Fix 2: Framework logger replaces console.\* (Requirement 18)

**Files**: `packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`, `packages/adapters/rabbitmq/package.json`, `packages/adapters/rabbitmq/vitest.config.mts`

- Added `logger?: Logger` to `RabbitMqEventBusConfig` (imported from `@noddde/core`).
- Added `private readonly _logger: Logger` field initialized from `config.logger ?? new NodddeLogger("warn", "noddde:rabbitmq")`.
- Added `@noddde/engine` as a dependency in `package.json` and as an alias in `vitest.config.mts` (matching the pattern from the NATS adapter).
- Replaced ALL `console.error`/`console.warn` calls (5 total) with `this._logger.error`/`this._logger.warn` with structured second parameter.
- Zero `console.*` calls remain in the implementation.

---

## Test Changes

### New tests added (3)

- **"should set messageId from event.metadata.eventId when present"** — verifies `publishOptions.messageId === "evt-unique-123"` when metadata is provided.
- **"should not set messageId when event has no metadata"** — verifies `publishOptions.messageId` is `undefined` when no metadata is provided.
- **"should use provided logger for warn and error logging with structured data"** — injects a mock `Logger`, triggers poison message path via invalid JSON, verifies `logger.warn` was called with a string containing `"deserialize"` and `{ eventName: "TestEvent" }` structured data.

---

## Test Results

```
Test Files  1 passed (1)
      Tests  24 passed (24)
   Duration  ~303ms
```

## TypeScript Check

`cd packages/adapters/rabbitmq && npx tsc --noEmit` — passes with zero errors.

## Lint / Format

- `npx prettier --check` — all files pass.
- `npx eslint . --max-warnings 0` — zero warnings.

---

## Requirements Coverage

| Requirement                               | Status                            |
| ----------------------------------------- | --------------------------------- |
| 1. Exchange routing                       | Covered                           |
| 2. JSON serialization                     | Covered                           |
| 3. Persistent messages + stable messageId | Covered (new test this iteration) |
| 3b. Publisher confirms                    | Covered                           |
| 4. Dispatch before connect throws         | Covered                           |
| 5. on registers handlers                  | Covered                           |
| 6. Queue binding                          | Covered                           |
| 7. Consumer setup                         | Covered                           |
| 7b. Poison message protection             | Covered                           |
| 8. Parallel handler invocation            | Covered                           |
| 8b. maxRetries delivery limit (in-memory) | Covered                           |
| 9. Manual ack after handlers (try/catch)  | Covered                           |
| 10. Prefetch configuration                | Covered                           |
| 11. connect with retry + confirm channel  | Covered                           |
| 11b. Mid-session reconnection             | Covered                           |
| 12. connect is idempotent                 | Covered                           |
| 13. close closes channel and connection   | Covered                           |
| 14. close is idempotent                   | Covered                           |
| 15. Handler errors cause nack (try/catch) | Covered                           |
| 16. Serialization errors on dispatch      | Covered                           |
| 17. Connection errors on dispatch         | Covered                           |
| 18. Framework logger (no console.\*)      | Covered (new test this iteration) |
