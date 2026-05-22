import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineEventBusContract,
  startNats,
  type StartedNats,
  uniqueSuffix,
  waitFor,
} from "@noddde/testing-integration";
import { NatsEventBus } from "../../nats-event-bus";

let nats_: StartedNats;

beforeAll(async () => {
  nats_ = await startNats();
}, 120_000);

afterAll(async () => {
  await nats_?.stop();
});

defineEventBusContract("nats", () => {
  return {
    makeBus: (suffix) =>
      new NatsEventBus({
        servers: nats_.url,
        consumerGroup: `noddde-test-${suffix}`,
        streamName: `noddde_stream_${suffix}`,
        subjectPrefix: `noddde.${suffix}.`,
      }),
    deliveryTimeoutMs: 15_000,
  };
});

// ─────────────────────────────────────────────────────────────────────
// NATS JetStream-specific behaviour
// ─────────────────────────────────────────────────────────────────────

describe("NatsEventBus broker-specific behaviour", () => {
  it("durable consumer resumes after reconnect and replays unacked messages", async () => {
    const suffix = uniqueSuffix();
    const subject = `Event_${suffix}`;
    const streamName = `noddde_${suffix}`;
    const consumerGroup = `dgroup-${suffix}`;
    const subjectPrefix = `noddde.${suffix}.`;

    // First lifecycle: register a handler that throws on the first delivery,
    // closes the bus before the redelivery, then a second bus should pick
    // the message back up because the durable consumer still has it
    // unacked.
    const bus1 = new NatsEventBus({
      servers: nats_.url,
      consumerGroup,
      streamName,
      subjectPrefix,
    });
    let receivedOnBus1 = 0;
    bus1.on(subject, async () => {
      receivedOnBus1++;
      throw new Error("nack me");
    });
    await bus1.connect();
    await bus1.dispatch({ name: subject, payload: { i: 1 } });
    await waitFor(() => receivedOnBus1 >= 1, { timeoutMs: 10_000 });
    await bus1.close();

    // Second lifecycle, same durable name → JetStream redelivers the
    // still-pending message.
    const bus2 = new NatsEventBus({
      servers: nats_.url,
      consumerGroup,
      streamName,
      subjectPrefix,
    });
    let receivedOnBus2 = 0;
    bus2.on(subject, async () => {
      receivedOnBus2++;
    });
    await bus2.connect();
    await waitFor(() => receivedOnBus2 >= 1, { timeoutMs: 15_000 });
    expect(receivedOnBus2).toBeGreaterThanOrEqual(1);
    await bus2.close();
  });

  it("stream is created if it doesn't already exist", async () => {
    const suffix = uniqueSuffix();
    const streamName = `noddde_create_${suffix}`;
    const subject = `CreateMe_${suffix}`;
    const subjectPrefix = `noddde.${suffix}.`;
    const bus = new NatsEventBus({
      servers: nats_.url,
      consumerGroup: `g-${suffix}`,
      streamName,
      subjectPrefix,
    });
    let received = 0;
    bus.on(subject, async () => {
      received++;
    });
    await bus.connect();
    await bus.dispatch({ name: subject, payload: {} });
    await waitFor(() => received === 1, { timeoutMs: 10_000 });
    await bus.close();
  });

  it("respects maxRetries and stops redelivering after the limit", async () => {
    const suffix = uniqueSuffix();
    const subject = `Maxout_${suffix}`;
    const streamName = `noddde_maxout_${suffix}`;
    const subjectPrefix = `noddde.${suffix}.`;
    const bus = new NatsEventBus({
      servers: nats_.url,
      consumerGroup: `g-${suffix}`,
      streamName,
      subjectPrefix,
      resilience: { maxRetries: 2 },
    });
    let attempts = 0;
    bus.on(subject, async () => {
      attempts++;
      throw new Error("always fail");
    });
    await bus.connect();
    await bus.dispatch({ name: subject, payload: {} });

    // Wait a generous window then assert we didn't blow past the cap.
    await waitFor(() => attempts >= 2, { timeoutMs: 10_000 });
    // Give it another second of breathing room and assert no further calls.
    const after = attempts;
    await new Promise((r) => setTimeout(r, 1500));
    expect(attempts).toBeLessThanOrEqual(after + 1);
    await bus.close();
  });
});
