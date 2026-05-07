/* eslint-disable no-unused-vars */
import { eq, and } from "drizzle-orm";
import {
  ConcurrencyError,
  type StateStoredAggregatePersistence,
} from "@noddde/core";
import type { DrizzleTransactionStore } from "./index";
import type { DrizzleStateMapper } from "./builder";

/**
 * Drizzle-backed state-stored aggregate persistence bound to a
 * dedicated per-aggregate table. Unlike the shared persistence,
 * this class ignores the `aggregateName` parameter — the table
 * itself is the namespace.
 *
 * State encoding and decoding is fully delegated to the provided
 * {@link DrizzleStateMapper}. The adapter writes the aggregate-id
 * and version columns itself using the keys resolved from the mapper's
 * column references at construction time.
 */
export class DrizzleDedicatedStateStoredPersistence
  implements StateStoredAggregatePersistence
{
  private readonly idKey: string;
  private readonly versionKey: string;

  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly table: any,
    private readonly mapper: DrizzleStateMapper<any, any>,
  ) {
    // Resolve JS property keys from column references once at construction
    // time so individual save/load calls don't repeat the scan.
    this.idKey = findKeyForColumn(table, mapper.aggregateIdColumn);
    this.versionKey = findKeyForColumn(table, mapper.versionColumn);
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

    // Delegate state serialization to the mapper
    const stateRow = this.mapper.toRow(state);

    if (expectedVersion === 0) {
      // Insert path: new aggregate
      try {
        await executor.insert(this.table).values({
          ...stateRow,
          [this.idKey]: aggregateId,
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
          ...stateRow,
          [this.versionKey]: expectedVersion + 1,
        })
        .where(
          and(
            eq(this.mapper.aggregateIdColumn, aggregateId),
            eq(this.mapper.versionColumn, expectedVersion),
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
      .where(eq(this.mapper.aggregateIdColumn, aggregateId));

    if (rows.length === 0) return null;
    const row = rows[0]!;

    const versionValue = row[this.versionKey];

    // Strip the aggregate-id and version columns; pass the remainder to the mapper
    const stateRow = { ...row };
    delete stateRow[this.idKey];
    delete stateRow[this.versionKey];

    return {
      state: this.mapper.fromRow(stateRow),
      version: versionValue,
    };
  }
}

/**
 * Finds the JS property key in a Drizzle table definition for a given
 * column reference. Throws if the column is not found among the table's
 * own properties — this catches mappers that point at a column from a
 * different table.
 * @internal
 */
function findKeyForColumn(table: any, column: any): string {
  for (const [key, value] of Object.entries(table)) {
    if (value === column) return key;
  }
  const columnName = (column as { name?: string } | null | undefined)?.name;
  throw new Error(
    `Column reference${columnName ? ` "${columnName}"` : ""} not found ` +
      `among the table's properties. The mapper's aggregateIdColumn / ` +
      `versionColumn must be columns from the same Drizzle table passed ` +
      `to stateStored() / aggregateStates.`,
  );
}
