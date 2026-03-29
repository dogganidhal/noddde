/**
 * Convention-based column resolution for per-aggregate state tables.
 * Inspects a Drizzle table definition to find columns matching the
 * expected names for state-stored aggregate persistence.
 *
 * @module
 */

import type { StateTableColumnMap } from "./builder";

/** Column names expected by convention. */
const CONVENTION_NAMES = {
  aggregateId: "aggregate_id",
  state: "state",
  version: "version",
} as const;

/**
 * Attempts to resolve column references from a Drizzle table definition
 * using convention-based naming. Looks for columns with DB names
 * `aggregate_id`, `state`, `version`.
 *
 * @param table - A Drizzle table definition (any dialect).
 * @param aggregateName - The aggregate name, used in error messages.
 * @returns Resolved column map.
 * @throws If any required column is not found.
 */
export function resolveColumnsByConvention(
  table: any,
  aggregateName: string,
): StateTableColumnMap {
  // Drizzle tables expose columns as properties on the table object.
  // Each column has a `.name` property (the DB column name).
  const columns = Object.values(table).filter(
    (col: any) => col && typeof col === "object" && "name" in col,
  );

  const columnsByDbName = new Map<string, any>();
  for (const col of columns) {
    columnsByDbName.set((col as any).name, col);
  }

  const aggregateId = columnsByDbName.get(CONVENTION_NAMES.aggregateId);
  const state = columnsByDbName.get(CONVENTION_NAMES.state);
  const version = columnsByDbName.get(CONVENTION_NAMES.version);

  const missing: string[] = [];
  if (!aggregateId) missing.push("aggregate_id");
  if (!state) missing.push("state");
  if (!version) missing.push("version");

  if (missing.length > 0) {
    const available = columns.map((c: any) => c.name).join(", ");
    throw new Error(
      `Convention-based column resolution failed for aggregate "${aggregateName}". ` +
        `Missing required columns: ${missing.join(", ")} (aggregate_id, state, version). ` +
        `Available columns in table: ${available}. ` +
        `Provide explicit column mappings via the 'columns' option.`,
    );
  }

  return { aggregateId, state, version };
}

/**
 * Merges explicit partial column mappings with convention-based resolution.
 * Explicit mappings take precedence; missing mappings fall back to convention.
 *
 * @param table - A Drizzle table definition.
 * @param aggregateName - The aggregate name, used in error messages.
 * @param explicit - Partial column mappings provided by the developer.
 * @returns Complete column map.
 */
export function resolveColumns(
  table: any,
  aggregateName: string,
  explicit?: Partial<StateTableColumnMap>,
): StateTableColumnMap {
  if (explicit && explicit.aggregateId && explicit.state && explicit.version) {
    return explicit as StateTableColumnMap;
  }

  const convention = resolveColumnsByConvention(table, aggregateName);

  return {
    aggregateId: explicit?.aggregateId ?? convention.aggregateId,
    state: explicit?.state ?? convention.state,
    version: explicit?.version ?? convention.version,
  };
}
