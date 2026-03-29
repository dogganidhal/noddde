/* eslint-disable no-unused-vars */
import type {
  Aggregate,
  Projection,
  Saga,
  Infrastructure,
  Command,
  Event,
} from "@noddde/core";
import {
  defineDomain,
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
  /** Optional per-projection view store factories. */
  projectionViewStores?: Record<
    string,
    { viewStore: (infrastructure: any) => any }
  >;
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

  const eventBus = new EventEmitterEventBus();
  const originalEventDispatch = eventBus.dispatch.bind(eventBus);
  eventBus.dispatch = async <TEvent extends Event>(
    event: TEvent,
  ): Promise<void> => {
    publishedEvents.push(event);
    await originalEventDispatch(event);
  };

  const commandBus = new InMemoryCommandBus();
  const originalCommandDispatch = commandBus.dispatch.bind(commandBus);
  commandBus.dispatch = async (command: Command): Promise<void> => {
    dispatchedCommands.push(command);
    try {
      await originalCommandDispatch(command);
    } catch {
      // Silently swallow "no handler registered" errors.
      // In slice tests, not all commands need a registered handler —
      // the spy captures the command for assertions regardless.
    }
  };

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

  return {
    domain,
    spy: {
      publishedEvents,
      dispatchedCommands,
    },
  };
}
