/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CQRSInfrastructure,
  Event,
  Infrastructure,
  Logger,
  Saga,
  SagaPersistence,
  UnitOfWork,
  UnitOfWorkFactory,
} from "@noddde/core";
import { uuidv7 } from "../uuid";
import type { MetadataContext } from "../domain";

/**
 * Executes the full saga event handling lifecycle: derive instance ID,
 * load state, bootstrap or resume, execute handler, persist state,
 * and dispatch reaction commands — all within an atomic unit of work.
 *
 * Creates its own UoW that spans saga state persistence and all
 * commands dispatched by the saga reaction, ensuring atomicity.
 *
 * @internal Not exported — instantiated by {@link Domain} during init.
 */
export class SagaExecutor {
  constructor(
    private readonly infrastructure: Infrastructure & CQRSInfrastructure,
    private readonly sagaPersistence: SagaPersistence,
    private readonly unitOfWorkFactory: UnitOfWorkFactory,
    private readonly uowStorage: AsyncLocalStorage<UnitOfWork>,
    private readonly metadataStorage: AsyncLocalStorage<MetadataContext>,
    private readonly onEventsDispatched?: (events: Event[]) => Promise<void>,
    private readonly logger?: Logger,
  ) {}

  /**
   * Executes the full saga event handling lifecycle for a single event.
   *
   * @param sagaName - The saga type name.
   * @param saga - The saga definition.
   * @param event - The triggering event.
   */
  async execute(
    sagaName: string,
    saga: Saga<any, any>,
    event: Event,
  ): Promise<void> {
    // Step 1: Look up on-map entry for this event
    const onEntry = (saga.on as Record<string, any>)[event.name];
    if (!onEntry) {
      return;
    }

    // Step 2: Derive saga instance ID
    const sagaId = onEntry.id(event);

    this.logger?.debug("Saga event received.", {
      sagaName,
      eventName: event.name,
      sagaId: String(sagaId),
    });

    // Step 3: Load saga state
    let currentState = await this.sagaPersistence.load(sagaName, sagaId);

    // Step 4: Bootstrap or resume
    if (currentState == null) {
      if ((saga.startedBy as string[]).includes(event.name)) {
        currentState = saga.initialState;
        this.logger?.info("Saga instance started.", {
          sagaName,
          sagaId: String(sagaId),
          triggerEvent: event.name,
        });
      } else {
        // Saga not started yet, ignore this event
        this.logger?.debug("Saga not started, ignoring event.", {
          sagaName,
          sagaId: String(sagaId),
          eventName: event.name,
        });
        return;
      }
    }

    // Step 5: Execute handler
    const reaction = await onEntry.handle(
      event,
      currentState,
      this.infrastructure,
    );

    const commandCount = reaction.commands
      ? Array.isArray(reaction.commands)
        ? reaction.commands.length
        : 1
      : 0;
    this.logger?.debug("Saga reaction computed.", {
      sagaName,
      sagaId: String(sagaId),
      commandCount,
    });

    // Step 6: Propagate correlation context from triggering event
    const sagaCtx: MetadataContext = {
      correlationId: event.metadata?.correlationId ?? uuidv7(),
      causationId: event.metadata?.eventId ?? event.name,
      userId: event.metadata?.userId,
    };

    // Step 7: Create UoW for saga reaction (spans state + commands)
    const uow = this.unitOfWorkFactory();
    const sagaPersistence = this.sagaPersistence;

    await this.uowStorage.run(uow, async () => {
      await this.metadataStorage.run(sagaCtx, async () => {
        try {
          // Enlist saga state persistence
          uow.enlist(() =>
            sagaPersistence.save(sagaName, sagaId, reaction.state),
          );

          // Step 8: Dispatch commands (within the saga's UoW + metadata context)
          if (reaction.commands) {
            const commands = Array.isArray(reaction.commands)
              ? reaction.commands
              : [reaction.commands];
            for (const command of commands) {
              await this.infrastructure.commandBus.dispatch(command);
            }
          }

          // Step 9: Commit saga state + all aggregate changes atomically
          const events = await uow.commit();

          // Step 10: Publish all deferred events
          for (const deferredEvent of events) {
            await this.infrastructure.eventBus.dispatch(deferredEvent);
          }

          // Best-effort post-dispatch callback (e.g., mark outbox entries published)
          if (this.onEventsDispatched && events.length > 0) {
            try {
              await this.onEventsDispatched(events);
            } catch {
              // Best-effort: relay will catch unpublished entries
            }
          }
        } catch (error) {
          this.logger?.error("Saga execution failed.", {
            sagaName,
            sagaId: String(sagaId),
            eventName: event.name,
            error: String(error),
          });
          try {
            await uow.rollback();
          } catch {
            // UoW may already be completed if commit failed
          }
          throw error;
        }
      });
    });
  }
}
