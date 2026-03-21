/* eslint-disable no-unused-vars */
import type { AggregateLocker, Event, ID } from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";

/**
 * Internal strategy interface for aggregate concurrency control.
 * The Domain delegates to a strategy instance during command dispatch.
 *
 * @internal Not exported — users configure concurrency via
 * `DomainConfiguration.infrastructure.aggregateConcurrency`.
 */
export interface ConcurrencyStrategy {
  /**
   * Wraps a command execution attempt with concurrency control.
   *
   * @param aggregateName - The aggregate type name.
   * @param aggregateId - The target aggregate instance ID.
   * @param attempt - Callback that executes one full attempt
   *   (create UoW → run lifecycle → commit). May be called multiple
   *   times by optimistic strategies. Returns the committed events.
   * @returns The events from the successful attempt.
   */
  execute(
    aggregateName: string,
    aggregateId: ID,
    attempt: () => Promise<Event[]>,
  ): Promise<Event[]>;
}

/**
 * Optimistic concurrency strategy: execute the attempt and retry
 * on {@link ConcurrencyError} up to `maxRetries` times.
 *
 * With `maxRetries = 0` (the default when no `aggregateConcurrency`
 * is configured), this acts as a **no-op passthrough** — the attempt
 * runs once and any `ConcurrencyError` propagates to the caller.
 * The version check on `save()` still catches conflicts at the
 * database level; only the retry behavior is opt-in.
 *
 * Each retry re-executes the full load→execute→save cycle against
 * the latest state. Command handlers may be called multiple times
 * and should be side-effect-free.
 *
 * @internal
 */
export class OptimisticConcurrencyStrategy implements ConcurrencyStrategy {
  constructor(private readonly maxRetries: number) {}

  async execute(
    _aggregateName: string,
    _aggregateId: string,
    attempt: () => Promise<Event[]>,
  ): Promise<Event[]> {
    for (let i = 0; i <= this.maxRetries; i++) {
      try {
        return await attempt();
      } catch (error) {
        if (error instanceof ConcurrencyError && i < this.maxRetries) {
          continue;
        }
        throw error;
      }
    }
    // TypeScript doesn't know the loop always returns or throws
    throw new Error("unreachable: retry loop exhausted without result");
  }
}

/**
 * Pessimistic concurrency strategy: acquire an exclusive lock before
 * executing the attempt, release after completion (success or failure).
 *
 * No retry loop — the lock prevents concurrent access, so
 * {@link ConcurrencyError} should not occur (the version check on
 * `save()` remains as a safety net).
 *
 * @internal
 */
export class PessimisticConcurrencyStrategy implements ConcurrencyStrategy {
  constructor(
    private readonly locker: AggregateLocker,
    private readonly timeoutMs?: number,
  ) {}

  async execute(
    aggregateName: string,
    aggregateId: ID,
    attempt: () => Promise<Event[]>,
  ): Promise<Event[]> {
    await this.locker.acquire(aggregateName, aggregateId, this.timeoutMs);
    try {
      return await attempt();
    } finally {
      await this.locker.release(aggregateName, aggregateId);
    }
  }
}
