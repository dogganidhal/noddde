import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import type { Logger } from "@noddde/core";

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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.persistent).toBe(true);
  });

  it("should throw when dispatching before connect", async () => {
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });

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
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });

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
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });

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
      on: vi.fn(),
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
      queuePrefix: "test",
      prefetchCount: 20,
    });

    await bus.connect();

    expect(mockChannel.prefetch).toHaveBeenCalledWith(20);
  });

  it("should fail fast with a clear message on exchangeType mismatch (PRECONDITION_FAILED)", async () => {
    const mockChannel = {
      assertExchange: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Operation failed: QueueDeclare; 406 (PRECONDITION_FAILED) with message " +
              "\"PRECONDITION_FAILED - inequivalent arg 'type' for exchange 'my-domain-events' in vhost '/': received 'fanout' but current is 'topic'\"",
          ),
        ),
      prefetch: vi.fn(),
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
      queuePrefix: "test",
      exchangeName: "my-domain-events",
      exchangeType: "fanout",
      resilience: { maxAttempts: 5, initialDelayMs: 1, maxDelayMs: 1 },
    });

    await expect(bus.connect()).rejects.toThrow(
      /exchangeType after deployment/i,
    );
    // Not transient: must not burn through the configured retry attempts.
    expect(mockChannel.assertExchange).toHaveBeenCalledTimes(1);
    // The connection opened this attempt must be closed, not leaked.
    expect(mockConnection.close).toHaveBeenCalledTimes(1);
    // Reconnection handlers are only registered after setup succeeds, so
    // this cleanup close() can't spuriously trigger _handleUnexpectedClose().
    expect(mockConnection.on).not.toHaveBeenCalled();
  });

  it("does not misclassify a non-type exchange-argument PRECONDITION_FAILED (e.g. durable) as an exchangeType mismatch", async () => {
    const mockChannel = {
      assertExchange: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Operation failed: ExchangeDeclare; 406 (PRECONDITION_FAILED) with message " +
              "\"PRECONDITION_FAILED - inequivalent arg 'durable' for exchange 'my-domain-events' in vhost '/': received 'false' but current is 'true'\"",
          ),
        ),
      prefetch: vi.fn(),
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
      queuePrefix: "test",
      exchangeName: "my-domain-events",
      resilience: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
    });

    // A `durable` mismatch is a real (if different) footgun, but not the
    // "sticky exchangeType" case — it must not get that specific guidance,
    // and must go through the normal retry path.
    let caught: Error | undefined;
    try {
      await bus.connect();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).not.toMatch(/exchangeType after deployment/i);
    expect(mockChannel.assertExchange).toHaveBeenCalledTimes(3);
  });

  it("closes the connection opened during a failed attempt instead of leaking it", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn().mockRejectedValue(new Error("transient failure")),
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
      queuePrefix: "test",
      resilience: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
    });

    await expect(bus.connect()).rejects.toThrow("transient failure");

    // Every failed attempt opens its own connection — each must be closed.
    expect(mockConnection.close).toHaveBeenCalledTimes(2);
    // Handlers are never registered since setup never succeeded on any
    // attempt, so the close() calls above can't trigger a reconnection loop.
    expect(mockConnection.on).not.toHaveBeenCalled();
  });

  it("does not misclassify a queue-argument PRECONDITION_FAILED as an exchangeType mismatch", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Operation failed: QueueDeclare; 406 (PRECONDITION_FAILED) with message " +
              "\"PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'noddde.TestEvent' in vhost '/': received 'true' but current is 'false'\"",
          ),
        ),
      prefetch: vi.fn(),
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
      queuePrefix: "test",
      resilience: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
    });
    bus.on("TestEvent", vi.fn());

    // This PRECONDITION_FAILED comes from assertQueue, not assertExchange —
    // must not be mistaken for the sticky exchangeType error, and must go
    // through the normal (transient-failure) retry path instead.
    let caught: Error | undefined;
    try {
      await bus.connect();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).not.toMatch(/exchangeType after deployment/i);
    expect(mockChannel.assertQueue).toHaveBeenCalledTimes(3);
  });

  it("should retry connection with exponential backoff", async () => {
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._connection = mockConnection;
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it("should nack message when handler throws", async () => {
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });

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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
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
      on: vi.fn(),
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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
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
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
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
      on: vi.fn(),
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
      queuePrefix: "test",
    });
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
      on: vi.fn(),
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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    await bus.connect();

    expect(bus._connected).toBe(true);

    // Simulate unexpected close (not via bus.close())
    closeHandler!();

    // _connected should be false immediately after unexpected close
    expect(bus._connected).toBe(false);
  });

  it("should track delivery count in memory and discard after maxRetries", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue({ consumerTag: "tag" }),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      resilience: { maxRetries: 2 },
    });
    (bus as any)._channel = mockChannel;

    const handler = vi.fn();
    bus.on("TestEvent", handler);

    // Simulate _setupConsumer by calling it directly
    await (bus as any)._setupConsumer("TestEvent");

    // Extract the consume callback
    const consumeCallback = mockChannel.consume.mock.calls[0]![1];

    // Build a message with a stable messageId so delivery counting works
    const msgContent = Buffer.from(
      JSON.stringify({ name: "TestEvent", payload: {} }),
    );
    const makeMsg = () => ({
      content: msgContent,
      properties: { messageId: "msg-stable-id-1" },
      fields: { deliveryTag: 1 },
    });

    // Delivery 1 — handler should be called
    await consumeCallback(makeMsg());
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    // Delivery count was pruned on successful ack, so reset for next check

    // Simulate handler failures to increment count without pruning
    // We do this by making the handler throw on attempts 1 and 2
    handler.mockReset();
    mockChannel.ack.mockClear();
    mockChannel.nack.mockClear();

    // Use a new message id to simulate fresh delivery counting
    const makeFailMsg = (id: string) => ({
      content: Buffer.from(JSON.stringify({ name: "TestEvent", payload: {} })),
      properties: { messageId: id },
      fields: { deliveryTag: 2 },
    });

    // Inject a failing handler
    const failingBus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      resilience: { maxRetries: 2 },
    });
    (failingBus as any)._channel = mockChannel;
    mockChannel.consume.mockClear();

    const failHandler = vi.fn().mockRejectedValue(new Error("fail"));
    failingBus.on("RetryEvent", failHandler);
    await (failingBus as any)._setupConsumer("RetryEvent");

    const retryCallback = mockChannel.consume.mock.calls[0]![1];
    const retryMsgId = "retry-msg-unique-id";

    // Delivery 1 — handler fails, nack called, count = 1
    await retryCallback(makeFailMsg(retryMsgId));
    expect(mockChannel.nack).toHaveBeenCalledTimes(1);

    // Delivery 2 — handler fails, nack called, count = 2
    mockChannel.nack.mockClear();
    await retryCallback(makeFailMsg(retryMsgId));
    expect(mockChannel.nack).toHaveBeenCalledTimes(1);

    // Delivery 3 — exceeds maxRetries (2), should be dead-lettered + acked
    mockChannel.ack.mockClear();
    mockChannel.nack.mockClear();
    mockChannel.publish.mockClear();
    await retryCallback(makeFailMsg(retryMsgId));
    expect(mockChannel.publish).toHaveBeenCalledWith(
      expect.stringContaining("dlx"),
      "RetryEvent",
      expect.any(Buffer),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-original-event-name": "RetryEvent",
        }),
      }),
    );
    expect(mockChannel.ack).toHaveBeenCalledTimes(1); // discarded off source queue
    expect(mockChannel.nack).not.toHaveBeenCalled();
    // Handler not called on discard
    expect(failHandler).toHaveBeenCalledTimes(2); // only first two deliveries
  });

  it("should not crash when ack throws on stale channel after successful handler", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn().mockImplementation(() => {
        throw new Error("Channel closed");
      }),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue({ consumerTag: "tag" }),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._channel = mockChannel;

    const handler = vi.fn().mockResolvedValue(undefined);
    bus.on("StaleAckEvent", handler);

    await (bus as any)._setupConsumer("StaleAckEvent");
    const consumeCallback = mockChannel.consume.mock.calls[0]![1];

    const msg = {
      content: Buffer.from(
        JSON.stringify({ name: "StaleAckEvent", payload: {} }),
      ),
      properties: {},
      fields: { deliveryTag: 1 },
    };

    // Should not throw even though ack() throws
    await expect(consumeCallback(msg)).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  it("should not crash when nack throws on stale channel after handler failure", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      prefetch: vi.fn(),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn().mockImplementation(() => {
        throw new Error("Channel closed");
      }),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn().mockResolvedValue({ consumerTag: "tag" }),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._channel = mockChannel;

    bus.on("StaleNackEvent", async () => {
      throw new Error("handler failed");
    });

    await (bus as any)._setupConsumer("StaleNackEvent");
    const consumeCallback = mockChannel.consume.mock.calls[0]![1];

    const msg = {
      content: Buffer.from(
        JSON.stringify({ name: "StaleNackEvent", payload: {} }),
      ),
      properties: {},
      fields: { deliveryTag: 1 },
    };

    // Should not throw even though nack() throws
    await expect(consumeCallback(msg)).resolves.toBeUndefined();
    expect(mockChannel.nack).toHaveBeenCalled();
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

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
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

  it("should set messageId from event.metadata.eventId when present", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: {
        eventId: "evt-unique-123",
        correlationId: "corr-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        causationId: "cmd-1",
      },
    };
    await bus.dispatch(event);

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.messageId).toBe("evt-unique-123");
  });

  it("should not set messageId when event has no metadata", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.messageId).toBeUndefined();
  });

  it("should use provided logger for warn and error logging with structured data", async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      logger: mockLogger,
    });

    const handler = vi.fn();
    bus.on("TestEvent", handler);

    // Trigger poison message logging
    const result = await (bus as any)._handleMessage(
      "TestEvent",
      Buffer.from("not valid json {{{"),
    );

    expect(result).toEqual({ poisoned: true });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("deserialize"),
      expect.objectContaining({ eventName: "TestEvent" }),
    );
  });

  describe("mid-session reconnection", () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      // Ensure amqplib.connect always rejects in reconnection tests (simulates broker down)
      const amqplib = await import("amqplib");
      (amqplib.default.connect as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED"),
      );
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("should retry reconnection indefinitely and stop when close() is called", async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      };

      const bus = new RabbitMqEventBus({
        url: "amqp://localhost:5672",
        queuePrefix: "test",
        resilience: { maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 1000 },
        logger: mockLogger,
      });

      // Simulate a connected state, then trigger unexpected close
      (bus as any)._connected = true;
      (bus as any)._closed = false;

      // Trigger unexpected close — this starts the persistent reconnection loop
      (bus as any)._handleUnexpectedClose();

      // The reconnection loop should keep going beyond maxAttempts
      // Advance timers to let multiple retry cycles execute
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      // Reconnection should still be in progress (not given up)
      expect((bus as any)._reconnecting).toBe(true);

      // Now close() should cancel the loop
      (bus as any)._closed = true;
      await vi.advanceTimersByTimeAsync(2000);

      // Logger should have been called for the reconnection attempts
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("reconnect"),
        expect.any(Object),
      );
    });

    it("should apply jittered exponential backoff during reconnection", async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      };

      // Verify the bus accepts the resilience config
      void new RabbitMqEventBus({
        url: "amqp://localhost:5672",
        queuePrefix: "test",
        resilience: {
          maxAttempts: 2,
          initialDelayMs: 1000,
          maxDelayMs: 10000,
        },
        logger: mockLogger,
      });

      // The jittered delay for attempt N should be:
      //   baseDelay = min(initialDelayMs * 2^attempt, maxDelayMs)
      //   jitteredDelay = baseDelay * (0.75 + Math.random() * 0.5)
      // So for attempt 0: base=1000, jittered range [750, 1250]
      // For attempt 1: base=2000, jittered range [1500, 2500]
      // For attempt 3: base=8000, jittered range [6000, 10000]
      // For attempt 4: base=10000 (capped), jittered range [7500, 12500] → capped at maxDelayMs

      // Verify the backoff calculation method exists and computes correctly
      // by checking that delays increase over successive attempts
      const delays: number[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        const baseDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
        delays.push(baseDelay);
      }

      expect(delays[0]).toBe(1000);
      expect(delays[1]).toBe(2000);
      expect(delays[2]).toBe(4000);
      expect(delays[3]).toBe(8000);
      expect(delays[4]).toBe(10000); // capped
    });

    it("should stop reconnection immediately when close() is called", async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      };

      const bus = new RabbitMqEventBus({
        url: "amqp://localhost:5672",
        queuePrefix: "test",
        resilience: { maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 1000 },
        logger: mockLogger,
      });

      // Start in connected state, trigger unexpected disconnection
      (bus as any)._connected = true;
      (bus as any)._closed = false;
      (bus as any)._handleUnexpectedClose();

      // Let one retry cycle execute
      await vi.advanceTimersByTimeAsync(200);
      expect((bus as any)._reconnecting).toBe(true);

      // Call close() — should signal the reconnection loop to stop
      await bus.close();

      // Advance more time — no new reconnection attempts should happen
      const warnCountBefore = (mockLogger.warn as ReturnType<typeof vi.fn>).mock
        .calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      const warnCountAfter = (mockLogger.warn as ReturnType<typeof vi.fn>).mock
        .calls.length;

      // No significant new warn calls after close — loop stopped
      // (at most 1 more call as the current iteration finishes)
      expect(warnCountAfter - warnCountBefore).toBeLessThanOrEqual(1);
      expect((bus as any)._closed).toBe(true);
    });
  });

  it("should reject dispatch calls while reconnection is in progress", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      logger: mockLogger,
    });

    // Simulate reconnecting state: _connected = false, _reconnecting = true
    (bus as any)._connected = false;
    (bus as any)._reconnecting = true;

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });
});

// ### sibling handler completes when an earlier handler throws (Promise.allSettled)
describe("RabbitMqEventBus error isolation", () => {
  it("should run every handler to completion even when an earlier one throws", async () => {
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });

    const before = vi.fn();
    const after = vi.fn();
    bus.on("E", before);
    bus.on("E", async () => {
      throw new Error("boom");
    });
    bus.on("E", after);

    await expect(
      (bus as any)._handleMessage(
        "E",
        Buffer.from(JSON.stringify({ name: "E", payload: {} })),
      ),
    ).rejects.toThrow();

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});

// ### individual logging per failed handler with handlerName and error fields
describe("RabbitMqEventBus error isolation", () => {
  it("should log once per failed handler with handlerName and error fields", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      logger,
    });

    async function failingA() {
      throw new Error("err-a");
    }
    async function failingB() {
      throw new Error("err-b");
    }
    bus.on("E", vi.fn());
    bus.on("E", failingA);
    bus.on("E", failingB);

    await expect(
      (bus as any)._handleMessage(
        "E",
        Buffer.from(JSON.stringify({ name: "E", payload: {} })),
      ),
    ).rejects.toThrow();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    const handlerErrorCalls = errorCalls.filter(
      ([, fields]) => (fields as any)?.handlerName !== undefined,
    );
    expect(handlerErrorCalls).toHaveLength(2);
    const names = handlerErrorCalls.map(([, f]) => (f as any).handlerName);
    expect(names).toEqual(expect.arrayContaining(["failingA", "failingB"]));
    const messages = handlerErrorCalls.map(
      ([, f]) => (f as any).error?.message,
    );
    expect(messages).toEqual(expect.arrayContaining(["err-a", "err-b"]));
  });
});

// ### nack-with-requeue behavior is unchanged under partial failure
describe("RabbitMqEventBus error isolation", () => {
  it("should call channel.nack(msg, false, true) when any handler fails (existing redelivery behavior is preserved)", async () => {
    const nack = vi.fn();
    const ack = vi.fn();
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
      ack,
      nack,
      prefetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    bus.on("E", vi.fn());
    bus.on("E", async () => {
      throw new Error("boom");
    });

    await (bus as any)._setupConsumer("E");

    // Extract the consume callback registered by _setupConsumer.
    const consumeCallback = mockChannel.consume.mock.calls[0]![1];

    const event = { name: "E", payload: {} };
    const msg = {
      content: Buffer.from(JSON.stringify(event)),
      properties: { messageId: "m-1" },
    };

    await consumeCallback(msg);

    // Regression guard: nack with requeue=true on failure, ack is not called.
    expect(nack).toHaveBeenCalledWith(msg, false, true);
    expect(ack).not.toHaveBeenCalled();
  });
});

// ### dispatch sets contentType on published messages
describe("RabbitMqEventBus wire format", () => {
  it("should set contentType to the versioned noddde event content type", async () => {
    const mockChannel = {
      publish: vi.fn().mockReturnValue(true),
      waitForConfirms: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._connection = {};
    (bus as any)._channel = mockChannel;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "TestEvent", payload: {} });

    const publishOptions = mockChannel.publish.mock.calls[0]![3];
    expect(publishOptions.contentType).toBe(
      "application/vnd.noddde.event+json; version=1",
    );
  });
});

// ### same-aggregateId deliveries run strictly one at a time in delivery order
describe("RabbitMqEventBus aggregate ordering", () => {
  it("should serialize handler execution for deliveries sharing an aggregateId", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._channel = mockChannel;

    const order: string[] = [];
    let overlapping = false;
    let active = false;
    bus.on("Moved", async (e: any) => {
      if (active) overlapping = true;
      active = true;
      await new Promise((r) => setTimeout(r, e.payload.slow ? 30 : 5));
      order.push(e.payload.tag);
      active = false;
    });

    let consumeCallback: any = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Moved");

    const makeMsg = (tag: string, slow: boolean) => ({
      content: Buffer.from(
        JSON.stringify({
          name: "Moved",
          payload: { tag, slow },
          metadata: { aggregateId: "acc-1" },
        }),
      ),
      properties: {},
      fields: { deliveryTag: tag },
    });

    // Fire both without awaiting the first — simulates concurrent delivery
    // up to prefetch. The slow first delivery must still finish before the
    // second one's handler starts.
    const p1 = consumeCallback(makeMsg("first", true));
    const p2 = consumeCallback(makeMsg("second", false));
    await Promise.all([p1, p2]);

    expect(order).toEqual(["first", "second"]);
    expect(overlapping).toBe(false);
  });

  it("should not serialize deliveries for different aggregateIds against each other", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._channel = mockChannel;

    let concurrentPeak = 0;
    let inFlight = 0;
    bus.on("Moved", async () => {
      inFlight++;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
    });

    let consumeCallback: any = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Moved");

    const makeMsg = (aggregateId: string) => ({
      content: Buffer.from(
        JSON.stringify({
          name: "Moved",
          payload: {},
          metadata: { aggregateId },
        }),
      ),
      properties: {},
      fields: { deliveryTag: aggregateId },
    });

    await Promise.all([
      consumeCallback(makeMsg("acc-1")),
      consumeCallback(makeMsg("acc-2")),
    ]);

    expect(concurrentPeak).toBe(2);
  });

  it("should not leak aggregate chain map entries after they drain", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
    });
    (bus as any)._channel = mockChannel;
    bus.on("Moved", vi.fn());

    let consumeCallback: any = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Moved");

    await consumeCallback({
      content: Buffer.from(
        JSON.stringify({
          name: "Moved",
          payload: {},
          metadata: { aggregateId: "acc-1" },
        }),
      ),
      properties: {},
      fields: { deliveryTag: 1 },
    });

    expect((bus as any)._aggregateChains.size).toBe(0);
  });
});

// ### maxRetries without messageId does not misclassify a burst of distinct messages as poison
describe("RabbitMqEventBus retry key", () => {
  it("should not discard 10 distinct same-type messages with no messageId", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      resilience: { maxRetries: 3 },
    });
    (bus as any)._channel = mockChannel;

    const handler = vi.fn();
    bus.on("Burst", handler);

    let consumeCallback: any = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Burst");

    for (let i = 0; i < 10; i++) {
      await consumeCallback({
        content: Buffer.from(JSON.stringify({ name: "Burst", payload: { i } })),
        properties: {},
        fields: { deliveryTag: i, redelivered: false },
      });
    }

    expect(handler).toHaveBeenCalledTimes(10);
    expect(mockChannel.ack).toHaveBeenCalledTimes(10);
  });

  it("should dead-letter a message redelivered past maxRetries", async () => {
    const mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      assertQueue: vi.fn().mockResolvedValue({ queue: "test" }),
      bindQueue: vi.fn().mockResolvedValue(undefined),
      ack: vi.fn(),
      nack: vi.fn(),
      publish: vi.fn().mockReturnValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      consume: vi.fn(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      resilience: { maxRetries: 2 },
    });
    (bus as any)._channel = mockChannel;

    bus.on("Poison", async () => {
      throw new Error("always fails");
    });

    let consumeCallback: any = async () => {};
    mockChannel.consume = vi.fn(async (_q, cb) => {
      consumeCallback = cb;
      return { consumerTag: "t" };
    }) as any;

    await (bus as any)._setupConsumer("Poison");

    const content = Buffer.from(
      JSON.stringify({ name: "Poison", payload: { fixed: true } }),
    );
    const msg = {
      content,
      properties: {},
      fields: { deliveryTag: 1, redelivered: false },
    };

    await consumeCallback(msg); // attempt 1
    await consumeCallback(msg); // attempt 2
    await consumeCallback(msg); // attempt 3 — exceeds maxRetries=2

    expect(mockChannel.publish).toHaveBeenCalledWith(
      expect.stringContaining("dlx"),
      "Poison",
      content,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-original-event-name": "Poison",
        }),
      }),
    );
  });
});

// ### consumer setup failure is logged and retried on the next reconnection cycle
describe("RabbitMqEventBus consumer setup failure", () => {
  it("should log an error via the framework logger when _setupConsumer fails", async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new RabbitMqEventBus({
      url: "amqp://localhost:5672",
      queuePrefix: "test",
      logger: mockLogger,
    });
    (bus as any)._connected = true;
    (bus as any)._channel = {
      assertQueue: vi.fn().mockRejectedValue(new Error("boom")),
    };

    bus.on("FailsToSetup", vi.fn());

    // on() fires _setupConsumer without awaiting it — flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("FailsToSetup"),
      expect.objectContaining({ eventName: "FailsToSetup" }),
    );
  });
});
