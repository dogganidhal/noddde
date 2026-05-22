import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Kafka } from "kafkajs";
import {
  defineEventBusContract,
  startKafka,
  type StartedKafka,
  uniqueSuffix,
  waitFor,
} from "@noddde/testing-integration";
import { KafkaEventBus } from "../../kafka-event-bus";

let kafka_: StartedKafka;

beforeAll(async () => {
  kafka_ = await startKafka();
}, 300_000);

afterAll(async () => {
  await kafka_?.stop();
});

defineEventBusContract("kafka", () => {
  return {
    makeBus: (suffix) =>
      new KafkaEventBus({
        brokers: kafka_.brokers,
        clientId: `noddde-test-${suffix}`,
        groupId: `noddde-group-${suffix}`,
      }),
    deliveryTimeoutMs: 30_000,
  };
});

// ─────────────────────────────────────────────────────────────────────
// Kafka-specific scenarios.
// These exercise semantics no other broker provides: explicit partition
// assignment via message key, consumer-group fan-out across processes,
// and offset-commit gating on handler success.
// ─────────────────────────────────────────────────────────────────────

describe("KafkaEventBus broker-specific behaviour", () => {
  it("routes events with the same aggregateId to the same partition", async () => {
    const suffix = uniqueSuffix();
    const topic = `OrderPlaced_${suffix}`;
    // Pre-create the topic with 3 partitions so we can observe routing.
    const admin = new Kafka({
      brokers: kafka_.brokers,
      clientId: `admin-${suffix}`,
    }).admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic, numPartitions: 3 }],
    });
    await admin.disconnect();

    const bus = new KafkaEventBus({
      brokers: kafka_.brokers,
      clientId: `routing-${suffix}`,
      groupId: `routing-group-${suffix}`,
    });
    const received: { partition: number; aggregateId: string }[] = [];

    // Subscribe with a raw kafkajs consumer so we can read the partition number,
    // which the EventBus abstraction hides from handlers.
    const probeConsumer = new Kafka({
      brokers: kafka_.brokers,
      clientId: `probe-${suffix}`,
    }).consumer({ groupId: `probe-${suffix}` });
    await probeConsumer.connect();
    await probeConsumer.subscribe({ topic, fromBeginning: true });
    void probeConsumer.run({
      eachMessage: async ({ partition, message }) => {
        const evt = JSON.parse(message.value!.toString()) as {
          payload: { aggregateId: string };
        };
        received.push({ partition, aggregateId: evt.payload.aggregateId });
      },
    });

    await bus.connect();

    // Dispatch multiple events for two distinct aggregates. Same aggregate
    // id must always land on the same partition.
    for (let i = 0; i < 3; i++) {
      await bus.dispatch({
        name: topic,
        payload: { aggregateId: "A" },
        metadata: {
          aggregateId: "A",
          eventId: `${i}-A`,
          correlationId: "c",
          causationId: "x",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });
      await bus.dispatch({
        name: topic,
        payload: { aggregateId: "B" },
        metadata: {
          aggregateId: "B",
          eventId: `${i}-B`,
          correlationId: "c",
          causationId: "x",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });
    }

    await waitFor(() => received.length >= 6, { timeoutMs: 30_000 });

    const partitionsA = new Set(
      received.filter((r) => r.aggregateId === "A").map((r) => r.partition),
    );
    const partitionsB = new Set(
      received.filter((r) => r.aggregateId === "B").map((r) => r.partition),
    );
    expect(partitionsA.size).toBe(1);
    expect(partitionsB.size).toBe(1);

    await probeConsumer.stop();
    await probeConsumer.disconnect();
    await bus.close();
  });

  it("competing-consumers semantics: a single consumer group splits work", async () => {
    const suffix = uniqueSuffix();
    const topic = `WorkItem_${suffix}`;
    // Pre-create with 2 partitions so two consumers can each be assigned one.
    const admin = new Kafka({
      brokers: kafka_.brokers,
      clientId: `admin-${suffix}`,
    }).admin();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic, numPartitions: 2 }] });
    await admin.disconnect();

    const groupId = `shared-group-${suffix}`;
    const c1Received: string[] = [];
    const c2Received: string[] = [];

    const bus1 = new KafkaEventBus({
      brokers: kafka_.brokers,
      clientId: `c1-${suffix}`,
      groupId,
    });
    const bus2 = new KafkaEventBus({
      brokers: kafka_.brokers,
      clientId: `c2-${suffix}`,
      groupId,
    });
    bus1.on(topic, async (evt) => {
      c1Received.push((evt.payload as { n: number }).n.toString());
    });
    bus2.on(topic, async (evt) => {
      c2Received.push((evt.payload as { n: number }).n.toString());
    });
    await bus1.connect();
    await bus2.connect();

    // Publisher uses a third bus so the consumers aren't fighting for the
    // producer connection.
    const pub = new KafkaEventBus({
      brokers: kafka_.brokers,
      clientId: `pub-${suffix}`,
      groupId: `pub-${suffix}`,
    });
    await pub.connect();

    for (let i = 0; i < 10; i++) {
      // Vary aggregateId so messages spread across partitions.
      await pub.dispatch({
        name: topic,
        payload: { n: i },
        metadata: {
          aggregateId: `agg-${i}`,
          eventId: String(i),
          correlationId: "c",
          causationId: "x",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });
    }

    await waitFor(() => c1Received.length + c2Received.length === 10, {
      timeoutMs: 30_000,
    });
    // Both consumers must have received at least one message — proves the
    // partition assignment really did split work across them.
    expect(c1Received.length).toBeGreaterThan(0);
    expect(c2Received.length).toBeGreaterThan(0);

    await bus1.close();
    await bus2.close();
    await pub.close();
  });

  it("does not commit offset for a partition where the handler threw — redelivery occurs", async () => {
    const suffix = uniqueSuffix();
    const topic = `RetryEvent_${suffix}`;
    const groupId = `retry-group-${suffix}`;

    let attempts = 0;
    const bus = new KafkaEventBus({
      brokers: kafka_.brokers,
      clientId: `retry-${suffix}`,
      groupId,
    });
    bus.on(topic, async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("simulated handler failure");
      }
    });
    await bus.connect();

    await bus.dispatch({
      name: topic,
      payload: { foo: "bar" },
      metadata: {
        aggregateId: "agg",
        eventId: "e1",
        correlationId: "c",
        causationId: "x",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    });

    // The handler should retry until it succeeds (after the first failure).
    await waitFor(() => attempts >= 2, { timeoutMs: 60_000, intervalMs: 250 });
    expect(attempts).toBeGreaterThanOrEqual(2);

    await bus.close();
  });
});
