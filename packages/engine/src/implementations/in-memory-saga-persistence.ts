import type { ID, SagaPersistence } from "@noddde/core";
import { ConcurrencyError } from "@noddde/core";

/**
 * In-memory {@link SagaPersistence} implementation that stores saga state
 * snapshots in a `Map`. State is lost when the process exits.
 *
 * State is keyed by a composite `${sagaName}:${sagaId}` string, alongside a
 * monotonically increasing version (same optimistic-concurrency shape as
 * {@link InMemoryStateStoredAggregatePersistence}). `save` throws
 * {@link ConcurrencyError} if `expectedVersion` does not match the stored
 * version. `load` returns `null` if no saga instance exists for the given
 * key (version implicitly 0).
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable store (PostgreSQL, MongoDB, etc.).
 */
export class InMemorySagaPersistence implements SagaPersistence {
  private readonly store = new Map<string, { state: any; version: number }>();

  /**
   * Loads the current state and version of a saga instance.
   * Returns `null` if no state has been saved for the given key.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @returns The stored `{ state, version }`, or `null` if not found.
   */
  public async load(
    sagaName: string,
    sagaId: ID,
  ): Promise<{ state: any; version: number } | null> {
    const key = `${sagaName}:${sagaId}`;
    return this.store.get(key) ?? null;
  }

  /**
   * Persists the current state of a saga instance, replacing any
   * previously stored state. Throws {@link ConcurrencyError} if
   * `expectedVersion` does not match the stored version.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @param state - The full saga state to persist.
   * @param expectedVersion - The version observed at load time (0 for new saga instances).
   */
  public async save(
    sagaName: string,
    sagaId: ID,
    state: any,
    expectedVersion: number,
  ): Promise<void> {
    const key = `${sagaName}:${sagaId}`;
    const existing = this.store.get(key);
    const actualVersion = existing?.version ?? 0;
    if (actualVersion !== expectedVersion) {
      throw new ConcurrencyError(
        sagaName,
        sagaId,
        expectedVersion,
        actualVersion,
      );
    }
    this.store.set(key, { state, version: expectedVersion + 1 });
  }
}
