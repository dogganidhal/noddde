import { afterAll, beforeAll, beforeEach } from "vitest";
import { DataSource } from "typeorm";
import {
  definePersistenceContract,
  defineSagaContract,
  defineSnapshotContract,
  defineOutboxContract,
  defineUnitOfWorkContract,
} from "@noddde/testing-integration";
import { buildAdapter, makeDataSource, truncateAll } from "./helpers";
import { NodddeOutboxEntryEntity } from "../../entities";

let ds: DataSource;

beforeAll(async () => {
  ds = await makeDataSource({
    type: "better-sqlite3",
    database: ":memory:",
  });
}, 30_000);

afterAll(async () => {
  await ds?.destroy();
});

beforeEach(async () => {
  await truncateAll(ds);
});

definePersistenceContract("typeorm/sqlite", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
  };
});
defineSagaContract("typeorm/sqlite", () => ({
  saga: buildAdapter(ds).sagaPersistence,
}));
defineSnapshotContract("typeorm/sqlite", () => ({
  snapshots: buildAdapter(ds).snapshotStore,
}));
defineOutboxContract("typeorm/sqlite", () => ({
  outbox: buildAdapter(ds).outboxStore,
  // Raw read of every row so the deletePublished(olderThan) cases can
  // observe which published rows survived (there is no "load published").
  loadAll: async () => {
    const rows = await ds.getRepository(NodddeOutboxEntryEntity).find();
    return rows.map((r) => ({
      id: r.id,
      event: typeof r.event === "string" ? JSON.parse(r.event) : r.event,
      aggregateName: r.aggregateName ?? undefined,
      aggregateId: r.aggregateId ?? undefined,
      createdAt: new Date(r.createdAt),
      publishedAt: r.publishedAt != null ? new Date(r.publishedAt) : null,
    }));
  },
}));
defineUnitOfWorkContract("typeorm/sqlite", () => {
  const a = buildAdapter(ds);
  return {
    eventSourced: a.eventSourcedPersistence,
    stateStored: a.stateStoredPersistence,
    uowFactory: a.unitOfWorkFactory,
  };
});
