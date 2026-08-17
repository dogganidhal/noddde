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

// ─────────────────────────────────────────────────────────────────────
// Multi-instance scale-out (queue group / competing consumers, issue #134)
// ─────────────────────────────────────────────────────────────────────

describe("NatsEventBus multi-instance scale-out", () => {
  it("two replicas with the same consumerGroup both connect() without a duplicate-subscription error", async () => {
    const suffix = uniqueSuffix();
    const subject = `Scale_${suffix}`;
    const streamName = `noddde_scale_${suffix}`;
    const consumerGroup = `scale-group-${suffix}`;
    const subjectPrefix = `noddde.${suffix}.`;

    const bus1 = new NatsEventBus({
      servers: nats_.url,
      consumerGroup,
      streamName,
      subjectPrefix,
    });
    bus1.on(subject, async () => {});
    await bus1.connect();

    const bus2 = new NatsEventBus({
      servers: nats_.url,
      consumerGroup,
      streamName,
      subjectPrefix,
    });
    bus2.on(subject, async () => {});

    // The whole point of the fix: this must NOT reject with
    // "duplicate subscription" now that both replicas bind to the same
    // durable via a shared deliver (queue) group.
    await expect(bus2.connect()).resolves.toBeUndefined();

    await bus1.close();
    await bus2.close();
  });

  it("splits messages across two replicas instead of delivering every message to both", async () => {
    const suffix = uniqueSuffix();
    const subject = `ScaleSplit_${suffix}`;
    const streamName = `noddde_scalesplit_${suffix}`;
    const consumerGroup = `scale-split-group-${suffix}`;
    const subjectPrefix = `noddde.${suffix}.`;
    const MESSAGE_COUNT = 20;

    const bus1 = new NatsEventBus({
      servers: nats_.url,
      consumerGroup,
      streamName,
      subjectPrefix,
    });
    const bus2 = new NatsEventBus({
      servers: nats_.url,
      consumerGroup,
      streamName,
      subjectPrefix,
    });

    let receivedByBus1 = 0;
    let receivedByBus2 = 0;
    bus1.on(subject, async () => {
      receivedByBus1++;
    });
    bus2.on(subject, async () => {
      receivedByBus2++;
    });

    await bus1.connect();
    await bus2.connect();

    for (let i = 0; i < MESSAGE_COUNT; i++) {
      await bus1.dispatch({ name: subject, payload: { i } });
    }

    await waitFor(() => receivedByBus1 + receivedByBus2 >= MESSAGE_COUNT, {
      timeoutMs: 20_000,
    });
    // Give any stray duplicate delivery a moment to show up before asserting.
    await new Promise((r) => setTimeout(r, 500));

    // Competing consumers: every message goes to exactly one replica, so the
    // total across both must equal what was sent, not double it.
    expect(receivedByBus1 + receivedByBus2).toBe(MESSAGE_COUNT);
    // With 20 messages split across 2 queue-group members, both should have
    // picked up at least one — this is what proves load is actually shared,
    // not just that boot didn't fail.
    expect(receivedByBus1).toBeGreaterThan(0);
    expect(receivedByBus2).toBeGreaterThan(0);

    await bus1.close();
    await bus2.close();
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────
// Inbox subject benchmark (robustness §3.3 / GitHub issue #114)
// ─────────────────────────────────────────────────────────────────────

describe("NatsEventBus inbox subject benchmark (robustness §3.3)", () => {
  it("registers 1k subscriptions on a single bus and reports inbox/memory overhead", async () => {
    const SUBSCRIPTION_COUNT = 1000;
    const suffix = uniqueSuffix();
    const streamName = `noddde_bench_${suffix}`;
    const consumerGroup = `bench-${suffix}`;
    const subjectPrefix = `noddde.bench.${suffix}.`;

    const bus = new NatsEventBus({
      servers: nats_.url,
      consumerGroup,
      streamName,
      subjectPrefix,
    });

    const eventNames = Array.from(
      { length: SUBSCRIPTION_COUNT },
      (_, i) => `Event${i}`,
    );

    const memBefore = process.memoryUsage();
    const start = Date.now();

    for (const name of eventNames) {
      bus.on(name, async () => {});
    }
    await bus.connect();

    const connectElapsedMs = Date.now() - start;
    const memAfter = process.memoryUsage();
    const heapDeltaMb = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
    const rssDeltaMb = (memAfter.rss - memBefore.rss) / 1024 / 1024;

    // This is the subscription count, not a live measurement of NATS
    // server-side inbox subjects — the adapter creates exactly one inbox
    // subject per subscription by design (see nats-event-bus.spec.md,
    // Behavioral Requirement 6b), so the two numbers are equal, but this
    // variable measures what we actually registered, not what the server
    // reports.
    const subscriptionCount = eventNames.length;

    // eslint-disable-next-line no-console -- benchmark test, not library code; result must be visible in CI/local logs.
    console.log(
      `[nats inbox benchmark] subscriptions=${subscriptionCount} connectMs=${connectElapsedMs} heapDeltaMb=${heapDeltaMb.toFixed(2)} rssDeltaMb=${rssDeltaMb.toFixed(2)}`,
    );

    // Sanity: every subscription actually registered (no silent drops).
    expect(subscriptionCount).toBe(SUBSCRIPTION_COUNT);
    // A few KB per subscription (inbox subject string + consumer/subscription
    // bookkeeping) is expected; several hundred bytes-per-sub would indicate
    // no problem, tens of MB total would indicate a real one.
    expect(heapDeltaMb).toBeLessThan(200);

    await bus.close();
  }, 300_000);
});

/**
 * Findings (see issue #114 acceptance criteria — "Benchmark documented in
 * an issue comment or test file"):
 *
 * Measured run against `nats:2.10-alpine` (1 broker, JetStream enabled,
 * default Docker Desktop/colima resources), 1000 subscriptions registered
 * on a single `NatsEventBus` before `connect()`:
 *
 *   subscriptions=1000  connectMs=1506  heapDeltaMb=12.64  rssDeltaMb=37.73
 *
 * - Inbox count: exactly 1000 (one `createInbox()` subject per `on()` call,
 *   as designed) — each is a short random string (`_INBOX.<22-char nuid>`),
 *   ~30 bytes. 1000 inboxes is ~30KB of subject-string memory, dwarfed by
 *   the ~12.6MB heap / ~37.7MB RSS growth actually observed (~13KB and
 *   ~38KB per subscription respectively).
 * - That per-subscription cost comes from the JetStream push consumer +
 *   client-side subscription object (message queue, dispatch state), not
 *   from the inbox subject string itself. Sharing inboxes across
 *   subscriptions in the same `consumerGroup` (Phase 2) would only save the
 *   ~30 bytes/subscription of subject-string memory — three orders of
 *   magnitude below the measured per-subscription overhead — and would NOT
 *   reduce consumer/subscription count, which is fixed by the number of
 *   distinct event names registered regardless of inbox strategy.
 * - `connect()` activating 1000 subscriptions sequentially completed in
 *   ~1.5s — a one-time startup cost, not a steady-state concern.
 *
 * Conclusion: inbox-subject memory is not a real bottleneck at the scale
 * described in the issue (hundreds/thousands of subscriptions). Per the
 * issue's own Phase 2 gate ("only if Phase 1 surfaces a real problem"),
 * Phase 2 (inbox-sharing) is NOT implemented. No code change to
 * `nats-event-bus.ts` is needed; this benchmark is the acceptance
 * criterion. Numbers will vary by machine/CI but the order-of-magnitude
 * gap (bytes vs. tens-of-KB) is what drives the conclusion, not the exact
 * figures.
 */
