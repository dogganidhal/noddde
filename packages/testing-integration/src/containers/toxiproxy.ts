import {
  ToxiProxyContainer,
  type StartedToxiProxyContainer,
} from "@testcontainers/toxiproxy";
import type { StartedNetwork } from "testcontainers";

/**
 * A single proxy sitting between a client and a broker. Clients connect to
 * `host:port`; traffic is forwarded to the broker's in-network address.
 * The failure-injection methods let a test sever or degrade that link
 * mid-flow to exercise adapter reconnection logic.
 */
export interface Proxy {
  /** Host the client connects to (the proxy front, not the broker). */
  host: string;
  /** Port the client connects to (the proxy front, not the broker). */
  port: number;
  /** Convenience `host:port` string. */
  endpoint: string;
  /**
   * Enable or disable the proxy. Disabling closes every open connection
   * immediately and refuses new ones — a full broker outage / hard TCP
   * drop from the client's point of view. Re-enable to bring it back.
   */
  // eslint-disable-next-line no-unused-vars -- param name in a type signature
  setEnabled: (enabled: boolean) => Promise<void>;
  /**
   * Reset the peer on the next byte in the given direction — simulates a
   * connection dropped mid-transfer (RST) rather than a clean close.
   * Defaults to the downstream (broker → client) direction.
   */
  // eslint-disable-next-line no-unused-vars -- param name in a type signature
  resetPeer: (direction?: "upstream" | "downstream") => Promise<void>;
  /** Removes every toxic previously added to this proxy. */
  clearToxics: () => Promise<void>;
}

export interface StartedToxiproxy {
  container: StartedToxiProxyContainer;
  /**
   * Creates a proxy in front of `upstream` (a `host:port` reachable on the
   * shared Docker network, e.g. `"rabbitmq:5672"`). Returns the front-side
   * `host:port` the client should connect to, plus fault-injection controls.
   */
  // eslint-disable-next-line no-unused-vars -- param name in a type signature
  createProxy: (opts: { name: string; upstream: string }) => Promise<Proxy>;
  stop: () => Promise<void>;
}

/**
 * Starts a [Toxiproxy](https://github.com/Shopify/toxiproxy) sidecar on the
 * given network. Brokers under test must be started on the *same* network
 * (via `startX({ network, networkAliases })`) so the proxy can reach them by
 * alias. See `*.reconnect.integration.test.ts` for the end-to-end pattern.
 */
export async function startToxiproxy(
  network: StartedNetwork,
  opts: { image?: string } = {},
): Promise<StartedToxiproxy> {
  const image = opts.image ?? "ghcr.io/shopify/toxiproxy:2.9.0";
  const container = await new ToxiProxyContainer(image)
    .withNetwork(network)
    .start();

  return {
    container,
    createProxy: async ({ name, upstream }) => {
      const created = await container.createProxy({ name, upstream });
      // The toxiproxy-node-client Proxy has no "list toxics", so we track
      // the ones we add to be able to clear them.
      const added: { remove: () => Promise<void> }[] = [];
      let toxicCounter = 0;
      return {
        host: created.host,
        port: created.port,
        endpoint: `${created.host}:${created.port}`,
        setEnabled: async (enabled) => {
          await created.setEnabled(enabled);
        },
        resetPeer: async (direction = "downstream") => {
          const toxic = await created.instance.addToxic({
            name: `reset_${toxicCounter++}`,
            type: "reset_peer",
            stream: direction,
            toxicity: 1,
            attributes: { timeout: 0 },
          });
          added.push(toxic);
        },
        clearToxics: async () => {
          await Promise.all(added.splice(0).map((t) => t.remove()));
        },
      };
    },
    stop: async () => {
      await container.stop({ remove: true });
    },
  };
}
