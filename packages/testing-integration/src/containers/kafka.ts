import {
  KafkaContainer,
  type StartedKafkaContainer,
} from "@testcontainers/kafka";

export interface StartedKafka {
  container: StartedKafkaContainer;
  /** Bootstrap brokers list (`["host:port"]`) for kafkajs. */
  brokers: string[];
  stop: () => Promise<void>;
}

/**
 * Starts a single-node Kafka in KRaft mode (no Zookeeper) — fast and
 * sufficient for integration tests. Uses confluentinc/cp-kafka.
 */
export async function startKafka(
  opts: { image?: string } = {},
): Promise<StartedKafka> {
  const image = opts.image ?? "confluentinc/cp-kafka:7.6.1";
  const container = await new KafkaContainer(image).withKraft().start();
  const broker = `${container.getHost()}:${container.getMappedPort(9093)}`;
  return {
    container,
    brokers: [broker],
    stop: async () => {
      await container.stop({ remove: true, removeVolumes: true });
    },
  };
}
