import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import {
  NodddeAggregateStateEntity,
  NodddeEventEntity,
  NodddeOutboxEntryEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
} from "../../entities";
import { createTypeORMAdapter } from "../../builder";

export const ENTITIES = [
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
];

/**
 * Builds a DataSource for the given options, runs synchronize() so the
 * schema is fresh, and returns it. Caller owns shutdown.
 */
export async function makeDataSource(
  options: DataSourceOptions,
): Promise<DataSource> {
  const ds = new DataSource({
    ...options,
    entities: ENTITIES,
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

/** Truncates every noddde table on the data source between tests. */
export async function truncateAll(ds: DataSource): Promise<void> {
  // TypeORM doesn't have a portable "truncate every table", so use ORM-level
  // deletes via the QueryBuilder; ordering matters for FKs (none here, but
  // be conservative).
  await ds.getRepository(NodddeOutboxEntryEntity).clear();
  await ds.getRepository(NodddeSnapshotEntity).clear();
  await ds.getRepository(NodddeSagaStateEntity).clear();
  await ds.getRepository(NodddeAggregateStateEntity).clear();
  await ds.getRepository(NodddeEventEntity).clear();
}

export function buildAdapter(ds: DataSource) {
  return createTypeORMAdapter(ds, {
    snapshotStore: true,
    outboxStore: true,
  });
}
