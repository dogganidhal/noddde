/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Command,
  CQRSInfrastructure,
  Event,
  Infrastructure,
  Instrumentation,
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
 * load state, bootstrap or resume, execute handler, persist state, and
 * dispatch reaction commands.
 *
 * The transactional coupling between saga-state persistence and
 * reaction-command dispatch is selected per-saga by
 * `saga.atomicity ?? "atomic"`:
 *
 * - **`"atomic"`** (default) — a single UoW spans the saga-state save and
 *   all reaction commands; they commit or roll back together.
 * - **`"best-effort"`** — the saga state is committed first, then reaction
 *   commands are dispatched outside that UoW (each obtains its own UoW),
 *   so command handlers that publish events directly observe the committed
 *   saga state (issue #119). A command failure does not roll back the state.
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
    private readonly instrumentation?: Instrumentation,
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
    const loaded = await this.sagaPersistence.load(sagaName, sagaId);

    // Step 4: Bootstrap or resume
    let currentState: any;
    let expectedVersion: number;
    if (loaded == null) {
      if ((saga.startedBy as string[]).includes(event.name)) {
        currentState = saga.initialState;
        expectedVersion = 0;
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
    } else {
      currentState = loaded.state;
      expectedVersion = loaded.version;
    }

    // Wrap saga lifecycle in restored trace context from the triggering event
    const traceCarrier = {
      traceparent: event.metadata?.traceparent,
      tracestate: event.metadata?.tracestate,
    };

    const runSagaLifecycle = async (): Promise<void> => {
      const spanAttributes = {
        "noddde.saga.name": sagaName,
        "noddde.event.name": event.name,
      };

      const runInSpan = async (): Promise<void> => {
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

        // Step 7: Resolve atomicity mode (an absent field defaults to "atomic")
        const mode = saga.atomicity ?? "atomic";
        const uow = this.unitOfWorkFactory();
        const sagaPersistence = this.sagaPersistence;

        const commands: Command[] = reaction.commands
          ? Array.isArray(reaction.commands)
            ? reaction.commands
            : [reaction.commands]
          : [];

        // ponytail: a ConcurrencyError (version conflict) propagates like any
        // other commit failure below, no retry/serialize-per-saga-id yet.
        // Add if concurrent handlers for the same saga instance prove common.
        //
        // Log, attempt a best-effort rollback, and re-throw. Used for the
        // saga-state commit phase in both modes.
        const failCommitPhase = async (error: unknown): Promise<never> => {
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
        };

        // Commit the saga's UoW and publish its deferred events sequentially
        // (sequential dispatch preserves causal ordering), then run the
        // best-effort post-dispatch callback. The caller enlists beforehand.
        const commitAndPublish = async (): Promise<void> => {
          const commitFn = () => uow.commit();
          const events = this.instrumentation
            ? await this.instrumentation.withSpan(
                "noddde.uow.commit",
                { "noddde.saga.name": sagaName },
                commitFn,
              )
            : await commitFn();

          for (const e of events) {
            await this.infrastructure.eventBus.dispatch(e);
          }

          // Best-effort post-dispatch callback (e.g., mark outbox entries published)
          if (this.onEventsDispatched && events.length > 0) {
            try {
              await this.onEventsDispatched(events);
            } catch {
              // Best-effort: relay will catch unpublished entries
            }
          }
        };

        const dispatchCommands = async (): Promise<void> => {
          for (const command of commands) {
            await this.infrastructure.commandBus.dispatch(command);
          }
        };

        if (mode === "best-effort") {
          // Best-effort: commit the saga state FIRST, then dispatch reaction
          // commands OUTSIDE the saga's UoW (each obtains its own UoW via the
          // CommandLifecycleExecutor) but still inside the metadata context.
          // Because the saga state is already durable, command handlers that
          // publish events directly via the event bus — and any re-entrant
          // saga executions they trigger — observe the committed state
          // (issue #119). A command failure after commit does NOT roll back
          // the saga state; it propagates.
          await this.uowStorage.run(uow, async () => {
            await this.metadataStorage.run(sagaCtx, async () => {
              try {
                uow.enlist(() =>
                  sagaPersistence.save(
                    sagaName,
                    sagaId,
                    reaction.state,
                    expectedVersion,
                  ),
                );
                await commitAndPublish();
              } catch (error) {
                await failCommitPhase(error);
              }
            });
          });

          if (commands.length > 0) {
            await this.metadataStorage.run(sagaCtx, dispatchCommands);
          }
        } else {
          // Atomic (default): the saga's UoW spans the saga-state save and all
          // reaction commands, so they commit or roll back together. Aggregate
          // command handlers enlist on this same UoW (explicit-UoW path) and
          // their events are deferred until commit.
          await this.uowStorage.run(uow, async () => {
            await this.metadataStorage.run(sagaCtx, async () => {
              try {
                uow.enlist(() =>
                  sagaPersistence.save(
                    sagaName,
                    sagaId,
                    reaction.state,
                    expectedVersion,
                  ),
                );
                await dispatchCommands();
                await commitAndPublish();
              } catch (error) {
                await failCommitPhase(error);
              }
            });
          });
        }
      };

      if (this.instrumentation) {
        await this.instrumentation.withSpan(
          "noddde.saga.handle",
          spanAttributes,
          runInSpan,
        );
      } else {
        await runInSpan();
      }
    };

    if (this.instrumentation) {
      await this.instrumentation.withExtractedContext(
        traceCarrier,
        runSagaLifecycle,
      );
    } else {
      await runSagaLifecycle();
    }
  }
}
