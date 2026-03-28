/* eslint-disable no-unused-vars */
import type { AggregateLocker, Event, ID, Logger } from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";

/**
 * Internal strategy interface for aggregate concurrency control.
 * The Domain delegates to a strategy instance during command dispatch.
 *
 * @internal Not exported — users configure concurrency via
 * {@link AggregateWiring.concurrency} in {@link DomainWiring}.
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
  constructor(
    private readonly maxRetries: number,
    private readonly logger?: Logger,
  ) {}

  async execute(
    _aggregateName: string,
    _aggregateId: ID,
    attempt: () => Promise<Event[]>,
  ): Promise<Event[]> {
    for (let i = 0; i <= this.maxRetries; i++) {
      try {
        return await attempt();
      } catch (error) {
        if (error instanceof ConcurrencyError && i < this.maxRetries) {
          this.logger?.info("Retrying after concurrency conflict.", {
            aggregateName: _aggregateName,
            aggregateId: String(_aggregateId),
            attempt: i + 1,
            maxRetries: this.maxRetries,
          });
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
    private readonly logger?: Logger,
  ) {}

  async execute(
    aggregateName: string,
    aggregateId: ID,
    attempt: () => Promise<Event[]>,
  ): Promise<Event[]> {
    this.logger?.debug("Acquiring lock.", {
      aggregateName,
      aggregateId: String(aggregateId),
    });
    await this.locker.acquire(aggregateName, aggregateId, this.timeoutMs);
    this.logger?.debug("Lock acquired.", {
      aggregateName,
      aggregateId: String(aggregateId),
    });
    try {
      return await attempt();
    } finally {
      await this.locker.release(aggregateName, aggregateId);
      this.logger?.debug("Lock released.", {
        aggregateName,
        aggregateId: String(aggregateId),
      });
    }
  }
}

/**
 * Composite concurrency strategy that routes to per-aggregate strategies.
 * Falls back to a default strategy for aggregates without specific config.
 *
 * @internal
 */
export class PerAggregateConcurrencyStrategy implements ConcurrencyStrategy {
  constructor(
    private readonly strategies: Map<string, ConcurrencyStrategy>,
    private readonly defaultStrategy: ConcurrencyStrategy,
  ) {}

  async execute(
    aggregateName: string,
    aggregateId: ID,
    attempt: () => Promise<Event[]>,
  ): Promise<Event[]> {
    const strategy = this.strategies.get(aggregateName) ?? this.defaultStrategy;
    return strategy.execute(aggregateName, aggregateId, attempt);
  }
}
