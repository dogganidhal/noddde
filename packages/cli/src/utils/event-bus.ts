import { select } from "@inquirer/prompts";

/** Supported event bus implementations for project scaffolding. */
export type EventBusAdapter = "event-emitter" | "kafka" | "nats" | "rabbitmq";

/** Prompts the user to choose an event bus implementation. */
export async function promptEventBusAdapter(): Promise<EventBusAdapter> {
  return select({
    message: "Which event bus?",
    choices: [
      {
        name: "EventEmitter (in-memory, no external dependencies)",
        value: "event-emitter" as const,
      },
      {
        name: "Kafka (via @noddde/kafka)",
        value: "kafka" as const,
      },
      {
        name: "NATS (via @noddde/nats)",
        value: "nats" as const,
      },
      {
        name: "RabbitMQ (via @noddde/rabbitmq)",
        value: "rabbitmq" as const,
      },
    ],
  });
}
