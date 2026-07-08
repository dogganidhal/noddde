import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import { createNodddeEntities } from "../../entities";
import { createTypeORMAdapter } from "../../builder";

/**
 * Builds a DataSource for the given options, runs synchronize() so the
 * schema is fresh, and returns it. Caller owns shutdown.
 *
 * Entities are chosen per dialect via `createNodddeEntities(options.type)`, so
 * MSSQL gets the `nvarchar(max)` Unicode-safe variant.
 */
export async function makeDataSource(
  options: DataSourceOptions,
): Promise<DataSource> {
  const entities = Object.values(createNodddeEntities(options.type));
  const ds = new DataSource({
    ...options,
    entities,
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

/** Truncates every noddde table on the data source between tests. */
export async function truncateAll(ds: DataSource): Promise<void> {
  // TypeORM doesn't have a portable "truncate every table", so use ORM-level
  // deletes; resolve each repository by table name to stay agnostic of which
  // entity variant (default vs dialect-specific) was registered.
  for (const table of [
    "noddde_outbox",
    "noddde_snapshots",
    "noddde_saga_states",
    "noddde_aggregate_states",
    "noddde_events",
  ]) {
    const meta = ds.entityMetadatas.find((m) => m.tableName === table);
    if (meta) await ds.getRepository(meta.target).clear();
  }
}

export function buildAdapter(ds: DataSource) {
  return createTypeORMAdapter(ds, {
    snapshotStore: true,
    outboxStore: true,
  });
}
