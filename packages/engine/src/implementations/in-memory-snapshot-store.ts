import type { Snapshot, SnapshotStore } from "@noddde/core";

/**
 * In-memory {@link SnapshotStore} implementation that stores aggregate
 * state snapshots in a `Map`. Snapshots are lost when the process exits.
 *
 * Snapshots are keyed by a composite `${aggregateName}:${aggregateId}` string.
 * Each `save` call **overwrites** the previously stored snapshot. `load` returns
 * the latest snapshot or `null` if none exists.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable snapshot store (PostgreSQL, Redis, etc.).
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly store = new Map<string, Snapshot>();

  /**
   * Loads the latest snapshot for an aggregate instance.
   * Returns `null` if no snapshot has been saved for the given key.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @returns The stored snapshot, or `null` if not found.
   */
  public async load(
    aggregateName: string,
    aggregateId: string,
  ): Promise<Snapshot | null> {
    const key = `${aggregateName}:${aggregateId}`;
    return this.store.get(key) ?? null;
  }

  /**
   * Saves a snapshot, replacing any previously stored snapshot for the same
   * aggregate instance.
   *
   * @param aggregateName - The aggregate type name (used as a namespace).
   * @param aggregateId - The unique identifier of the aggregate instance.
   * @param snapshot - The snapshot to save.
   */
  public async save(
    aggregateName: string,
    aggregateId: string,
    snapshot: Snapshot,
  ): Promise<void> {
    const key = `${aggregateName}:${aggregateId}`;
    this.store.set(key, snapshot);
  }
}
