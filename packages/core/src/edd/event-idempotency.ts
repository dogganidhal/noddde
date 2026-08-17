import type { Event } from "./event";
import type { EventHandler } from "./event-handler";
import type { Infrastructure } from "../infrastructure";

/**
 * Storage interface for tracking which event-handler dedup keys have
 * already been processed. Used by {@link withIdempotency} to skip
 * redelivered events under at-least-once delivery semantics (Kafka,
 * RabbitMQ).
 *
 * Distinct from `IdempotencyStore` (`core/persistence/idempotency`), which
 * deduplicates command dispatch. This store deduplicates event handler
 * invocations and has no aggregate/Unit-of-Work coupling.
 */
export interface EventIdempotencyStore {
  /**
   * Checks whether the given key has already been recorded as processed.
   * Returns `true` if a non-expired record exists, `false` otherwise.
   *
   * @param key - The dedup key to check.
   */
  hasProcessed(key: string): Promise<boolean>;

  /**
   * Records the given key as processed. Idempotent: recording the same
   * key twice has no additional observable effect.
   *
   * @param key - The dedup key to record.
   */
  markProcessed(key: string): Promise<void>;

  /**
   * Removes all records older than `ttlMs`. An operational/maintenance
   * method — never called automatically by {@link withIdempotency}.
   * Callers that need bounded storage growth should invoke this
   * periodically (e.g. from a cron job or background process).
   *
   * @param ttlMs - The time-to-live in milliseconds.
   */
  removeExpired(ttlMs: number): Promise<void>;
}

/** Options for {@link withIdempotency}. */
export interface WithIdempotencyOptions<TEvent extends Event> {
  /**
   * Derives the dedup key from the event. Defaults to
   * `event.metadata?.eventId`. Provide this when events don't carry a
   * stable `eventId`, or when dedup should be scoped differently (e.g.
   * derived from payload fields).
   */
  key?: (event: TEvent) => string;
}

/**
 * Wraps an {@link EventHandler} so redelivered events (same dedup key)
 * are detected via `store` and skipped instead of re-invoking the
 * handler.
 *
 * The dedup key defaults to `event.metadata?.eventId`, or `options.key(event)`
 * when provided. If no key can be derived, the wrapped handler rejects
 * instead of silently processing or silently skipping the event.
 *
 * `store.markProcessed` is only called after the underlying handler
 * completes successfully — a failed attempt is never marked processed, so
 * broker redelivery semantics are preserved for genuine failures.
 *
 * This performs best-effort (not exactly-once) deduplication: it is a
 * check-then-act sequence with no locking, so two concurrent redeliveries
 * of the same key arriving before the first `markProcessed()` call
 * completes may both invoke the underlying handler.
 *
 * @param handler - The event handler to wrap.
 * @param store - The store used to track processed dedup keys.
 * @param options - Optional configuration, including a custom key derivation function.
 */
export function withIdempotency<
  TEvent extends Event,
  TInfrastructure extends Infrastructure,
>(
  handler: EventHandler<TEvent, TInfrastructure>,
  store: EventIdempotencyStore,
  options?: WithIdempotencyOptions<TEvent>,
): EventHandler<TEvent, TInfrastructure> {
  return async (event, infrastructure) => {
    const key = options?.key ? options.key(event) : event.metadata?.eventId;

    if (key == null) {
      throw new Error(
        "withIdempotency: could not derive a dedup key from the event. " +
          "Provide `options.key` or ensure `event.metadata.eventId` is set.",
      );
    }

    if (await store.hasProcessed(key)) {
      return;
    }

    await handler(event, infrastructure);
    await store.markProcessed(key);
  };
}
