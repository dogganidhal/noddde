/* eslint-disable no-unused-vars */
import { and, asc, eq, gt } from "drizzle-orm";
import type { Event, EventReader, EventReadOptions } from "@noddde/core";
import type { DrizzleNodddeSchema } from "./index";
import { deserializeEvent } from "./persistence";

const DEFAULT_BATCH_SIZE = 500;

/**
 * Drizzle-backed {@link EventReader}. Streams the global `noddde_events` log
 * in append (auto-increment `id`) order via keyset pagination, batching so
 * the full log is never materialized in memory.
 *
 * Reads always run against the base `db` (never enlisted in a UoW
 * transaction) — this is a standalone recovery/rebuild operation, not part
 * of a command's write path.
 *
 * **Quiescence assumption**: `id` is a plain auto-increment column, so under
 * concurrent writers a row with a lower `id` can commit *after* a row with a
 * higher `id` (the sequence value is reserved before the transaction
 * commits). `read()` is only guaranteed complete and gap-free when called
 * against a quiescent log — e.g. during an offline projection rebuild with
 * no concurrent writers. It is not a substitute for a true monotonic
 * global-sequence write path.
 */
export class DrizzleEventReader implements EventReader {
  constructor(
    private readonly db: any,
    private readonly schema: DrizzleNodddeSchema,
    private readonly batchSize: number = DEFAULT_BATCH_SIZE,
  ) {}

  async *read(options?: EventReadOptions): AsyncIterable<Event> {
    const eventsTable = this.schema.events;
    let cursor = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const condition = options?.aggregateName
        ? and(
            gt(eventsTable.id, cursor),
            eq(eventsTable.aggregateName, options.aggregateName),
          )
        : gt(eventsTable.id, cursor);

      const rows = await this.db
        .select()
        .from(eventsTable)
        .where(condition)
        .orderBy(asc(eventsTable.id))
        .limit(this.batchSize);

      if (rows.length === 0) return;

      for (const row of rows) {
        yield deserializeEvent(row);
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < this.batchSize) return;
    }
  }
}
