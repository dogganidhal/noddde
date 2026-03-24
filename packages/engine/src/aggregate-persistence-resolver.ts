/* eslint-disable no-unused-vars */
import type { PersistenceConfiguration } from "@noddde/core";

/**
 * Internal strategy interface for resolving the correct aggregate
 * persistence at command dispatch time. The Domain constructs the
 * appropriate implementation during `init()` based on the
 * `aggregatePersistence` configuration.
 *
 * @internal Not exported — users configure persistence via
 * `DomainConfiguration.infrastructure.aggregatePersistence`.
 */
export interface AggregatePersistenceResolver {
  /**
   * Resolves the persistence configuration for the given aggregate.
   *
   * @param aggregateName - The aggregate type name.
   * @returns The persistence configuration for this aggregate.
   */
  resolve(aggregateName: string): PersistenceConfiguration;
}

/**
 * Domain-wide persistence resolver: all aggregates share one persistence
 * instance. Used when `aggregatePersistence` is omitted (in-memory default)
 * or is a single factory function.
 *
 * @internal
 */
export class GlobalAggregatePersistenceResolver
  implements AggregatePersistenceResolver
{
  constructor(private readonly persistence: PersistenceConfiguration) {}

  resolve(_aggregateName: string): PersistenceConfiguration {
    return this.persistence;
  }
}

/**
 * Per-aggregate persistence resolver: each aggregate has its own
 * persistence instance. Used when `aggregatePersistence` is a
 * per-aggregate record mapping aggregate names to factories.
 *
 * @internal
 */
export class PerAggregatePersistenceResolver
  implements AggregatePersistenceResolver
{
  constructor(private readonly map: Map<string, PersistenceConfiguration>) {}

  resolve(aggregateName: string): PersistenceConfiguration {
    const persistence = this.map.get(aggregateName);
    if (!persistence) {
      throw new Error(
        `No persistence configured for aggregate "${aggregateName}"`,
      );
    }
    return persistence;
  }
}
