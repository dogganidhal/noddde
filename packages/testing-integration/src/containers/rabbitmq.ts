import {
  RabbitMQContainer,
  type StartedRabbitMQContainer,
} from "@testcontainers/rabbitmq";

export interface StartedRabbitMq {
  container: StartedRabbitMQContainer;
  /** AMQP URI for amqplib. */
  url: string;
  host: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startRabbitMq(
  opts: { image?: string } = {},
): Promise<StartedRabbitMq> {
  const image = opts.image ?? "rabbitmq:3.13-management-alpine";
  const container = await new RabbitMQContainer(image).start();
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
