/* eslint-disable no-unused-vars */
import { eq, and } from "drizzle-orm";
import {
  ConcurrencyError,
  type StateStoredAggregatePersistence,
} from "@noddde/core";
import type { DrizzleTransactionStore } from "./index";
import type { StateTableColumnMap } from "./builder";

/**
 * Drizzle-backed state-stored aggregate persistence bound to a
 * dedicated per-aggregate table. Unlike the shared persistence,
 * this class ignores the `aggregateName` parameter — the table
 * itself is the namespace.
 *
 * Supports custom column mappings for tables where column names
 * differ from the noddde convention.
 */
export class DrizzleDedicatedStateStoredPersistence
  implements StateStoredAggregatePersistence
{
  private readonly idKey: string;
  private readonly stateKey: string;
  private readonly versionKey: string;

  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly table: any,
    private readonly columns: StateTableColumnMap,
  ) {
    // Resolve the JS property key for each column by matching the column
    // reference against the table definition entries. Drizzle's values()
    // and result rows use JS property keys, not DB column names.
    this.idKey = findKeyForColumn(table, columns.aggregateId);
    this.stateKey = findKeyForColumn(table, columns.state);
    this.versionKey = findKeyForColumn(table, columns.version);
  }

  private getExecutor() {
    return this.txStore.current ?? this.db;
  }

  async save(
    _aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void> {
    const executor = this.getExecutor();
    const serialized = JSON.stringify(state);

    if (expectedVersion === 0) {
      // Insert path: new aggregate
      try {
        await executor.insert(this.table).values({
          [this.idKey]: aggregateId,
          [this.stateKey]: serialized,
          [this.versionKey]: 1,
        });
      } catch (error: any) {
        const message = error?.message ?? "";
        if (
          message.includes("UNIQUE constraint failed") || // SQLite
          message.includes("unique constraint") || // PostgreSQL
          message.includes("Duplicate entry") || // MySQL
          message.includes("duplicate key") // PostgreSQL variant
        ) {
          throw new ConcurrencyError(
            _aggregateName,
            aggregateId,
            expectedVersion,
            -1,
          );
        }
        throw error;
      }
    } else {
      // Update path: optimistic concurrency check via version match
      const result = await executor
        .update(this.table)
        .set({
          [this.stateKey]: serialized,
          [this.versionKey]: expectedVersion + 1,
        })
        .where(
          and(
            eq(this.columns.aggregateId, aggregateId),
            eq(this.columns.version, expectedVersion),
          ),
        );

      const rowsAffected =
        result?.rowsAffected ?? result?.changes ?? result?.rowCount ?? 0;
      if (rowsAffected === 0) {
        throw new ConcurrencyError(
          _aggregateName,
          aggregateId,
          expectedVersion,
          -1,
        );
      }
    }
  }

  async load(
    _aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: any; version: number } | null> {
    const executor = this.getExecutor();

    const rows = await executor
      .select()
      .from(this.table)
      .where(eq(this.columns.aggregateId, aggregateId));

    if (rows.length === 0) return null;
    const row = rows[0]!;

    const stateValue = row[this.stateKey];
    const versionValue = row[this.versionKey];

    return {
      state:
        typeof stateValue === "string" ? JSON.parse(stateValue) : stateValue,
      version: versionValue,
    };
  }
}

/**
 * Finds the JS property key in a Drizzle table definition for a given column reference.
 */
function findKeyForColumn(table: any, column: any): string {
  for (const [key, value] of Object.entries(table)) {
    if (value === column) return key;
  }
  // Fallback to column.name (DB column name) — shouldn't happen if column came from the table
  return column.name;
}
