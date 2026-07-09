import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Network, type StartedNetwork } from "testcontainers";
import {
  startNats,
  type StartedNats,
  startToxiproxy,
  type StartedToxiproxy,
  type Proxy,
  slowTestsEnabled,
  uniqueSuffix,
  waitFor,
  sleep,
} from "@noddde/testing-integration";
import { NatsEventBus } from "../../nats-event-bus";

// Failure-injection suite (ROBUSTNESS.md §2.1). The NATS client is
// configured with `reconnect: true` / infinite attempts; these tests put a
// Toxiproxy between the bus and the broker and prove the reconnect cycle
// actually restores end-to-end delivery. Gated behind NODDDE_SLOW_TESTS
// because it deliberately spends wall-clock on outages + backoff.
describe.skipIf(!slowTestsEnabled())(
  "NatsEventBus reconnection (toxiproxy)",
  () => {
    let network: StartedNetwork;
    let nats_: StartedNats;
    let toxi: StartedToxiproxy;
    let proxy: Proxy;

    beforeAll(async () => {
      network = await new Network().start();
      nats_ = await startNats({ network, networkAliases: ["nats"] });
      toxi = await startToxiproxy(network);
      proxy = await toxi.createProxy({ name: "nats", upstream: "nats:4222" });
    }, 240_000);

    afterAll(async () => {
      await toxi?.stop();
      await nats_?.stop();
      await network?.stop();
    });

    function makeBus(suffix: string): NatsEventBus {
      return new NatsEventBus({
        servers: `nats://${proxy.endpoint}`,
        consumerGroup: `recon-${suffix}`,
        streamName: `recon_${suffix}`,
        subjectPrefix: `noddde.${suffix}.`,
        resilience: { initialDelayMs: 500 },
      });
    }

    it("recovers and delivers after a full broker outage mid-consume", async () => {
      const suffix = uniqueSuffix();
      const subject = `Recon_${suffix}`;
      const bus = makeBus(suffix);
      const received: unknown[] = [];
      bus.on(subject, async (e) => {
        received.push(e);
      });
      await bus.connect();

      // Baseline: delivery works through the proxy.
      await bus.dispatch({ name: subject, payload: { n: 0 } });
      await waitFor(() => received.length >= 1, { timeoutMs: 15_000 });

      // Sever every connection for a beat, then bring the broker back.
      await proxy.setEnabled(false);
      await sleep(1500);
      await proxy.setEnabled(true);

      // After the client reconnects, fresh publishes must be delivered.
      // Re-dispatch on each poll since the reconnect isn't instantaneous.
      await waitFor(
        async () => {
          try {
            await bus.dispatch({ name: subject, payload: { n: 1 } });
          } catch {
            // still reconnecting
          }
          return received.length >= 2;
        },
        { timeoutMs: 30_000, intervalMs: 750 },
      );
      expect(received.length).toBeGreaterThanOrEqual(2);

      await bus.close();
    }, 90_000);

    it("recovers from a connection reset injected mid-flow", async () => {
      const suffix = uniqueSuffix();
      const subject = `Reset_${suffix}`;
      const bus = makeBus(suffix);
      const received: unknown[] = [];
      bus.on(subject, async (e) => {
        received.push(e);
      });
      await bus.connect();

      await bus.dispatch({ name: subject, payload: { n: 0 } });
      await waitFor(() => received.length >= 1, { timeoutMs: 15_000 });

      // Reset the peer on the next byte, then clear the toxic so the client
      // can re-establish.
      await proxy.resetPeer();
      await sleep(500);
      await proxy.clearToxics();

      await waitFor(
        async () => {
          try {
            await bus.dispatch({ name: subject, payload: { n: 1 } });
          } catch {
            // still reconnecting
          }
          return received.length >= 2;
        },
        { timeoutMs: 30_000, intervalMs: 750 },
      );
      expect(received.length).toBeGreaterThanOrEqual(2);

      await bus.close();
    }, 90_000);
  },
);
