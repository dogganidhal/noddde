/* eslint-disable no-unused-vars */
import type { ID } from "../id";
import type { Event } from "../edd";

/**
 * A snapshot of an aggregate's state at a specific event stream version.
 * Snapshots are an optimization for event-sourced aggregates — they allow
 * the domain engine to avoid replaying the full event stream on every command.
 *
 * Snapshots are not the source of truth — the event stream is. Deleting all
 * snapshots does not lose data; the engine falls back to full replay.
 */
export interface Snapshot {
  /** The aggregate state at the time of the snapshot. */
  state: any;
  /** The event stream version (number of events) at which this snapshot was taken. */
  version: number;
}

/**
 * Storage interface for aggregate state snapshots.
 * Snapshots are an optimization for event-sourced aggregates — they allow
 * the domain engine to avoid replaying the full event stream on every command.
 *
 * Implementations must support save-then-load round-trips and return `null`
 * for unknown aggregates. Only the latest snapshot per aggregate instance
 * is retained.
 *
 * @see {@link Snapshot} for the snapshot data structure.
 */
export interface SnapshotStore {
  /**
   * Loads the latest snapshot for an aggregate instance.
   * Returns `null` if no snapshot exists.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   */
  load(aggregateName: string, aggregateId: ID): Promise<Snapshot | null>;

  /**
   * Saves a snapshot of an aggregate's state at a given version.
   * Overwrites any previously stored snapshot for the same instance.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param snapshot - The snapshot to save.
   */
  save(
    aggregateName: string,
    aggregateId: ID,
    snapshot: Snapshot,
  ): Promise<void>;
}

/**
 * Strategy function that decides whether to take a snapshot after
 * processing a command. Called by the domain engine after each
 * successful event-sourced command dispatch.
 *
 * @param context - Information about the current event stream state.
 * @returns `true` to take a snapshot, `false` to skip.
 */
export type SnapshotStrategy = (context: {
  /** Current event stream version (total number of events after this command). */
  version: number;
  /** Version at which the last snapshot was taken (0 if no snapshot exists). */
  lastSnapshotVersion: number;
  /** Number of events since the last snapshot (`version - lastSnapshotVersion`). */
  eventsSinceSnapshot: number;
}) => boolean;

/**
 * Optional interface that event-sourced persistence implementations
 * can adopt to efficiently load only events after a given version.
 *
 * When the domain engine has a snapshot, it uses this method (if available)
 * to avoid loading the full event stream. If the persistence does not
 * implement this interface, the engine falls back to `load()` + `Array.slice()`.
 */
export interface PartialEventLoad {
  /**
   * Loads events that occurred after the given version.
   * `afterVersion` is the number of events to skip from the beginning
   * of the stream. Returns events at positions `afterVersion, afterVersion+1, ...`.
   *
   * - `afterVersion = 0` returns all events (equivalent to `load()`).
   * - `afterVersion >= streamLength` returns an empty array.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param afterVersion - The number of events to skip from the beginning.
   */
  loadAfterVersion(
    aggregateName: string,
    aggregateId: ID,
    afterVersion: number,
  ): Promise<Event[]>;
}

/**
 * Creates a snapshot strategy that triggers every N events since the
 * last snapshot (or since the beginning if no snapshot exists).
 *
 * @param n - The number of events between snapshots. Must be >= 1.
 * @returns A {@link SnapshotStrategy} function.
 *
 * @example
 * ```ts
 * // Snapshot every 100 events
 * const strategy = everyNEvents(100);
 * ```
 */
export function everyNEvents(n: number): SnapshotStrategy {
  return ({ eventsSinceSnapshot }) => eventsSinceSnapshot >= n;
}
