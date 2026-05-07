import type { PrismaStateMapper } from "./builder";

const DEFAULTS = {
  aggregateIdField: "aggregateId",
  versionField: "version",
  stateField: "state",
} as const;

/**
 * Builds a {@link PrismaStateMapper} that serialises the entire aggregate
 * state into a single JSON text column. This is functionally equivalent to
 * the opaque behaviour of the old `PrismaStateTableColumnMap`-based adapter.
 *
 * Defaults: `{ aggregateIdField: "aggregateId", versionField: "version",
 * stateField: "state" }`. Override any of these via the options argument.
 *
 * @param options - Optional property-name overrides.
 * @returns A PrismaStateMapper that round-trips state through JSON.stringify / JSON.parse.
 */
export function jsonStateMapper(options?: {
  aggregateIdField?: string;
  versionField?: string;
  stateField?: string;
}): PrismaStateMapper<unknown, Record<string, unknown>> {
  const aggregateIdField =
    options?.aggregateIdField ?? DEFAULTS.aggregateIdField;
  const versionField = options?.versionField ?? DEFAULTS.versionField;
  const stateField = options?.stateField ?? DEFAULTS.stateField;

  return {
    aggregateIdField,
    versionField,
    toRow(state: unknown): Record<string, unknown> {
      return { [stateField]: JSON.stringify(state) };
    },
    fromRow(row: Partial<Record<string, unknown>>): unknown {
      const value = row[stateField];
      // Support both pre-parsed objects (e.g. from JSON db drivers) and strings
      if (typeof value === "string") {
        return JSON.parse(value);
      }
      return value;
    },
  };
}
