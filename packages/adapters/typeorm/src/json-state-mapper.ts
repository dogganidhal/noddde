import type { TypeORMStateMapper } from "./builder";

/**
 * Default property names used by {@link jsonStateMapper} when no overrides are provided.
 */
const JSON_MAPPER_DEFAULTS = {
  aggregateIdField: "aggregateId",
  versionField: "version",
  stateField: "state",
} as const;

/**
 * Convenience factory that returns a {@link TypeORMStateMapper} serializing the
 * aggregate state to a single JSON text column. Equivalent to the opaque
 * dedicated-state behavior that used fixed column names.
 *
 * Defaults to conventional property names:
 * - `aggregateIdField: "aggregateId"`
 * - `versionField: "version"`
 * - `stateField: "state"`
 *
 * @param options - Optional property-name overrides. Unspecified fields fall
 *                  back to the defaults above.
 *
 * @example
 * ```ts
 * // Default names (aggregateId / version / state)
 * const mapper = jsonStateMapper<OrderEntity>();
 *
 * // Custom column names
 * const mapper = jsonStateMapper<CustomEntity>({
 *   aggregateIdField: "id",
 *   versionField: "rev",
 *   stateField: "data",
 * });
 * ```
 */
export function jsonStateMapper<TEntity>(options?: {
  aggregateIdField?: string;
  versionField?: string;
  stateField?: string;
}): TypeORMStateMapper<unknown, TEntity> {
  const aggregateIdField =
    options?.aggregateIdField ?? JSON_MAPPER_DEFAULTS.aggregateIdField;
  const versionField =
    options?.versionField ?? JSON_MAPPER_DEFAULTS.versionField;
  const stateField = options?.stateField ?? JSON_MAPPER_DEFAULTS.stateField;

  return {
    aggregateIdField: aggregateIdField as keyof TEntity & string,
    versionField: versionField as keyof TEntity & string,

    toRow(state: unknown): Partial<TEntity> {
      return { [stateField]: JSON.stringify(state) } as Partial<TEntity>;
    },

    fromRow(row: Partial<TEntity>): unknown {
      const stateValue = (row as any)[stateField];
      if (typeof stateValue === "string") {
        return JSON.parse(stateValue);
      }
      // Already a parsed object (some drivers/test setups may return it pre-parsed)
      return stateValue;
    },
  };
}
