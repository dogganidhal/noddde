import {
  GenericContainer,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";

export interface StartedNats {
  container: StartedTestContainer;
  /** `nats://host:port` URL for the `nats` client. */
  url: string;
  host: string;
  port: number;
  stop: () => Promise<void>;
}

/**
 * NATS doesn't have a dedicated @testcontainers/* helper, so we use
 * GenericContainer with `--jetstream` enabled so durable consumers work.
 */
export async function startNats(
  opts: {
    image?: string;
    /** Join a shared network so a Toxiproxy sidecar can reach it by alias. */
    network?: StartedNetwork;
    /** In-network hostname aliases (e.g. `["nats"]`) for proxy upstreams. */
    networkAliases?: string[];
  } = {},
): Promise<StartedNats> {
  const image = opts.image ?? "nats:2.10-alpine";
  let builder = new GenericContainer(image)
    .withCommand(["-js"])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage(/Server is ready/i, 1))
    .withStartupTimeout(30_000);
  if (opts.network) builder = builder.withNetwork(opts.network);
  if (opts.networkAliases)
    builder = builder.withNetworkAliases(...opts.networkAliases);
  const container = await builder.start();

  const host = container.getHost();
  const port = container.getMappedPort(4222);
  return {
    container,
    host,
    port,
    url: `nats://${host}:${port}`,
    stop: async () => {
      await container.stop({ remove: true, removeVolumes: true });
    },
  };
}
