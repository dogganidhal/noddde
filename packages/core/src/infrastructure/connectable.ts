/* eslint-disable no-unused-vars */

/**
 * Interface for infrastructure components that require an explicit
 * async connection step before use (message brokers, databases, etc.).
 *
 * Implementations must ensure `connect()` is idempotent: calling it
 * multiple times has no additional effect after the first call.
 */
export interface Connectable {
  /**
   * Establishes the connection to the external resource.
   * After `connect()` resolves, the component is ready for use.
   * Idempotent: subsequent calls resolve immediately.
   */
  connect(): Promise<void>;
}

/**
 * Runtime type guard for detecting {@link Connectable} implementations.
 * Used by `Domain.init()` to auto-connect buses after the `buses()`
 * factory returns them.
 *
 * @param value - The value to check.
 * @returns `true` if the value is an object with a `connect` function.
 */
export function isConnectable(value: unknown): value is Connectable {
  return (
    typeof value === "object" &&
    value !== null &&
    "connect" in value &&
    typeof (value as Record<string, unknown>).connect === "function"
  );
}

/**
 * Shared retry/resilience configuration for {@link Connectable} infrastructure
 * components (message brokers, databases). Provides a consistent shape
 * across all adapters for connection retry behavior.
 *
 * Each adapter maps these fields to its broker-specific client options.
 * Fields that don't apply to a particular broker are silently ignored.
 */
export interface BrokerResilience {
  /**
   * Maximum number of connection attempts.
   * Use -1 for infinite retries (e.g., NATS default behavior).
   * Adapter-specific defaults vary (Kafka: 6, NATS: -1, RabbitMQ: 3).
   */
  maxAttempts?: number;
  /**
   * Initial delay between retries in milliseconds.
   * For brokers with exponential backoff (Kafka, RabbitMQ), this is the
   * base delay that doubles on each attempt. For brokers with fixed
   * intervals (NATS), this is the constant delay between attempts.
   * Adapter-specific defaults vary (Kafka: 300, NATS: 2000, RabbitMQ: 1000).
   */
  initialDelayMs?: number;
  /**
   * Maximum delay between retries in milliseconds (caps exponential backoff).
   * Ignored by brokers that use fixed intervals (e.g., NATS).
   * Adapter-specific defaults vary (Kafka: 30000, RabbitMQ: 30000).
   */
  maxDelayMs?: number;
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
}
