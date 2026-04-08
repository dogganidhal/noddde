import { describe, it, expect, vi, afterEach } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";
import type { Event } from "@noddde/core";

describe("OutboxRelay", () => {
  it("should dispatch each unpublished entry and mark it published", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus);

    const dispatched: Event[] = [];
    eventBus.on("OrderCreated", (event: Event) => dispatched.push(event));

    await store.save([
      {
        id: "e1",
        event: { name: "OrderCreated", payload: { orderId: "o1" } },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        publishedAt: null,
      },
    ]);

    const count = await relay.processOnce();

    expect(count).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.name).toBe("OrderCreated");

    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(0);
  });

  it("should return 0 when there are no unpublished entries", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus);

    const count = await relay.processOnce();
    expect(count).toBe(0);
  });

  it("should skip entries that fail to dispatch and process the rest", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus);

    // First event handler throws
    eventBus.on("FailEvent", () => {
      throw new Error("Dispatch failed");
    });
    const dispatched: Event[] = [];
    eventBus.on("SuccessEvent", (event: Event) => dispatched.push(event));

    await store.save([
      {
        id: "fail",
        event: { name: "FailEvent", payload: {} },
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        publishedAt: null,
      },
      {
        id: "success",
        event: { name: "SuccessEvent", payload: {} },
        createdAt: new Date("2025-01-01T00:00:01.000Z"),
        publishedAt: null,
      },
    ]);

    const count = await relay.processOnce();

    expect(count).toBe(1);
    expect(dispatched).toHaveLength(1);

    // Failed entry should still be unpublished
    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("fail");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should poll at the configured interval and stop when told", async () => {
    vi.useFakeTimers();
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus, { pollIntervalMs: 100 });

    const processOnceSpy = vi.spyOn(relay, "processOnce");

    relay.start();

    // Advance time by 350ms — should trigger ~3 polls
    await vi.advanceTimersByTimeAsync(350);

    expect(processOnceSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    relay.stop();
    const callCount = processOnceSpy.mock.calls.length;

    // Advance more time — no new calls
    await vi.advanceTimersByTimeAsync(200);
    expect(processOnceSpy.mock.calls.length).toBe(callCount);
  });

  it("should not create multiple timers when start is called twice", async () => {
    vi.useFakeTimers();
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus, { pollIntervalMs: 100 });
    const processOnceSpy = vi.spyOn(relay, "processOnce");

    relay.start();
    relay.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(350);

    // Should have ~3 calls, not ~6
    expect(processOnceSpy.mock.calls.length).toBeLessThanOrEqual(4);

    relay.stop();
  });

  it("should process at most batchSize entries per call", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus, { batchSize: 2 });

    const dispatched: Event[] = [];
    eventBus.on("Evt", (event: Event) => dispatched.push(event));

    await store.save(
      Array.from({ length: 5 }, (_, i) => ({
        id: `e${i}`,
        event: { name: "Evt", payload: { i } },
        createdAt: new Date(`2025-01-01T00:00:0${i}.000Z`),
        publishedAt: null,
      })),
    );

    const count = await relay.processOnce();

    expect(count).toBe(2);
    expect(dispatched).toHaveLength(2);

    // 3 entries should remain unpublished
    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(3);
  });
});
