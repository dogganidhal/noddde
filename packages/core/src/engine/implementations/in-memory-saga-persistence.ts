import { SagaPersistence } from "../domain";

/**
 * In-memory {@link SagaPersistence} implementation that stores saga state
 * snapshots in a `Map`. State is lost when the process exits.
 *
 * State is keyed by a composite `${sagaName}:${sagaId}` string.
 * Each `save` call **overwrites** the previously stored state. `load` returns
 * the latest state, or `undefined` if no saga instance exists for the given key.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable store (PostgreSQL, MongoDB, etc.).
 */
export class InMemorySagaPersistence implements SagaPersistence {
  private readonly store = new Map<string, any>();

  /**
   * Loads the current state of a saga instance.
   * Returns `undefined` if no state has been saved for the given key.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @returns The stored state, or `undefined` if not found.
   */
  public async load(
    sagaName: string,
    sagaId: string,
  ): Promise<any | undefined> {
    const key = `${sagaName}:${sagaId}`;
    return this.store.get(key);
  }

  /**
   * Persists the current state of a saga instance, replacing any
   * previously stored state.
   *
   * @param sagaName - The saga type name (used as a namespace).
   * @param sagaId - The unique identifier of the saga instance.
   * @param state - The full saga state to persist.
   */
  public async save(
    sagaName: string,
    sagaId: string,
    state: any,
  ): Promise<void> {
    const key = `${sagaName}:${sagaId}`;
    this.store.set(key, state);
  }
}
