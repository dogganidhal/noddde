/* eslint-disable no-unused-vars */
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Command,
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
import type { Instrumentation } from "../tracing";
import { runUowCompletionHooks } from "../uow-completion-hooks";

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

        // Commits the saga's UoW, returning the deferred events. Publishing
        // and the post-dispatch callback are performed by the caller AFTER
        // the uowStorage/metadataStorage ALS scope has exited -- not nested
        // inside it -- so a standalone handler reacting to one of these
        // events and dispatching a command never observes the just-completed
        // `uow` via uowStorage.getStore(). It takes the implicit-UoW path
        // instead of throwing "UnitOfWork already completed".
        const commitOnly = async (): Promise<Event[]> => {
          const commitFn = () => uow.commit();
          return this.instrumentation
            ? await this.instrumentation.withSpan(
                "noddde.uow.commit",
                { "noddde.saga.name": sagaName },
                commitFn,
              )
            : await commitFn();
        };

        const publish = async (events: Event[]): Promise<void> => {
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

        let committed = false;
        let deferredEvents: Event[] = [];
        let hooksRan = false;

        // Runs the UoW completion hooks exactly once, outside the ALS scope
        // and BEFORE publishing -- so a slow publish loop never delays a
        // deferred lock release -- while a hook failure is swallowed (logged)
        // so it can never block publishing from proceeding.
        const runHooksOnce = async (): Promise<void> => {
          if (hooksRan) return;
          hooksRan = true;
          try {
            await runUowCompletionHooks(uow, committed);
          } catch (error) {
            this.logger?.error("UoW completion hooks failed.", {
              sagaName,
              sagaId: String(sagaId),
              error: String(error),
            });
          }
        };

        try {
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
                    sagaPersistence.save(sagaName, sagaId, reaction.state),
                  );
                  deferredEvents = await commitOnly();
                  committed = true;
                } catch (error) {
                  await failCommitPhase(error);
                }
              });
            });

            await runHooksOnce();
            await publish(deferredEvents);

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
                    sagaPersistence.save(sagaName, sagaId, reaction.state),
                  );
                  await dispatchCommands();
                  deferredEvents = await commitOnly();
                  committed = true;
                } catch (error) {
                  await failCommitPhase(error);
                }
              });
            });

            await runHooksOnce();
            await publish(deferredEvents);
          }
        } finally {
          // Safety net for the failure path (failCommitPhase re-throws before
          // runHooksOnce is reached above) -- ensures the hooks still run
          // exactly once even when the saga's UoW rolled back.
          await runHooksOnce();
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
