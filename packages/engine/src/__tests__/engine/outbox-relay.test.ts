import { describe, it, expect, vi, afterEach } from "vitest";
import { OutboxRelay } from "../../outbox-relay";
import { InMemoryOutboxStore, EventEmitterEventBus } from "@noddde/engine";
import type { Event, OutboxStore, OutboxEntry, Logger } from "@noddde/core";

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

  it("should mark all entries published even when a handler throws — handler errors are isolated by the bus", async () => {
    const store = new InMemoryOutboxStore();
    const eventBus = new EventEmitterEventBus();
    const relay = new OutboxRelay(store, eventBus);

    // First event handler throws — but EventEmitterEventBus isolates handler
    // errors so dispatch() resolves regardless, and the relay marks both entries published.
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

    // Both entries dispatched successfully — handler isolation means dispatch() never rejects.
    expect(count).toBe(2);
    expect(dispatched).toHaveLength(1);

    // Both entries are now published — the relay has no way to detect handler failure.
    const remaining = await store.loadUnpublished();
    expect(remaining).toHaveLength(0);
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

  it("should catch a rejecting loadUnpublished, log it, and return 0", async () => {
    const failingStore: OutboxStore = {
      save: vi.fn(async () => {}),
      loadUnpublished: vi
        .fn()
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockResolvedValue([] as OutboxEntry[]),
      markPublished: vi.fn(async () => {}),
      markPublishedByEventIds: vi.fn(async () => {}),
    };
    const eventBus = new EventEmitterEventBus();
    const errors: unknown[] = [];
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (...args: unknown[]) => errors.push(args),
      child: () => logger,
    };
    const relay = new OutboxRelay(failingStore, eventBus, {}, logger);

    // Must not throw / reject despite loadUnpublished rejecting.
    await expect(relay.processOnce()).resolves.toBe(0);
    expect(errors.length).toBeGreaterThan(0);

    // The relay recovers on the next call once the store is healthy again.
    await expect(relay.processOnce()).resolves.toBe(0);
    expect(failingStore.loadUnpublished).toHaveBeenCalledTimes(2);
  });

  it("should not leave an unhandled rejection when the interval callback fires", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const failingStore: OutboxStore = {
        save: vi.fn(async () => {}),
        loadUnpublished: vi.fn().mockRejectedValue(new Error("db down")),
        markPublished: vi.fn(async () => {}),
        markPublishedByEventIds: vi.fn(async () => {}),
      };
      const eventBus = new EventEmitterEventBus();
      const relay = new OutboxRelay(failingStore, eventBus, {
        pollIntervalMs: 10,
      });

      relay.start();
      await vi.advanceTimersByTimeAsync(35);
      relay.stop();

      // Flush the microtask queue so any unhandled rejection would surface.
      await Promise.resolve();
      await Promise.resolve();

      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
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
