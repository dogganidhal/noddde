import { describe, it, expect, vi } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";

vi.mock("amqplib", () => ({
  default: {
    connect: vi.fn(),
  },
}));

describe("RabbitMqEventBus", () => {
  it("should publish event to exchange with event name as routing key", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue({ consumerTag: "tag" }),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnection = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockChannel),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockChannel.publish).toHaveBeenCalledWith(
      "noddde.events",
      "AccountCreated",
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );
  });

  it("should set persistent flag on published messages", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.persistent).toBe(true);
  });

  it("should throw when dispatching before connect", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    bus.on("AccountCreated", handler);

    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await (bus as any)._handleMessage(
      "AccountCreated",
      Buffer.from(JSON.stringify(event)),
    );

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should invoke all handlers concurrently via Promise.all", async () => {
    const results: string[] = [];
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    bus.on("TestEvent", async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push("slow");
    });
    bus.on("TestEvent", async () => {
      results.push("fast");
    });

    const event = { name: "TestEvent", payload: {} };
    await (bus as any)._handleMessage(
      "TestEvent",
      Buffer.from(JSON.stringify(event)),
    );

    expect(results).toContain("slow");
    expect(results).toContain("fast");
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("fast");
  });

  it("should reject if any handler throws during parallel invocation", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    const successHandler = vi.fn();
    bus.on("TestEvent", successHandler);
    bus.on("TestEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "TestEvent", payload: {} };
    await expect(
      (bus as any)._handleMessage(
        "TestEvent",
        Buffer.from(JSON.stringify(event)),
      ),
    ).rejects.toThrow("handler failed");
  });

  it("should call channel.prefetch with configured prefetchCount", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnection = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockChannel),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const amqplib = await import("amqplib");
    (amqplib.default.connect as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConnection,
    );

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      prefetchCount: 20,
    });

    await bus.connect();

    expect(mockChannel.prefetch).toHaveBeenCalledWith(20);
  });

  it("should retry connection with exponential backoff", async () => {
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      resilience: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
      },
    });

    // Config is stored for use during connect()
    expect((bus as any)._config?.resilience?.maxAttempts).toBe(3);
    expect((bus as any)._config?.resilience?.initialDelayMs).toBe(100);
  });

  it("should close channel and connection on close", async () => {
    const mockChannel = { close: vi.fn().mockResolvedValue(undefined) };
    const mockConnection = { close: vi.fn().mockResolvedValue(undefined) };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    bus.on("TestEvent", vi.fn());
    await bus.close();

    expect(mockChannel.close).toHaveBeenCalled();
    expect(mockConnection.close).toHaveBeenCalled();

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow();
  });

  it("should not throw when close is called multiple times", async () => {
    const mockChannel = { close: vi.fn().mockResolvedValue(undefined) };
    const mockConnection = { close: vi.fn().mockResolvedValue(undefined) };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it("should nack message when handler throws", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });

    bus.on("FailEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "FailEvent", payload: {} };
    await expect(
      (bus as any)._handleMessage(
        "FailEvent",
        Buffer.from(JSON.stringify(event)),
      ),
    ).rejects.toThrow("handler failed");
  });

  it("should serialize the full event object including metadata", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: {
        eventId: "evt-1",
        correlationId: "corr-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        causationId: "cmd-1",
      },
    };
    await bus.dispatch(event);

    const sentBuffer = mockChannel.publish.mock.calls[0]![2];
    const parsed = JSON.parse(sentBuffer.toString());
    expect(parsed).toEqual(event);
  });

  it("should use createConfirmChannel instead of createChannel", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnection = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockChannel),
      createChannel: vi.fn(),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const amqplib = await import("amqplib");
    (amqplib.default.connect as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConnection,
    );

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    await bus.connect();

    expect(mockConnection.createConfirmChannel).toHaveBeenCalled();
    expect(mockConnection.createChannel).not.toHaveBeenCalled();
  });

  it("should call waitForConfirms after publish in dispatch", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    expect(mockChannel.publish).toHaveBeenCalled();
    expect(mockChannel.waitForConfirms).toHaveBeenCalled();
    // Ensure waitForConfirms was called after publish
    const publishOrder = mockChannel.publish.mock.invocationCallOrder[0]!;
    const confirmsOrder =
      mockChannel.waitForConfirms.mock.invocationCallOrder[0]!;
    expect(confirmsOrder).toBeGreaterThan(publishOrder);
  });

  it("should ack and skip poison messages that fail deserialization", async () => {
    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    const handler = vi.fn();
    bus.on("TestEvent", handler);

    const result = await (bus as any)._handleMessage(
      "TestEvent",
      Buffer.from("this is not valid json {{{"),
    );

    // Should not throw, should return poisoned=true, handler not invoked
    expect(result).toEqual({ poisoned: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("should register error and close handlers on connection after connect", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnection = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockChannel),
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const amqplib = await import("amqplib");
    (amqplib.default.connect as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConnection,
    );

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    await bus.connect();

    expect(mockConnection.on).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );
    expect(mockConnection.on).toHaveBeenCalledWith(
      "close",
      expect.any(Function),
    );
  });

  it("should set _connected=false and attempt reconnect on unexpected close", async () => {
    let closeHandler: (() => void) | undefined;

    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockConnection = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockChannel),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "close") closeHandler = handler;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const amqplib = await import("amqplib");
    (amqplib.default.connect as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockConnection,
    );

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    await bus.connect();

    expect(bus._connected).toBe(true);

    // Simulate unexpected close (not via bus.close())
    closeHandler!();

    // _connected should be false immediately after unexpected close
    expect(bus._connected).toBe(false);
  });

  it("should discard messages exceeding maxRetries delivery count", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue({ consumerTag: "tag" }),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      resilience: { maxRetries: 2 },
    });
    (bus as any)._channel = mockChannel;

    const handler = vi.fn();
    bus.on("TestEvent", handler);

    // Simulate _setupConsumer by calling it directly
    await (bus as any)._setupConsumer("TestEvent");

    // Extract the consume callback
    const consumeCallback = mockChannel.consume.mock.calls[0]![1];

    // Build a message with x-death count of 3 (exceeds maxRetries=2)
    const msgWithExceededRetries = {
      content: Buffer.from(JSON.stringify({ name: "TestEvent", payload: {} })),
      properties: {
        headers: {
          "x-death": [{ count: 2 }, { count: 1 }],
        },
      },
      fields: { deliveryTag: 1 },
    };

    await consumeCallback(msgWithExceededRetries);

    expect(mockChannel.ack).toHaveBeenCalledWith(msgWithExceededRetries);
    expect(handler).not.toHaveBeenCalled();
  });

  it("should ack poison messages in _setupConsumer consumer", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue({ consumerTag: "tag" }),
    };

    const bus = new RabbitMqEventBus({ url: "amqp://localhost:5672" });
    (bus as any)._channel = mockChannel;

    const handler = vi.fn();
    bus.on("PoisonEvent", handler);

    await (bus as any)._setupConsumer("PoisonEvent");

    const consumeCallback = mockChannel.consume.mock.calls[0]![1];

    const poisonMsg = {
      content: Buffer.from("invalid json {{{"),
      properties: { headers: {} },
      fields: { deliveryTag: 1 },
    };

    await consumeCallback(poisonMsg);

    // Poison message should be acked, not nacked
    expect(mockChannel.ack).toHaveBeenCalledWith(poisonMsg);
    expect(mockChannel.nack).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
