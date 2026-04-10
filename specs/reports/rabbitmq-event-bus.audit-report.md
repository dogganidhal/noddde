## Audit Report: RabbitMqEventBus (persistent reconnection + close guard fix)

- **Verdict**: PASS
- **Cycle**: 1

### Mechanical Checks

| Check               | Result | Details                                                            |
| ------------------- | ------ | ------------------------------------------------------------------ |
| Export coverage     | PASS   | 2/2 exports present (`RabbitMqEventBus`, `RabbitMqEventBusConfig`) |
| Stubs remaining     | PASS   | 0 stubs                                                            |
| Console.\* check    | PASS   | 0 instances of `console.log`, `console.warn`, or `console.error`   |
| Type check          | PASS   | `tsc --noEmit` clean                                               |
| Tests               | PASS   | 28/28 passing (314ms)                                              |
| Invariants enforced | PASS   | 9/9 enforced                                                       |
| Edge cases covered  | PASS   | 13/13 covered                                                      |

### Behavioral Requirement Audit

| Req | Description                                      | Implemented | Tested   |
| --- | ------------------------------------------------ | ----------- | -------- |
| 1   | Exchange routing with event name as routing key  | Yes         | Yes      |
| 2   | JSON serialization of full event                 | Yes         | Yes      |
| 3   | Persistent messages with messageId               | Yes         | Yes      |
| 3b  | Publisher confirms (waitForConfirms)             | Yes         | Yes      |
| 4   | Dispatch before connect throws                   | Yes         | Yes      |
| 5   | on registers handlers by event name              | Yes         | Yes      |
| 6   | Queue binding                                    | Yes         | Yes      |
| 7   | Consumer setup                                   | Yes         | Yes      |
| 7b  | Poison message protection                        | Yes         | Yes      |
| 8   | Parallel handler invocation                      | Yes         | Yes      |
| 8b  | maxRetries delivery limit                        | Yes         | Yes      |
| 9   | Manual ack after handlers (try/catch wrapped)    | Yes         | Yes      |
| 10  | Prefetch configuration                           | Yes         | Yes      |
| 11  | connect with retry and confirm channel           | Yes         | Yes      |
| 11b | Mid-session reconnection (persistent/indefinite) | Yes         | Yes      |
| 12  | connect is idempotent                            | Yes         | Yes      |
| 13  | close closes channel and connection              | Yes         | Yes      |
| 14  | close is idempotent                              | Yes         | Yes      |
| 15  | Handler errors cause nack                        | Yes         | Yes      |
| 16  | Serialization errors on dispatch                 | Yes         | Implicit |
| 17  | Connection errors on dispatch                    | Yes         | Yes      |
| 18  | Framework logger                                 | Yes         | Yes      |

### Coherence Review

- **Spec intent alignment**: The implementation faithfully reflects the spec's revised requirement 11b. Key observations:

  1. **Persistent reconnection**: `_reconnectPersistently()` uses `while (!this._closed)` -- genuinely unbounded. The `resilience.maxAttempts` field is correctly scoped to `_connectWithRetry()` (initial connect) only, as the spec states.

  2. **Jittered exponential backoff**: Formula `baseDelay * (0.75 + Math.random() * 0.5)` produces +-25% jitter around the exponential base delay `min(initialDelayMs * 2^attempt, maxDelayMs)`. This matches the spec exactly.

  3. **Close cancels reconnection**: Two `_closed` checks (before sleep at line 278, after sleep at line 296) plus the loop guard ensure clean exit. The `_handleUnexpectedClose()` guard against re-entrant calls (`if (this._reconnecting) return`) prevents multiple reconnection loops.

  4. **close() guard fix**: Changed from `if (!this._connected) return` to `if (this._closed) return`. The old guard was a genuine bug: during reconnection `_connected === false`, so `close()` would no-op, leaving `_closed` unset and the reconnection loop running indefinitely. The new guard is correct -- `close()` should be idempotent based on whether it was already called, not on connection state.

  5. **Consumer re-establishment**: On successful reconnection, the implementation re-asserts the exchange, re-establishes consumers for all registered handlers, and resets the backoff counter. This matches the spec.

  6. **Dispatch during reconnection**: `dispatch()` checks `!this._connected` which is `false` during reconnection, correctly rejecting with a connection error per the spec.

- **Unhandled scenarios**: None. All spec edge cases (close during reconnection, dispatch during reconnection, broker recovery after extended outage) are handled and tested.

- **Convention compliance**: Compliant.

  - Infrastructure class pattern (appropriate for broker adapter).
  - JSDoc on all public methods and the class.
  - Zero `console.*` calls; all logging via `Logger` interface with structured context data.
  - TypeScript strict mode honored.
  - No decorators, no DI containers.

- **Breaking change propagation**: N/A. No breaking changes -- the public API is unchanged. This is an internal behavioral fix.

### Documentation

- **Pages updated**: 1 (`docs/content/docs/running/event-bus-adapters.mdx`)
  - Updated "Connection resilience" bullet for RabbitMQ section: now describes persistent/indefinite mid-session reconnection with jittered exponential backoff, dispatch rejection during reconnection, and automatic consumer re-establishment after recovery.
  - Updated `resilience.maxAttempts` config table entry: clarified it only governs initial `connect()`, while mid-session reconnection retries indefinitely until `close()`.
  - Updated connection resilience comparison table: RabbitMQ `maxAttempts` row now notes mid-session reconnection is indefinite.
  - Ran `prettier --write` for formatting compliance.
- **Pages created**: 0
- **API reference updated**: 0 (no API reference pages exist for adapters)
