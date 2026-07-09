import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Network, type StartedNetwork } from "testcontainers";
import {
  startRabbitMq,
  type StartedRabbitMq,
  startToxiproxy,
  type StartedToxiproxy,
  type Proxy,
  slowTestsEnabled,
  uniqueSuffix,
  waitFor,
  sleep,
} from "@noddde/testing-integration";
import { RabbitMqEventBus } from "../../rabbitmq-event-bus";

// Failure-injection suite (ROBUSTNESS.md §2.1). The RabbitMQ adapter has a
// bespoke persistent-reconnection loop (`_handleUnexpectedClose` →
// `_reconnectPersistently`) that re-asserts the exchange and rebinds every
// consumer. These tests put a Toxiproxy between the bus and the broker and
// prove that loop actually restores delivery after an outage / reset.
// Gated behind NODDDE_SLOW_TESTS (deliberate wall-clock on outage + backoff).
describe.skipIf(!slowTestsEnabled())(
  "RabbitMqEventBus reconnection (toxiproxy)",
  () => {
    let network: StartedNetwork;
    let rmq_: StartedRabbitMq;
    let toxi: StartedToxiproxy;
    let proxy: Proxy;

    beforeAll(async () => {
      network = await new Network().start();
      rmq_ = await startRabbitMq({ network, networkAliases: ["rabbitmq"] });
      toxi = await startToxiproxy(network);
      proxy = await toxi.createProxy({
        name: "rabbitmq",
        upstream: "rabbitmq:5672",
      });
    }, 240_000);

    afterAll(async () => {
      await toxi?.stop();
      await rmq_?.stop();
      await network?.stop();
    });

    function makeBus(suffix: string): RabbitMqEventBus {
      return new RabbitMqEventBus({
        url: `amqp://guest:guest@${proxy.endpoint}`,
        exchangeName: `noddde.events.${suffix}`,
        queuePrefix: `noddde.${suffix}`,
        // Fast backoff so the reconnect loop retries promptly once the
        // broker returns.
        resilience: { initialDelayMs: 250, maxDelayMs: 2000 },
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

      await bus.dispatch({ name: subject, payload: { n: 0 } });
      await waitFor(() => received.length >= 1, { timeoutMs: 15_000 });

      // Outage: closing the proxy tears down the AMQP connection, which
      // fires the adapter's 'close' handler → persistent reconnect loop.
      await proxy.setEnabled(false);
      await sleep(1500);
      await proxy.setEnabled(true);

      // Once reconnected the exchange + consumer are re-established, so a
      // fresh publish is delivered. Re-dispatch per poll (dispatch rejects
      // while disconnected).
      await waitFor(
        async () => {
          try {
            await bus.dispatch({ name: subject, payload: { n: 1 } });
          } catch {
            // still reconnecting — dispatch rejects until the channel is back
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

      // Reset the peer, then clear the toxic so reconnection can succeed.
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
