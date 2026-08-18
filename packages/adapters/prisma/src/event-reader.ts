/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { Event, EventReadOptions, EventReader } from "@noddde/core";

const BATCH_SIZE = 500;

/**
 * Prisma-backed {@link EventReader}. Streams every persisted event ordered by
 * the global auto-increment `id` column on `noddde_events`, in batches, so
 * `Domain.rebuildProjection` never materializes the full event log in memory.
 *
 * Reads always go through the base `PrismaClient` passed at construction —
 * never through the active `PrismaTransactionStore` — since this is a
 * standalone read, not an operation enlisted in a `UnitOfWork`.
 *
 * Quiescence assumption: `id` is a plain auto-increment column. Under
 * concurrent writers, rows can commit out of global `id` order (a
 * higher-numbered id can become visible before a lower-numbered one still
 * mid-transaction). `read()` is only guaranteed complete and gap-free when
 * called against a quiescent log — e.g. an offline projection rebuild with no
 * concurrent writers — not as a live tailing mechanism.
 */
export class PrismaEventReader implements EventReader {
  constructor(private readonly prisma: PrismaClient) {}

  async *read(options?: EventReadOptions): AsyncIterable<Event> {
    let cursor = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows: any[] = await (this.prisma as any).nodddeEvent.findMany({
        where: {
          id: { gt: cursor },
          ...(options?.aggregateName
            ? { aggregateName: options.aggregateName }
            : {}),
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });

      if (rows.length === 0) return;

      for (const row of rows) {
        const event: Event = {
          name: row.eventName,
          payload: JSON.parse(row.payload),
        };
        if (row.metadata != null) {
          event.metadata = JSON.parse(row.metadata);
        }
        yield event;
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < BATCH_SIZE) return;
    }
  }
}
