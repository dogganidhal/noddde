import { eq, lte } from "drizzle-orm";
import type { EventIdempotencyStore } from "@noddde/core";
import type { DrizzleTransactionStore } from "./index";
import { isUniqueViolation } from "./errors";

/**
 * Serializes a `Date` to a string accepted by every dialect we target.
 *
 * - SQLite stores it verbatim in a TEXT column (sorts lexicographically the
 *   same as a timestamp).
 * - PostgreSQL `TIMESTAMPTZ` parses it as UTC.
 * - MySQL `TIMESTAMP(3)` rejects the `Z` timezone marker but accepts the
 *   space-separated ISO-without-zone form (`YYYY-MM-DD HH:MM:SS.fff`),
 *   which is what we emit.
 */
function toDbTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Drizzle-backed implementation of `EventIdempotencyStore` (`@noddde/core`).
 * Backs `withIdempotency()` with a real table (`noddde_event_idempotency`)
 * so dedup state survives restarts and is shared across process instances,
 * unlike an in-memory store.
 *
 * Dialect-agnostic, like `DrizzleOutboxStore`/`DrizzleSnapshotStore`: the
 * caller supplies the dialect-specific table definition. Enlists in the
 * active `DrizzleTransactionStore`'s transaction when one is present.
 *
 * `table` is the dialect-specific Drizzle table definition for the
 * `noddde_event_idempotency` table — import `eventIdempotency` from
 * `@noddde/drizzle/pg`, `@noddde/drizzle/mysql`, or `@noddde/drizzle/sqlite`,
 * or supply your own table matching the same column shape (`key`,
 * `processedAt`).
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/better-sqlite3";
 * import Database from "better-sqlite3";
 * import { eventIdempotency } from "@noddde/drizzle/sqlite";
 * import { DrizzleEventIdempotencyStore } from "@noddde/drizzle";
 * import { withIdempotency } from "@noddde/core";
 *
 * const db = drizzle(new Database("app.db"));
 * const store = new DrizzleEventIdempotencyStore(db, { als: new AsyncLocalStorage() }, eventIdempotency);
 * const handler = withIdempotency(myHandler, store);
 * ```
 */
export class DrizzleEventIdempotencyStore implements EventIdempotencyStore {
  constructor(
    private readonly db: any,
    private readonly txStore: DrizzleTransactionStore,
    private readonly table: any,
    private readonly ttlMs?: number,
  ) {}

  private getExecutor() {
    return this.txStore.als.getStore() ?? this.db;
  }

  /**
   * Checks whether `key` has already been recorded as processed. If a
   * `ttlMs` was configured at construction time and the recorded row is
   * older than it, the stale row is deleted and `false` is returned.
   */
  async hasProcessed(key: string): Promise<boolean> {
    const executor = this.getExecutor();

    const rows = await executor
      .select()
      .from(this.table)
      .where(eq(this.table.key, key));

    if (rows.length === 0) return false;

    const row = rows[0]!;

    if (this.ttlMs != null) {
      const age = Date.now() - new Date(row.processedAt).getTime();
      if (age > this.ttlMs) {
        await executor.delete(this.table).where(eq(this.table.key, key));
        return false;
      }
    }

    return true;
  }

  /**
   * Records `key` as processed. Idempotent: if the key is already
   * recorded, the resulting primary-key violation is caught and treated
   * as success rather than propagated.
   */
  async markProcessed(key: string): Promise<void> {
    const executor = this.getExecutor();

    try {
      await executor.insert(this.table).values({
        key,
        processedAt: toDbTimestamp(new Date()),
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Deletes all records processed at or before `Date.now() - ttlMs`.
   * An operational/maintenance method independent of the constructor's
   * `ttlMs` — never called automatically by `withIdempotency`.
   */
  async removeExpired(ttlMs: number): Promise<void> {
    const executor = this.getExecutor();
    const threshold = toDbTimestamp(new Date(Date.now() - ttlMs));

    await executor
      .delete(this.table)
      .where(lte(this.table.processedAt, threshold));
  }
}
