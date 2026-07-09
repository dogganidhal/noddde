import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from "@testcontainers/rabbitmq";
import type { StartedNetwork } from "testcontainers";

export interface StartedRabbitMq {
  container: StartedRabbitMQContainer;
  /** AMQP URI for amqplib. */
  url: string;
  host: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startRabbitMq(
  opts: {
    image?: string;
    /** Join a shared network so a Toxiproxy sidecar can reach it by alias. */
    network?: StartedNetwork;
    /** In-network hostname aliases (e.g. `["rabbitmq"]`) for proxy upstreams. */
    networkAliases?: string[];
  } = {},
): Promise<StartedRabbitMq> {
  const image = opts.image ?? "rabbitmq:3.13-management-alpine";
  let builder = new RabbitMQContainer(image);
  if (opts.network) builder = builder.withNetwork(opts.network);
  if (opts.networkAliases)
    builder = builder.withNetworkAliases(...opts.networkAliases);
  const container = await builder.start();
  return {
    container,
    url: container.getAmqpUrl(),
    host: container.getHost(),
    port: container.getMappedPort(5672),
    stop: async () => {
      await container.stop({ remove: true, removeVolumes: true });
    },
  };
}
