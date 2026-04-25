import type { Event, UnitOfWork, UnitOfWorkFactory } from "@noddde/core";

/**
 * In-memory implementation of {@link UnitOfWork}.
 *
 * Buffers persistence operations as thunks and deferred events in arrays.
 * On `commit()`, executes all operations sequentially and returns all
 * deferred events. On `rollback()`, discards everything.
 *
 * Suitable for development, testing, and single-process applications.
 * For production use with durable storage, provide a custom
 * `UnitOfWorkFactory` backed by your database's unit of work mechanism.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private operations: Array<() => Promise<void>> = [];
  private pendingEvents: Event[] = [];
  private completed = false;

  /**
   * The in-memory UoW has no real transaction handle, so `context` is
   * always `undefined`. View store factories observing this value will
   * fall back to their non-transactional client.
   */
  readonly context: undefined = undefined;

  /** @inheritdoc */
  enlist(operation: () => Promise<void>): void {
    this.assertNotCompleted();
    this.operations.push(operation);
  }

  /** @inheritdoc */
  deferPublish(...events: Event[]): void {
    this.assertNotCompleted();
    this.pendingEvents.push(...events);
  }

  /** @inheritdoc */
  async commit(): Promise<Event[]> {
    this.assertNotCompleted();
    this.completed = true;

    for (const operation of this.operations) {
      await operation();
    }

    return [...this.pendingEvents];
  }

  /** @inheritdoc */
  async rollback(): Promise<void> {
    this.assertNotCompleted();
    this.completed = true;
    this.operations = [];
    this.pendingEvents = [];
  }

  private assertNotCompleted(): void {
    if (this.completed) {
      throw new Error("UnitOfWork already completed");
    }
  }
}

/**
 * Factory function that creates a new {@link InMemoryUnitOfWork} instance.
 * Matches the {@link UnitOfWorkFactory} type and can be used as the
 * default value for `DomainWiring.unitOfWork`.
 */
export const createInMemoryUnitOfWork: UnitOfWorkFactory = () =>
  new InMemoryUnitOfWork();
