/* eslint-disable no-unused-vars */
import { MoreThan } from "typeorm";
import type {
  DataSource,
  EntityManager,
  Repository,
  ObjectLiteral,
} from "typeorm";
import type {
  Event,
  EventMetadata,
  EventReader,
  EventReadOptions,
} from "@noddde/core";
import type { NodddeEventEntity } from "./entities";

const EVENTS_TABLE = "noddde_events";
const BATCH_SIZE = 500;

function getEventsRepo(manager: EntityManager): Repository<NodddeEventEntity> {
  const meta = manager.connection.entityMetadatas.find(
    (m) => m.tableName === EVENTS_TABLE,
  );
  if (!meta) {
    throw new Error(
      `@noddde/typeorm: no entity is registered for table "${EVENTS_TABLE}" on ` +
        `this DataSource. Register the noddde entities, e.g. ` +
        `entities: Object.values(createNodddeEntities(dataSource.options.type)).`,
    );
  }
  return manager.getRepository<ObjectLiteral>(
    meta.target as new () => ObjectLiteral,
  ) as unknown as Repository<NodddeEventEntity>;
}

function deserializeEvent(row: NodddeEventEntity): Event {
  const event: Event = {
    name: row.eventName,
    payload: JSON.parse(row.payload),
  };
  if (row.metadata != null) {
    event.metadata = JSON.parse(row.metadata) as EventMetadata;
  }
  return event;
}

/**
 * Reads the entire `noddde_events` log in global append order via keyset
 * pagination on the table's auto-increment `id` column.
 *
 * Ordering caveat: `id` is assigned by the database's auto-increment
 * sequence at INSERT time, but under concurrent writers two transactions can
 * commit out of order relative to when their `id` was reserved (a lower id
 * can commit after a higher one). `read()` is therefore only guaranteed to
 * be complete and gap-free when called against a quiescent log — e.g. an
 * offline projection rebuild — not while writers are concurrently active.
 */
export class TypeORMEventReader implements EventReader {
  constructor(private readonly dataSource: DataSource) {}

  async *read(options?: EventReadOptions): AsyncIterable<Event> {
    const repo = getEventsRepo(this.dataSource.manager);
    let cursor = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await repo.find({
        where: {
          id: MoreThan(cursor),
          ...(options?.aggregateName
            ? { aggregateName: options.aggregateName }
            : {}),
        } as any,
        order: { id: "ASC" } as any,
        take: BATCH_SIZE,
      });

      if (rows.length === 0) break;

      for (const row of rows) {
        yield deserializeEvent(row);
      }

      cursor = rows[rows.length - 1]!.id;
      if (rows.length < BATCH_SIZE) break;
    }
  }
}
