import {
  defineDomain,
  type Aggregate,
  type Projection,
  type Saga,
  type Infrastructure,
  type Command,
  type Event,
  type ViewStoreFactory,
} from "@noddde/core";
import {
  wireDomain,
  type Domain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemorySagaPersistence,
} from "@noddde/engine";
import type { DomainSpy } from "./types";

/**
 * Simplified domain configuration for slice tests. Only requires the
 * domain components under test. All infrastructure (buses, persistence)
 * is pre-wired with in-memory implementations automatically.
 *
 * @typeParam TInfrastructure - Custom infrastructure type for this domain.
 */
export type TestDomainConfig<
  TInfrastructure extends Infrastructure = Infrastructure,
> = {
  /** Aggregate definitions keyed by name. */
  aggregates?: Record<string, Aggregate<any>>;
  /** Projection definitions keyed by name. */
  projections?: Record<string, Projection<any>>;
  /** Optional per-projection {@link ViewStoreFactory} singletons. */
  projectionViewStores?: Record<string, { viewStore: ViewStoreFactory }>;
  /** Saga definitions keyed by name. */
  sagas?: Record<string, Saga<any, any>>;
  /** Optional standalone query handlers keyed by query name. */
  standaloneQueryHandlers?: Record<string, any>;
  /** Optional custom infrastructure to provide to handlers. */
  infrastructure?: TInfrastructure;
};

/**
 * The result of {@link testDomain}, providing the configured domain
 * and spy accessors for assertions.
 *
 * @typeParam TInfrastructure - Custom infrastructure type.
 */
export type TestDomainResult<
  TInfrastructure extends Infrastructure = Infrastructure,
> = {
  /** The fully initialized domain instance. */
  domain: Domain<TInfrastructure>;
  /** Spy data: all published events and dispatched commands. */
  spy: DomainSpy;
};

/**
 * True when `error` is exactly the "no handler registered" error
 * `InMemoryCommandBus` throws for `commandName` — scoped to that command's
 * own name so a real thrown error that merely resembles the message (for a
 * *different* command) is never mistaken for a missing handler.
 */
function isMissingHandlerError(
  error: unknown,
  commandName: string,
): error is Error {
  return (
    error instanceof Error &&
    error.message === `No handler registered for command: ${commandName}`
  );
}

/**
 * Creates a pre-wired domain for slice testing. Automatically provides
 * in-memory implementations for all buses and persistence, and installs
 * spies on the event bus and command bus to capture everything that
 * flows through.
 *
 * @typeParam TInfrastructure - Custom infrastructure type.
 * @param config - Simplified domain configuration.
 * @returns A promise resolving to the domain and spy accessors.
 *
 * @example
 * ```ts
 * const { domain, spy } = await testDomain({
 *   aggregates: { Counter },
 *   projections: { CounterView },
 * });
 *
 * await domain.dispatchCommand({
 *   name: "Increment",
 *   targetAggregateId: "c-1",
 *   payload: { amount: 5 },
 * });
 *
 * expect(spy.publishedEvents).toContainEqual({
 *   name: "Incremented",
 *   payload: { amount: 5 },
 * });
 * ```
 */
export async function testDomain<
  TInfrastructure extends Infrastructure = Infrastructure,
>(
  config: TestDomainConfig<TInfrastructure>,
): Promise<TestDomainResult<TInfrastructure>> {
  const publishedEvents: Event[] = [];
  const dispatchedCommands: Command[] = [];
  const unhandledCommands: Command[] = [];
  const commandErrors: Array<{ command: Command; error: Error }> = [];

  const eventBus = new EventEmitterEventBus();
  const originalEventDispatch = eventBus.dispatch.bind(eventBus);
  eventBus.dispatch = async <TEvent extends Event>(
    event: TEvent,
  ): Promise<void> => {
    publishedEvents.push(event);
    await originalEventDispatch(event);
  };

  // Shared bookkeeping for both dispatch entry points below: pushes the
  // command, then partitions the outcome into unhandledCommands (suppressed)
  // or commandErrors (recorded + rethrown).
  const recordDispatch = async <T>(
    command: Command,
    dispatch: () => Promise<T>,
  ): Promise<T> => {
    dispatchedCommands.push(command);
    try {
      return await dispatch();
    } catch (error) {
      if (isMissingHandlerError(error, command.name)) {
        unhandledCommands.push(command);
        return undefined as T;
      }
      commandErrors.push({ command, error: error as Error });
      throw error;
    }
  };

  const commandBus = new InMemoryCommandBus();
  const originalCommandDispatch = commandBus.dispatch.bind(commandBus);
  commandBus.dispatch = (command: Command): Promise<void> =>
    recordDispatch(command, () => originalCommandDispatch(command));

  const definition = defineDomain<TInfrastructure>({
    writeModel: {
      aggregates: config.aggregates ?? {},
    },
    readModel: {
      projections: config.projections ?? {},
      ...(config.standaloneQueryHandlers
        ? { standaloneQueryHandlers: config.standaloneQueryHandlers }
        : {}),
    },
    processModel: config.sagas ? { sagas: config.sagas } : undefined,
  });

  const domain = await wireDomain(definition, {
    infrastructure: () => (config.infrastructure ?? {}) as TInfrastructure,
    buses: () => ({
      commandBus,
      eventBus,
      queryBus: new InMemoryQueryBus(),
    }),
    aggregates: {
      persistence: () => new InMemoryEventSourcedAggregatePersistence(),
    },
    ...(config.projectionViewStores
      ? { projections: config.projectionViewStores }
      : {}),
    ...(config.sagas
      ? { sagas: { persistence: () => new InMemorySagaPersistence() } }
      : {}),
  });

  // `domain.dispatchCommand` routes commands with a matching aggregate
  // `decide` handler directly to the command executor, bypassing
  // `commandBus.dispatch` entirely (see @noddde/engine's Domain.dispatchCommand).
  // Wrap it too, but only for those aggregate-routed command names, so
  // commands that *do* fall through to the (already-spied) commandBus
  // aren't double-counted.
  const aggregateCommandNames = new Set(
    Object.values(config.aggregates ?? {}).flatMap((aggregate) =>
      Object.keys(aggregate.decide),
    ),
  );
  const originalDispatchCommand = domain.dispatchCommand.bind(domain);
  (domain as { dispatchCommand: unknown }).dispatchCommand = (
    command: Command,
  ) =>
    aggregateCommandNames.has(command.name)
      ? recordDispatch(command, () => originalDispatchCommand(command as any))
      : originalDispatchCommand(command as any);

  return {
    domain,
    spy: {
      publishedEvents,
      dispatchedCommands,
      unhandledCommands,
      commandErrors,
    },
  };
}
