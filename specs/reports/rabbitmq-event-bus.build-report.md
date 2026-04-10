## Build Report: RabbitMqEventBus

- **Spec**: specs/adapters/rabbitmq/rabbitmq-event-bus.spec.md
- **Source**: packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts
- **Tests**: packages/adapters/rabbitmq/src/**tests**/rabbitmq-event-bus.test.ts
- **Result**: GREEN
- **Tests passing**: 28/28
- **Loop count**: 2

### Test Results

| Test                                                                                             | Status |
| ------------------------------------------------------------------------------------------------ | ------ |
| should publish event to exchange with event name as routing key                                  | PASS   |
| should set persistent flag on published messages                                                 | PASS   |
| should throw when dispatching before connect                                                     | PASS   |
| should invoke registered handler when event is consumed                                          | PASS   |
| should invoke all handlers concurrently via Promise.all                                          | PASS   |
| should reject if any handler throws during parallel invocation                                   | PASS   |
| should call channel.prefetch with configured prefetchCount                                       | PASS   |
| should retry connection with exponential backoff                                                 | PASS   |
| should close channel and connection on close                                                     | PASS   |
| should not throw when close is called multiple times                                             | PASS   |
| should nack message when handler throws                                                          | PASS   |
| should serialize the full event object including metadata                                        | PASS   |
| should use createConfirmChannel instead of createChannel                                         | PASS   |
| should call waitForConfirms after publish in dispatch                                            | PASS   |
| should ack and skip poison messages that fail deserialization                                    | PASS   |
| should register error and close handlers on connection after connect                             | PASS   |
| should set \_connected=false and attempt reconnect on unexpected close                           | PASS   |
| should track delivery count in memory and discard after maxRetries                               | PASS   |
| should not crash when ack throws on stale channel after successful handler                       | PASS   |
| should not crash when nack throws on stale channel after handler failure                         | PASS   |
| should ack poison messages in \_setupConsumer consumer                                           | PASS   |
| should set messageId from event.metadata.eventId when present                                    | PASS   |
| should not set messageId when event has no metadata                                              | PASS   |
| should use provided logger for warn and error logging with structured data                       | PASS   |
| mid-session reconnection: should retry reconnection indefinitely and stop when close() is called | PASS   |
| mid-session reconnection: should apply jittered exponential backoff during reconnection          | PASS   |
| mid-session reconnection: should stop reconnection immediately when close() is called            | PASS   |
| should reject dispatch calls while reconnection is in progress                                   | PASS   |

### Changes Made

**Implementation** (`packages/adapters/rabbitmq/src/rabbitmq-event-bus.ts`):

1. **Replaced `_handleUnexpectedClose()` delegation**: Previously called `_connectWithRetry()` (bounded by `maxAttempts`). Now calls `_reconnectPersistently()` which runs an unbounded `while (!this._closed)` loop.

2. **Added `_reconnectPersistently()` method**: Indefinitely retries connecting to RabbitMQ using jittered exponential backoff. On each failed attempt, computes `baseDelay = min(initialDelayMs * 2^attempt, maxDelayMs)` and `jitteredDelay = baseDelay * (0.75 + Math.random() * 0.5)`. Checks `_closed` before and after each sleep to exit cleanly when `close()` is called. On success, re-asserts exchange, re-establishes all consumers, resets `attempt` counter.

3. **Fixed `close()` idempotency guard**: Changed from `if (!this._connected) return` to `if (this._closed) return`. The old guard caused `close()` to be a no-op during reconnection (when `_connected === false`), which meant `_closed` was never set to `true` and the reconnection loop would not stop when `close()` was called during active reconnection.

**Tests** (`packages/adapters/rabbitmq/src/__tests__/rabbitmq-event-bus.test.ts`):

4. **Added 4 new test scenarios** from spec requirement 11b in a `describe("mid-session reconnection")` block with `vi.useFakeTimers()` / `vi.useRealTimers()` lifecycle hooks.

5. **Added `beforeEach` mock setup** in the reconnection describe block: sets `amqplib.connect` to always reject with `ECONNREFUSED` — necessary to prevent mock state leakage from earlier tests that configured `amqplib.connect` to succeed with a real-looking mock connection.

### Concerns

- The spec test scenarios as written don't include amqplib mock reset, which would cause flaky tests due to mock state leakage from earlier tests. A `beforeEach` that sets `mockRejectedValue` was added to the reconnection describe block to ensure reliability.
- The jittered backoff uses `Math.random()` which is not mocked by `vi.useFakeTimers()`. The jitter range (±25%) is non-deterministic, but tests use large timer advances that comfortably cover the range.
