import type { Connectable, EventBus } from "@noddde/core";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { uniqueSuffix, waitFor } from "../utils.js";

/**
 * Shared cross-broker EventBus contract. The factory returns a freshly
 * constructed and **not yet connected** bus instance plus a teardown.
 * Each test calls `connect()` itself so it can observe pre-connect
 * behaviour where relevant. Tests should namespace any topics/subjects
 * using the provided `suffix` so they don't collide on a shared broker.
 */
export interface EventBusContractContext {
  /**
   * Construct a *new* bus configured for `suffix`. Called potentially
   * multiple times within a single test (e.g. to simulate two competing
   * consumers in different processes).
   */
  makeBus: (suffix: string) => EventBus & Connectable;
  /** Cleans up brokers / state between tests; runs once after each test. */
  cleanup?: () => Promise<void>;
  /**
   * Optional setup hook between tests (e.g. wipe Kafka topics).
   * Most tests use a unique suffix so this is rarely needed.
   */
  reset?: () => Promise<void>;
  /**
   * Pre-create topics/subjects ahead of `bus.connect()`. Required for
   * Kafka, where `consumer.subscribe()` races broker-side topic
   * auto-creation and crashes with `KafkaJSProtocolError: This server
   * does not host this topic-partition`. NATS / RabbitMQ either create
   * resources lazily inside the bus or have other paths, so this hook
   * is a no-op for them.
   */
  prepareTopics?: (eventNames: string[]) => Promise<void>;
  /**
   * Max time we wait for an event to arrive after dispatch — Kafka
   * sometimes takes longer than NATS/RabbitMQ to deliver the first
   * message after consumer rebalance. Defaults to 10s.
   */
  deliveryTimeoutMs?: number;
}

export type EventBusContractFactory = () =>
  | EventBusContractContext
  | Promise<EventBusContractContext>;

export function defineEventBusContract(
  brokerLabel: string,
  factory: EventBusContractFactory,
): void {
  describe(`EventBusContract: ${brokerLabel}`, () => {
    let ctx: EventBusContractContext;
    let buses: (EventBus & Connectable)[] = [];

    beforeEach(async () => {
      ctx = await factory();
      buses = [];
    });

    afterEach(async () => {
      // Close every bus the test opened, then run user cleanup.
      await Promise.allSettled(buses.map((b) => b.close()));
      await ctx.cleanup?.();
    });

    function track(b: EventBus & Connectable): EventBus & Connectable {
      buses.push(b);
      return b;
    }

    const timeout = () => ctx.deliveryTimeoutMs ?? 10_000;

    /**
     * Dispatches an event exactly once (with retry on transient broker
     * errors — Kafka can return `NotLeaderForPartition` right after
     * auto-creating a topic) and then waits for `received` to fill to the
     * expected count.
     */
    async function dispatchAndWait(
      bus: EventBus & Connectable,
      event: { name: string; payload: unknown; metadata?: unknown },
      received: unknown[],
      expected: number,
    ): Promise<void> {
      // Retry only the publish itself; once it succeeds we never re-publish.
      await waitFor(
        async () => {
          try {
            await bus.dispatch(event as never);
            return true;
          } catch {
            return false;
          }
        },
        { timeoutMs: timeout(), intervalMs: 250 },
      );
      await waitFor(() => received.length >= expected, {
        timeoutMs: timeout(),
      });
    }

    it("dispatches an event and delivers it to a single registered handler", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      const received: unknown[] = [];
      bus.on(`Test_${suffix}`, async (event) => {
        received.push(event);
      });
      await ctx.prepareTopics?.([`Test_${suffix}`]);
      await bus.connect();

      await dispatchAndWait(
        bus,
        { name: `Test_${suffix}`, payload: { foo: "bar" } },
        received,
        1,
      );
      expect(received[0]).toMatchObject({
        name: `Test_${suffix}`,
        payload: { foo: "bar" },
      });
    });

    it("fans out one event to multiple in-process handlers", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      const a: unknown[] = [];
      const b: unknown[] = [];
      const both: unknown[] = [];
      bus.on(`Test_${suffix}`, async (event) => {
        a.push(event);
        both.push(event);
      });
      bus.on(`Test_${suffix}`, async (event) => {
        b.push(event);
        both.push(event);
      });
      await ctx.prepareTopics?.([`Test_${suffix}`]);
      await bus.connect();

      await dispatchAndWait(
        bus,
        { name: `Test_${suffix}`, payload: { n: 1 } },
        both,
        2,
      );
      expect(a.length).toBe(1);
      expect(b.length).toBe(1);
    });

    it("preserves event payload, name, and metadata across the wire", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      const received: unknown[] = [];
      bus.on(`Test_${suffix}`, async (event) => {
        received.push(event);
      });
      await ctx.prepareTopics?.([`Test_${suffix}`]);
      await bus.connect();

      const sent = {
        name: `Test_${suffix}`,
        payload: { items: [{ sku: "X", qty: 1 }] },
        metadata: {
          eventId: "evt-123",
          correlationId: "corr-1",
          causationId: "cmd-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          aggregateId: "agg-1",
        },
      } as const;
      await dispatchAndWait(bus, sent, received, 1);
      expect(received[0]).toMatchObject(sent);
    });

    it("only delivers events to handlers whose event name matches", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      const a: unknown[] = [];
      const b: unknown[] = [];
      bus.on(`A_${suffix}`, async (e) => {
        a.push(e);
      });
      bus.on(`B_${suffix}`, async (e) => {
        b.push(e);
      });
      await ctx.prepareTopics?.([`A_${suffix}`, `B_${suffix}`]);
      await bus.connect();

      await dispatchAndWait(bus, { name: `A_${suffix}`, payload: {} }, a, 1);
      expect(b.length).toBe(0);
    });

    it("throws when dispatch is called before connect()", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      await expect(
        bus.dispatch({ name: `Test_${suffix}`, payload: {} }),
      ).rejects.toBeInstanceOf(Error);
    });

    it("throws when dispatch is called after close()", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      await bus.connect();
      await bus.close();
      await expect(
        bus.dispatch({ name: `Test_${suffix}`, payload: {} }),
      ).rejects.toBeInstanceOf(Error);
    });

    it("close() is idempotent", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      await bus.connect();
      await bus.close();
      await expect(bus.close()).resolves.toBeUndefined();
    });

    it("handlers registered BEFORE connect() receive published events", async () => {
      // Pre-connect registration is the universally supported path — every
      // broker can buffer handlers and bind their subscriptions inside
      // connect(). Late `on()` after connect() is broker-specific (Kafka
      // can't subscribe to new topics while the consumer is running) and
      // covered in per-broker test files.
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      const received: unknown[] = [];
      bus.on(`PreBound_${suffix}`, async (e) => {
        received.push(e);
      });
      await ctx.prepareTopics?.([`PreBound_${suffix}`]);
      await bus.connect();

      await dispatchAndWait(
        bus,
        { name: `PreBound_${suffix}`, payload: { n: 1 } },
        received,
        1,
      );
    });
  });
}
