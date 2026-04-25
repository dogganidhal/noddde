/* eslint-disable no-unused-vars */
import type { Event } from "../edd";

/**
 * Coordinates atomic persistence and deferred event publishing
 * within a write model unit of work.
 *
 * A UnitOfWork collects write operations via {@link enlist} and events
 * via {@link deferPublish}, then executes all operations atomically
 * when {@link commit} is called. Events are returned by `commit()`
 * for the caller (typically the Domain) to publish after persistence
 * succeeds.
 *
 * A UnitOfWork is single-use: after {@link commit} or {@link rollback},
 * any further call throws an error.
 *
 * @see {@link UnitOfWorkFactory} for creating instances.
 */
export interface UnitOfWork {
  /**
   * The adapter-specific transaction handle for this unit of work, if any.
   *
   * - `undefined` outside the transactional region (before `commit()`
   *   begins, after it completes, or for an in-memory UoW that has no
   *   real transaction).
   * - During `commit()`, adapter-backed implementations set this to the
   *   live transaction client (e.g., a Prisma interactive tx, a Drizzle
   *   tx, a TypeORM `EntityManager`).
   *
   * Typed as `unknown` because core has no knowledge of any adapter.
   * Cross-cutting consumers — notably the engine when minting a
   * transactionally-scoped view store via `ViewStoreFactory.getForContext` —
   * pass it through opaquely or narrow it via an adapter-specific type.
   */
  readonly context?: unknown;

  /**
   * Buffers a write operation for deferred execution.
   * Operations are executed in enlistment order when `commit()` is called.
   *
   * @param operation - An async thunk wrapping a persistence call
   *   (e.g., `() => persistence.save(name, id, events)`).
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   */
  enlist(operation: () => Promise<void>): void;

  /**
   * Schedules events for deferred publishing after successful commit.
   * Events accumulate across multiple calls in the order they are deferred.
   *
   * @param events - One or more domain events to publish after commit.
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   */
  deferPublish(...events: Event[]): void;

  /**
   * Executes all enlisted operations in enlistment order, then returns
   * all deferred events. The caller is responsible for publishing the
   * returned events (typically via `EventBus.dispatch()`).
   *
   * After `commit()`, the UnitOfWork is sealed — further calls to
   * `enlist`, `deferPublish`, `commit`, or `rollback` will throw.
   *
   * @returns The accumulated deferred events, in the order they were scheduled.
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   * @throws Error if any enlisted operation fails (partial commit may occur
   *   in the in-memory implementation; database-backed implementations
   *   should use real database transactions for all-or-nothing semantics).
   */
  commit(): Promise<Event[]>;

  /**
   * Discards all enlisted operations and deferred events without
   * executing any operations.
   *
   * After `rollback()`, the UnitOfWork is sealed — further calls throw.
   *
   * @throws Error if the UnitOfWork has already been committed or rolled back.
   */
  rollback(): Promise<void>;
}

/**
 * Factory function that creates a new {@link UnitOfWork} instance.
 * Called once per unit of work boundary (per command dispatch, saga reaction,
 * or explicit `domain.withUnitOfWork()` call).
 *
 * Configured via `DomainWiring.unitOfWork`.
 */
export type UnitOfWorkFactory = () => UnitOfWork;
