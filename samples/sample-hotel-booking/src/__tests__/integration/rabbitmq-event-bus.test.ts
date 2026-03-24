import { describe, expect, it, beforeAll, afterAll } from "vitest";

// Disable Ryuk (TestContainers resource reaper) — it fails with Colima/non-standard Docker setups.
// Containers are cleaned up manually in afterAll.
// eslint-disable-next-line turbo/no-undeclared-env-vars
process.env["TESTCONTAINERS_RYUK_DISABLED"] = "true";

/**
 * RabbitMQ integration test using TestContainers.
 * Requires Docker to be running.
 */
describe("RabbitMQ EventBus (integration)", () => {
  let connectionUrl: string;
  let container: any;

  beforeAll(async () => {
    const { RabbitMQContainer } = await import("@testcontainers/rabbitmq");
    container = await new RabbitMQContainer().start();
    connectionUrl = container.getAmqpUrl();
  }, 60_000);

  afterAll(async () => {
    await container?.stop();
  });

  it("should dispatch and receive events via RabbitMQ", async () => {
    const { RabbitMQEventBus } = await import(
      "../../infrastructure/messaging/rabbitmq-event-bus"
    );

    const bus = new RabbitMQEventBus(connectionUrl);
    const received: any[] = [];

    bus.on("TestEvent", async (event) => {
      received.push(event);
    });

    await bus.connect();

    // Small delay to ensure consumer is ready
    await new Promise((resolve) => setTimeout(resolve, 200));

    await bus.dispatch({
      name: "TestEvent",
      payload: { message: "hello from RabbitMQ" },
    });

    // Wait for the message to be consumed
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      name: "TestEvent",
      payload: { message: "hello from RabbitMQ" },
    });

    await bus.disconnect();
  });

  it("should support multiple handlers for the same event", async () => {
    const { RabbitMQEventBus } = await import(
      "../../infrastructure/messaging/rabbitmq-event-bus"
    );

    const bus = new RabbitMQEventBus(connectionUrl);
    const handler1Received: any[] = [];
    const handler2Received: any[] = [];

    bus.on("MultiEvent", async (event) => handler1Received.push(event));
    bus.on("MultiEvent", async (event) => handler2Received.push(event));

    await bus.connect();
    await new Promise((resolve) => setTimeout(resolve, 200));

    await bus.dispatch({
      name: "MultiEvent",
      payload: { value: 42 },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(handler1Received).toHaveLength(1);
    expect(handler2Received).toHaveLength(1);

    await bus.disconnect();
  });
});
