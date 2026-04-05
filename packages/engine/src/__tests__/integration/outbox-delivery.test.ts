import { describe, it, expect, vi } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineAggregate } from "@noddde/core";
import {
  defineDomain,
  wireDomain,
  InMemoryOutboxStore,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";

type OrderCommands = DefineCommands<{
  PlaceOrder: { total: number };
}>;

type OrderEvents = DefineEvents<{
  OrderPlaced: { total: number };
}>;

const Order = defineAggregate<{
  state: { placed: boolean };
  events: OrderEvents;
  commands: OrderCommands;
  id: string;
  ports: {};
}>({
  name: "Order",
  initialState: { placed: false },
  decide: {
    PlaceOrder: (cmd) => ({
      name: "OrderPlaced" as const,
      payload: { total: cmd.payload.total },
    }),
  },
  evolve: {
    OrderPlaced: (_payload, state) => ({ ...state, placed: true }),
  },
});

const orderDefinition = defineDomain({
  writeModel: { aggregates: { Order } },
  readModel: { projections: {} },
});

describe("Outbox Delivery", () => {
  it("should write outbox entries atomically with aggregate persistence", async () => {
    const outboxStore = new InMemoryOutboxStore();

    const domain = await wireDomain(orderDefinition, {
      outbox: { store: () => outboxStore },
    });

    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-1",
      payload: { total: 99.99 },
    });

    const entries = outboxStore.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.event.name).toBe("OrderPlaced");
    expect(entries[0]!.event.payload).toEqual({ total: 99.99 });
    expect(entries[0]!.aggregateName).toBe("Order");
    expect(entries[0]!.aggregateId).toBe("order-1");
    expect(entries[0]!.event.metadata).toBeDefined();
    expect(entries[0]!.event.metadata!.eventId).toBeDefined();
  });

  it("should mark outbox entries as published on happy path", async () => {
    const outboxStore = new InMemoryOutboxStore();

    const domain = await wireDomain(orderDefinition, {
      outbox: { store: () => outboxStore },
    });

    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-1",
      payload: { total: 50 },
    });

    const entries = outboxStore.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.publishedAt).not.toBeNull();
  });

  it("should recover unpublished entries via processOutboxOnce", async () => {
    const outboxStore = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const dispatchSpy = vi.spyOn(eventBus, "dispatch");

    const domain = await wireDomain(orderDefinition, {
      outbox: { store: () => outboxStore },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    });

    // Manually insert an unpublished outbox entry (simulating crash)
    await outboxStore.save([
      {
        id: "crash-entry-1",
        event: {
          name: "OrderPlaced",
          payload: { total: 42 },
          metadata: { eventId: "evt-crash-1" },
        },
        aggregateName: "Order",
        aggregateId: "order-crash",
        createdAt: new Date().toISOString(),
        publishedAt: null,
      },
    ]);

    dispatchSpy.mockClear();

    const dispatched = await domain.processOutboxOnce();
    expect(dispatched).toBe(1);

    // Event was dispatched via EventBus
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OrderPlaced",
        payload: { total: 42 },
      }),
    );

    // Entry is now marked as published
    const unpublished = await outboxStore.loadUnpublished();
    expect(unpublished).toHaveLength(0);
  });

  it("should write outbox entries for all commands in withUnitOfWork", async () => {
    const outboxStore = new InMemoryOutboxStore();

    const domain = await wireDomain(orderDefinition, {
      outbox: { store: () => outboxStore },
    });

    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "PlaceOrder",
        targetAggregateId: "order-1",
        payload: { total: 100 },
      });
      await domain.dispatchCommand({
        name: "PlaceOrder",
        targetAggregateId: "order-2",
        payload: { total: 200 },
      });
    });

    const entries = outboxStore.findAll();
    expect(entries).toHaveLength(2);

    const eventNames = entries.map((e) => e.event.name);
    expect(eventNames).toEqual(["OrderPlaced", "OrderPlaced"]);

    const aggregateIds = entries.map((e) => e.aggregateId);
    expect(aggregateIds).toContain("order-1");
    expect(aggregateIds).toContain("order-2");

    // All should be marked published (happy path)
    expect(entries.every((e) => e.publishedAt !== null)).toBe(true);
  });

  it("should return 0 from processOutboxOnce when no outbox configured", async () => {
    const domain = await wireDomain(orderDefinition, {});

    const dispatched = await domain.processOutboxOnce();
    expect(dispatched).toBe(0);
  });

  it("should not re-dispatch already published entries", async () => {
    const outboxStore = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const dispatchSpy = vi.spyOn(eventBus, "dispatch");

    const domain = await wireDomain(orderDefinition, {
      outbox: { store: () => outboxStore },
      buses: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus,
        queryBus: new InMemoryQueryBus(),
      }),
    });

    await domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: "order-1",
      payload: { total: 75 },
    });

    // Entry is already published from happy path
    const entries = outboxStore.findAll();
    expect(entries[0]!.publishedAt).not.toBeNull();

    dispatchSpy.mockClear();

    // Relay should find nothing to dispatch
    const dispatched = await domain.processOutboxOnce();
    expect(dispatched).toBe(0);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
