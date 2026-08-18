import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { NodddeEventEntity } from "../entities";
import { TypeORMEventReader } from "../event-reader";

let dataSource: DataSource;

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("TypeORMEventReader", () => {
  beforeEach(async () => {
    dataSource = new DataSource({
      type: "better-sqlite3",
      database: ":memory:",
      entities: [NodddeEventEntity],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it("reads the full log in global id order across aggregates", async () => {
    const repo = dataSource.getRepository(NodddeEventEntity);
    await repo.insert({
      aggregateName: "Order",
      aggregateId: "o-1",
      sequenceNumber: 1,
      eventName: "OrderPlaced",
      payload: JSON.stringify({ total: 1 }),
      metadata: null,
      createdAt: new Date(),
    });
    await repo.insert({
      aggregateName: "Account",
      aggregateId: "a-1",
      sequenceNumber: 1,
      eventName: "AccountCreated",
      payload: JSON.stringify({ owner: "Alice" }),
      metadata: null,
      createdAt: new Date(),
    });
    await repo.insert({
      aggregateName: "Order",
      aggregateId: "o-1",
      sequenceNumber: 2,
      eventName: "OrderConfirmed",
      payload: JSON.stringify({}),
      metadata: null,
      createdAt: new Date(),
    });

    const reader = new TypeORMEventReader(dataSource);
    const events = await collect(reader.read());

    expect(events.map((e) => e.name)).toEqual([
      "OrderPlaced",
      "AccountCreated",
      "OrderConfirmed",
    ]);
    expect(events[0]!.payload).toEqual({ total: 1 });
  });

  it("filters by aggregateName when given", async () => {
    const repo = dataSource.getRepository(NodddeEventEntity);
    await repo.insert({
      aggregateName: "Order",
      aggregateId: "o-1",
      sequenceNumber: 1,
      eventName: "OrderPlaced",
      payload: JSON.stringify({}),
      metadata: null,
      createdAt: new Date(),
    });
    await repo.insert({
      aggregateName: "Account",
      aggregateId: "a-1",
      sequenceNumber: 1,
      eventName: "AccountCreated",
      payload: JSON.stringify({}),
      metadata: null,
      createdAt: new Date(),
    });

    const reader = new TypeORMEventReader(dataSource);
    const events = await collect(reader.read({ aggregateName: "Account" }));

    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("AccountCreated");
  });

  it("yields nothing for an empty log", async () => {
    const reader = new TypeORMEventReader(dataSource);
    const events = await collect(reader.read());
    expect(events).toEqual([]);
  });
});
