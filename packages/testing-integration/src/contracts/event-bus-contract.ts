/* eslint-disable no-unused-vars */
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

    it("dispatches an event and delivers it to a single registered handler", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      const received: unknown[] = [];
      bus.on(`Test_${suffix}`, async (event) => {
        received.push(event);
      });
      await bus.connect();

      await bus.dispatch({
        name: `Test_${suffix}`,
        payload: { foo: "bar" },
      });

      await waitFor(() => received.length === 1, { timeoutMs: timeout() });
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
      bus.on(`Test_${suffix}`, async (event) => {
        a.push(event);
      });
      bus.on(`Test_${suffix}`, async (event) => {
        b.push(event);
      });
      await bus.connect();

      await bus.dispatch({ name: `Test_${suffix}`, payload: { n: 1 } });
      await waitFor(() => a.length === 1 && b.length === 1, {
        timeoutMs: timeout(),
      });
    });

    it("preserves event payload, name, and metadata across the wire", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      const received: unknown[] = [];
      bus.on(`Test_${suffix}`, async (event) => {
        received.push(event);
      });
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
      await bus.dispatch(sent);

      await waitFor(() => received.length === 1, { timeoutMs: timeout() });
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
      await bus.connect();

      await bus.dispatch({ name: `A_${suffix}`, payload: {} });
      await waitFor(() => a.length === 1, { timeoutMs: timeout() });
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

    it("handlers registered after connect() still receive subsequent events", async () => {
      const suffix = uniqueSuffix();
      const bus = track(ctx.makeBus(suffix));
      await bus.connect();

      const received: unknown[] = [];
      bus.on(`LateBound_${suffix}`, async (e) => {
        received.push(e);
      });

      // Give the broker a moment to register the subscription before we
      // publish — Kafka especially needs ~1s before fetch starts. The
      // waitFor below also covers any propagation lag.
      await waitFor(
        async () => {
          await bus.dispatch({
            name: `LateBound_${suffix}`,
            payload: { n: 1 },
          });
          return received.length > 0;
        },
        { timeoutMs: timeout(), intervalMs: 200 },
      );
    });
  });
}
