import { SagaPersistence } from "../domain";

/**
 * In-memory {@link SagaPersistence} implementation that stores saga state
 * snapshots in a `Map`. State is lost when the process exits.
 *
 * Suitable for development, testing, and prototyping.
 * For production, use a durable store (PostgreSQL, MongoDB, etc.).
 */
export class InMemorySagaPersistence implements SagaPersistence {
  public async load(
    sagaName: string,
    sagaId: string,
  ): Promise<any | undefined> {
    throw new Error("Not implemented");
  }

  public async save(
    sagaName: string,
    sagaId: string,
    state: any,
  ): Promise<void> {
    throw new Error("Not implemented");
  }
}
