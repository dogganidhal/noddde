/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Aggregate,
  AggregateCommand,
  Event,
  EventSourcedAggregatePersistence,
  ID,
  IdempotencyStore,
  Infrastructure,
  CQRSInfrastructure,
  PartialEventLoad,
  PersistenceConfiguration,
  Snapshot,
  SnapshotStore,
  SnapshotStrategy,
  StateStoredAggregatePersistence,
  UnitOfWork,
  UnitOfWorkFactory,
} from "@noddde/core";
import type { ConcurrencyStrategy } from "../concurrency-strategy";
import type { MetadataEnricher } from "./metadata-enricher";

/**
 * Executes the full aggregate command lifecycle: load state, execute
 * handler, apply events, enrich metadata, enlist persistence, defer
 * event publishing, and evaluate snapshot strategy.
 *
 * Manages UoW ownership (implicit vs. explicit) and delegates
 * concurrency control to a {@link ConcurrencyStrategy}.
 *
 * @internal Not exported — instantiated by {@link Domain} during init.
 */
export class CommandLifecycleExecutor {
  constructor(
    private readonly persistence: PersistenceConfiguration,
    private readonly infrastructure: Infrastructure & CQRSInfrastructure,
    private readonly unitOfWorkFactory: UnitOfWorkFactory,
    private readonly concurrencyStrategy: ConcurrencyStrategy,
    private readonly uowStorage: AsyncLocalStorage<UnitOfWork>,
    private readonly metadataEnricher: MetadataEnricher,
    private readonly snapshotStore?: SnapshotStore,
    private readonly snapshotStrategy?: SnapshotStrategy,
    private readonly idempotencyStore?: IdempotencyStore,
    private readonly onEventsProduced?: (
      events: Event[],
      uow: UnitOfWork,
    ) => Promise<void>,
  ) {}

  /**
   * Executes the full aggregate command lifecycle with concurrency
   * control and UoW management.
   *
   * If a UoW is already active (via `withUnitOfWork` or saga handling),
   * persistence and event publishing are deferred to the owning UoW.
   * Otherwise, an implicit UoW is created and committed immediately.
   *
   * @param aggregateName - The aggregate type name.
   * @param aggregate - The aggregate definition.
   * @param command - The command to execute.
   */
  async execute(
    aggregateName: string,
    aggregate: Aggregate<any>,
    command: AggregateCommand,
  ): Promise<void> {
    // Idempotency check (before any other work)
    if (command.commandId != null && this.idempotencyStore) {
      const alreadyProcessed = await this.idempotencyStore.exists(
        command.commandId,
      );
      if (alreadyProcessed) {
        return; // Duplicate command — skip execution entirely
      }
    }

    const { persistence, infrastructure } = this;
    const eventBus = infrastructure.eventBus;

    const existingUow = this.uowStorage.getStore();
    const ownsUow = !existingUow;

    const snapshotResult: {
      value: {
        aggregateName: string;
        aggregateId: ID;
        snapshot: Snapshot;
      } | null;
    } = { value: null };

    const runLifecycle = async (uow: UnitOfWork) => {
      snapshotResult.value = await this.executeLifecycle(
        aggregateName,
        aggregate,
        command,
        persistence,
        uow,
      );
    };

    if (ownsUow) {
      // Implicit UoW — strategy wraps the full attempt (UoW create + commit)
      const events = await this.concurrencyStrategy.execute(
        aggregateName,
        command.targetAggregateId,
        async () => {
          const uow = this.unitOfWorkFactory();
          try {
            await runLifecycle(uow);
            return await uow.commit();
          } catch (error) {
            try {
              await uow.rollback();
            } catch {
              // UoW may already be completed if commit failed partway through
            }
            throw error;
          }
        },
      );

      // Save snapshot after successful commit (best-effort)
      if (snapshotResult.value && this.snapshotStore) {
        try {
          await this.snapshotStore.save(
            snapshotResult.value.aggregateName,
            snapshotResult.value.aggregateId,
            snapshotResult.value.snapshot,
          );
        } catch {
          // Best-effort: snapshot save failure does not affect the command result
        }
      }

      for (const event of events) {
        await eventBus.dispatch(event);
      }
    } else {
      // Explicit UoW — strategy wraps just the lifecycle (for pessimistic locking)
      await this.concurrencyStrategy.execute(
        aggregateName,
        command.targetAggregateId,
        async () => {
          await runLifecycle(existingUow!);
          return [];
        },
      );
    }
  }

  /**
   * The core load->execute->apply->enrich->enlist->defer cycle.
   *
   * Returns a pending snapshot (if the snapshot strategy triggers) for the
   * caller to save after UoW commit. Returns `null` if no snapshot is needed.
   */
  private async executeLifecycle(
    aggregateName: string,
    aggregate: Aggregate<any>,
    command: AggregateCommand,
    persistence: PersistenceConfiguration,
    uow: UnitOfWork,
  ): Promise<{
    aggregateName: string;
    aggregateId: ID;
    snapshot: Snapshot;
  } | null> {
    // Step 1: Load (snapshot-aware for event-sourced persistence)
    let snapshot: Snapshot | null = null;
    if (this.snapshotStore) {
      snapshot = await this.snapshotStore.load(
        aggregateName,
        command.targetAggregateId,
      );
    }

    let currentState: any;
    let version: number;
    let isEventSourced: boolean;

    if (snapshot) {
      // Snapshot available — we know this is event-sourced
      isEventSourced = true;
      let events: Event[];
      if ("loadAfterVersion" in persistence) {
        // Optimized path: load only post-snapshot events
        events = await (persistence as PartialEventLoad).loadAfterVersion(
          aggregateName,
          command.targetAggregateId,
          snapshot.version,
        );
      } else {
        // Fallback: load all events and slice
        const allEvents = await persistence.load(
          aggregateName,
          command.targetAggregateId,
        );
        events = (allEvents as Event[]).slice(snapshot.version);
      }
      version = snapshot.version + events.length;
      currentState = events.reduce((state: any, event: Event) => {
        const applyHandler = aggregate.apply[event.name];
        return applyHandler ? applyHandler(event.payload, state) : state;
      }, snapshot.state);
    } else {
      // No snapshot — standard path
      const loaded = await persistence.load(
        aggregateName,
        command.targetAggregateId,
      );
      isEventSourced = Array.isArray(loaded);

      if (isEventSourced) {
        // Event-sourced: replay events to rebuild state; version = stream length
        const events = loaded as Event[];
        version = events.length;
        currentState = events.reduce((state: any, event: Event) => {
          const applyHandler = aggregate.apply[event.name];
          return applyHandler ? applyHandler(event.payload, state) : state;
        }, aggregate.initialState);
      } else {
        // State-stored: load returns { state, version } | null
        const stateResult = loaded as {
          state: any;
          version: number;
        } | null;
        version = stateResult?.version ?? 0;
        currentState = stateResult?.state ?? aggregate.initialState;
      }
    }

    // Step 2: Execute command handler
    const handler = aggregate.commands[command.name];
    if (!handler) {
      throw new Error(
        `No command handler found for command: ${command.name} on aggregate: ${aggregateName}`,
      );
    }
    const result = await handler(command, currentState, this.infrastructure);

    // Step 3: Normalize to array
    const newEvents: Event[] = Array.isArray(result) ? result : [result];

    // Step 4: Apply events to get new state
    let newState = currentState;
    for (const event of newEvents) {
      const applyHandler = aggregate.apply[event.name];
      if (applyHandler) {
        newState = applyHandler(event.payload, newState);
      }
    }

    // Step 4.5: Enrich events with metadata
    const enrichedEvents = this.metadataEnricher.enrich(
      newEvents,
      aggregateName,
      command.targetAggregateId,
      version,
      command.name,
    );

    // Step 5: Enlist persistence in UoW with version (deferred until commit)
    if (isEventSourced) {
      uow.enlist(() =>
        (persistence as EventSourcedAggregatePersistence).save(
          aggregateName,
          command.targetAggregateId,
          enrichedEvents,
          version,
        ),
      );
    } else {
      uow.enlist(() =>
        (persistence as StateStoredAggregatePersistence).save(
          aggregateName,
          command.targetAggregateId,
          newState,
          version,
        ),
      );
    }

    // Step 5.5: Enlist idempotency record in UoW (if commandId present)
    if (command.commandId != null && this.idempotencyStore) {
      const idempotencyStore = this.idempotencyStore;
      uow.enlist(() =>
        idempotencyStore.save({
          commandId: command.commandId!,
          aggregateName,
          aggregateId: command.targetAggregateId,
          processedAt: new Date().toISOString(),
        }),
      );
    }

    // Step 6: Defer event publishing (published after commit)
    uow.deferPublish(...enrichedEvents);

    // Step 6.5: Strong-consistency projection view updates (if configured)
    if (this.onEventsProduced) {
      await this.onEventsProduced(enrichedEvents, uow);
    }

    // Step 7: Evaluate snapshot strategy (if configured)
    if (isEventSourced && this.snapshotStore && this.snapshotStrategy) {
      const newVersion = version + newEvents.length;
      const lastSnapshotVersion = snapshot?.version ?? 0;
      const eventsSinceSnapshot = newVersion - lastSnapshotVersion;
      if (
        this.snapshotStrategy({
          version: newVersion,
          lastSnapshotVersion,
          eventsSinceSnapshot,
        })
      ) {
        return {
          aggregateName,
          aggregateId: command.targetAggregateId,
          snapshot: { state: newState, version: newVersion },
        };
      }
    }

    return null;
  }
}
