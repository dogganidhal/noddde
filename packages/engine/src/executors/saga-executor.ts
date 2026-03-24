/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CQRSInfrastructure,
  Event,
  Infrastructure,
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
    // Step 1: Derive saga instance ID
    const associationFn = saga.associations[event.name];
    if (!associationFn) {
      return;
    }
    const sagaId = associationFn(event);

    // Step 2: Load saga state
    let currentState = await this.sagaPersistence.load(sagaName, sagaId);

    // Step 3: Bootstrap or resume
    if (currentState == null) {
      if ((saga.startedBy as string[]).includes(event.name)) {
        currentState = saga.initialState;
      } else {
        // Saga not started yet, ignore this event
        return;
      }
    }

    // Step 4: Execute handler
    const sagaHandler = saga.handlers[event.name];
    if (!sagaHandler) {
      return;
    }
    const reaction = await sagaHandler(
      event,
      currentState,
      this.infrastructure,
    );

    // Step 5: Propagate correlation context from triggering event
    const sagaCtx: MetadataContext = {
      correlationId: event.metadata?.correlationId ?? uuidv7(),
      causationId: event.metadata?.eventId ?? event.name,
      userId: event.metadata?.userId,
    };

    // Step 6: Create UoW for saga reaction (spans state + commands)
    const uow = this.unitOfWorkFactory();
    const sagaPersistence = this.sagaPersistence;

    await this.uowStorage.run(uow, async () => {
      await this.metadataStorage.run(sagaCtx, async () => {
        try {
          // Enlist saga state persistence
          uow.enlist(() =>
            sagaPersistence.save(sagaName, sagaId, reaction.state),
          );

          // Step 7: Dispatch commands (within the saga's UoW + metadata context)
          if (reaction.commands) {
            const commands = Array.isArray(reaction.commands)
              ? reaction.commands
              : [reaction.commands];
            for (const command of commands) {
              await this.infrastructure.commandBus.dispatch(command);
            }
          }

          // Step 8: Commit saga state + all aggregate changes atomically
          const events = await uow.commit();

          // Step 9: Publish all deferred events
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
