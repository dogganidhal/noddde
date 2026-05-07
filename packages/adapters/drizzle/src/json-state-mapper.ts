/**
 * Convenience factory for building a {@link DrizzleStateMapper} that
 * serializes aggregate state to a single JSON text column. Equivalent
 * to the legacy opaque dedicated-state behavior.
 *
 * @module
 */

import type { AnyColumn, Table } from "drizzle-orm";
import type { DrizzleStateMapper } from "./builder";

/**
 * Builds a {@link DrizzleStateMapper} that serializes the entire
 * aggregate state as JSON into a single column (`stateColumn`), and
 * deserializes it on load.
 *
 * **Convention (no options)**: looks for JS keys `aggregateId`,
 * `version`, and `state` directly on the table object. Throws at call
 * time if any required key is missing, listing all missing keys.
 *
 * **With options**: uses the provided column references for any
 * specified fields; unspecified fields fall back to the convention.
 *
 * @param table   - Drizzle table definition.
 * @param options - Optional column overrides.
 * @returns A {@link DrizzleStateMapper} for opaque-JSON state storage.
 *
 * @throws {Error} At call time when convention resolution finds missing
 *   columns (keys: `aggregateId`, `state`, `version`).
 *
 * @example
 * ```ts
 * // Convention-based (table must have .aggregateId, .state, .version)
 * const mapper = jsonStateMapper(ordersTable);
 *
 * // With explicit overrides for non-conventional column names
 * const mapper = jsonStateMapper(customTable, {
 *   aggregateIdColumn: customTable.id,
 *   stateColumn: customTable.data,
 *   versionColumn: customTable.ver,
 * });
 * ```
 */
export function jsonStateMapper<TTable extends Table>(
  table: TTable,
  options?: {
    aggregateIdColumn?: AnyColumn;
    versionColumn?: AnyColumn;
    stateColumn?: AnyColumn;
  },
): DrizzleStateMapper<unknown, TTable> {
  const tableAsAny = table as any;

  const aggregateIdColumn: AnyColumn =
    options?.aggregateIdColumn ?? tableAsAny["aggregateId"];
  const versionColumn: AnyColumn =
    options?.versionColumn ?? tableAsAny["version"];
  const stateColumn: AnyColumn = options?.stateColumn ?? tableAsAny["state"];

  // Validate that all required columns are present; throw eagerly at call time
  const missing: string[] = [];
  if (!aggregateIdColumn) missing.push("aggregateId");
  if (!stateColumn) missing.push("state");
  if (!versionColumn) missing.push("version");

  if (missing.length > 0) {
    throw new Error(
      `jsonStateMapper: missing required columns — ${missing.join(", ")}. ` +
        `Provide them via options (aggregateIdColumn, stateColumn, versionColumn) ` +
        `or ensure the table has JS keys named "aggregateId", "state", "version".`,
    );
  }

  // Determine the JS property key for the state column so toRow / fromRow
  // can build and read row objects using the same key the ORM uses.
  const stateKey = findKeyForColumn(table, stateColumn);

  return {
    aggregateIdColumn,
    versionColumn,

    toRow(state: unknown): Partial<TTable["$inferInsert"]> {
      return { [stateKey]: JSON.stringify(state) } as Partial<
        TTable["$inferInsert"]
      >;
    },

    fromRow(row: Partial<TTable["$inferInsert"]>): unknown {
      const raw = (row as any)[stateKey];
      if (typeof raw === "string") {
        return JSON.parse(raw);
      }
      // Already deserialized (e.g. JSONB in PostgreSQL)
      return raw;
    },
  };
}

/**
 * Finds the JS property key in a Drizzle table definition for a given
 * column reference. Falls back to the column's DB name if not found.
 * @internal
 */
function findKeyForColumn(table: any, column: any): string {
  for (const [key, value] of Object.entries(table)) {
    if (value === column) return key;
  }
  return (column as any).name;
}
