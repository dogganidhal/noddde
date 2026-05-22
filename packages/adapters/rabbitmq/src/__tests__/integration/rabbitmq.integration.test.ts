import { afterAll, beforeAll, describe, expect, it } from "vitest";
import amqplib from "amqplib";
import {
  defineEventBusContract,
  startRabbitMq,
  type StartedRabbitMq,
  sleep,
  uniqueSuffix,
  waitFor,
} from "@noddde/testing-integration";
import { RabbitMqEventBus } from "../../rabbitmq-event-bus";

let rmq_: StartedRabbitMq;

beforeAll(async () => {
  rmq_ = await startRabbitMq();
}, 180_000);

afterAll(async () => {
  await rmq_?.stop();
});

defineEventBusContract("rabbitmq", () => {
  return {
    makeBus: (suffix) =>
      new RabbitMqEventBus({
        url: rmq_.url,
        exchangeName: `noddde.events.${suffix}`,
        queuePrefix: `noddde.${suffix}`,
      }),
    deliveryTimeoutMs: 10_000,
  };
});

// ─────────────────────────────────────────────────────────────────────
// RabbitMQ-specific behaviour
// ─────────────────────────────────────────────────────────────────────

describe("RabbitMqEventBus broker-specific behaviour", () => {
  it("persists messages — a queued event is delivered to a consumer started later", async () => {
    const suffix = uniqueSuffix();
    const exchange = `noddde.events.${suffix}`;
    const queuePrefix = `noddde.${suffix}`;

    // Publisher only — no handler — so the message sits in the queue
    // (which only exists after a handler registers).
    // We instead register a "warmer" handler first to create the queue,
    // close that bus, publish, then start a fresh consumer.
    const warmer = new RabbitMqEventBus({
      url: rmq_.url,
      exchangeName: exchange,
      queuePrefix,
    });
    warmer.on(`StoredEvent_${suffix}`, async () => {});
    await warmer.connect();
    await warmer.close(); // queue persists because we declared it durable

    const producer = new RabbitMqEventBus({
      url: rmq_.url,
      exchangeName: exchange,
      queuePrefix,
    });
    // The producer never registers a handler, so its connect() opens an
    // exchange but no queue — that's fine, the binding already exists.
    await producer.connect();
    await producer.dispatch({
      name: `StoredEvent_${suffix}`,
      payload: { msg: "hello" },
    });
    await producer.close();

    // Now spin up a consumer for the same routing key — it must receive
    // the persisted message.
    const consumer = new RabbitMqEventBus({
      url: rmq_.url,
      exchangeName: exchange,
      queuePrefix,
    });
    const received: unknown[] = [];
    consumer.on(`StoredEvent_${suffix}`, async (evt) => {
      received.push(evt);
    });
    await consumer.connect();
    await waitFor(() => received.length === 1, { timeoutMs: 10_000 });
    expect(received[0]).toMatchObject({ payload: { msg: "hello" } });
    await consumer.close();
  });

  it("requeues messages whose handler threw, then delivers them on retry", async () => {
    const suffix = uniqueSuffix();
    const exchange = `noddde.events.${suffix}`;
    const queuePrefix = `noddde.${suffix}`;

    const bus = new RabbitMqEventBus({
      url: rmq_.url,
      exchangeName: exchange,
      queuePrefix,
    });
    let attempts = 0;
    bus.on(`RetryEvent_${suffix}`, async () => {
      attempts++;
      if (attempts === 1) throw new Error("first fail");
    });
    await bus.connect();
    await bus.dispatch({ name: `RetryEvent_${suffix}`, payload: { n: 1 } });

    await waitFor(() => attempts >= 2, { timeoutMs: 10_000, intervalMs: 100 });
    expect(attempts).toBeGreaterThanOrEqual(2);
    await bus.close();
  });

  it("topic exchange: only handlers bound to the routing key receive the message", async () => {
    const suffix = uniqueSuffix();
    const exchange = `noddde.events.${suffix}`;
    const queuePrefix = `noddde.${suffix}`;

    const bus = new RabbitMqEventBus({
      url: rmq_.url,
      exchangeName: exchange,
      queuePrefix,
      exchangeType: "topic",
    });
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
    await waitFor(() => a.length === 1, { timeoutMs: 10_000 });
    // small breathing window to verify B did NOT receive it
    await sleep(250);
    expect(b.length).toBe(0);
    await bus.close();
  });

  it("respects prefetchCount for backpressure (no more than N unacked at once)", async () => {
    const suffix = uniqueSuffix();
    const exchange = `noddde.events.${suffix}`;
    const queuePrefix = `noddde.${suffix}`;

    const bus = new RabbitMqEventBus({
      url: rmq_.url,
      exchangeName: exchange,
      queuePrefix,
      prefetchCount: 2,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const total = 8;
    let completed = 0;
    const release: (() => void)[] = [];

    bus.on(`Slow_${suffix}`, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight--;
      completed++;
    });

    await bus.connect();
    for (let i = 0; i < total; i++) {
      await bus.dispatch({ name: `Slow_${suffix}`, payload: { i } });
    }

    // Wait until at least 2 are "in flight" and stuck — proving prefetch=2.
    await waitFor(() => inFlight === 2, { timeoutMs: 10_000, intervalMs: 50 });
    expect(maxInFlight).toBeLessThanOrEqual(2);

    // Release everyone so the rest flow.
    while (release.length > 0 || completed < total) {
      const next = release.shift();
      if (next) next();
      await sleep(20);
    }
    await bus.close();
  });

  it("publisher confirms: dispatch awaits broker acknowledgement", async () => {
    // We don't subscribe — the goal is to verify dispatch() doesn't resolve
    // until the broker has acked the publish. Use a raw amqplib connection
    // to declare the durable queue + binding before the bus connects, then
    // dispatch via the bus, close the bus, and check the queue has 1
    // unconsumed message. If dispatch returned before the broker
    // acknowledged, the message would be lost when the bus connection
    // closed before the broker durably accepted it.
    const suffix = uniqueSuffix();
    const exchange = `noddde.events.${suffix}`;
    const queuePrefix = `noddde.${suffix}`;
    const eventName = `Confirmed_${suffix}`;
    const queueName = `${queuePrefix}.${eventName}`;

    const setupConn = await amqplib.connect(rmq_.url);
    const setupCh = await setupConn.createChannel();
    await setupCh.assertExchange(exchange, "topic", { durable: true });
    await setupCh.assertQueue(queueName, { durable: true });
    await setupCh.bindQueue(queueName, exchange, eventName);
    await setupCh.close();
    await setupConn.close();

    const bus = new RabbitMqEventBus({
      url: rmq_.url,
      exchangeName: exchange,
      queuePrefix,
    });
    await bus.connect();
    await bus.dispatch({ name: eventName, payload: { confirmed: true } });
    await bus.close();

    // Probe the queue from a fresh connection — if dispatch() really awaited
    // broker confirmation, the message is still in the durable queue.
    const probeConn = await amqplib.connect(rmq_.url);
    const probeCh = await probeConn.createChannel();
    const { messageCount } = await probeCh.checkQueue(queueName);
    expect(messageCount).toBeGreaterThanOrEqual(1);
    await probeCh.close();
    await probeConn.close();
  });
});
