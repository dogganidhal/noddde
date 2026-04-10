import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";

/** Builds a minimal mock consumer with all required methods. */
function makeMockConsumer() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    commitOffsets: vi.fn().mockResolvedValue(undefined),
  };
}

/** Builds a minimal mock producer with all required methods. */
function makeMockProducer() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe("KafkaEventBus", () => {
  it("should publish event to topic derived from event name", async () => {
    const mockProducer = makeMockProducer();
    const mockConsumer = makeMockConsumer();
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    // Inject mock kafka client
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "AccountCreated",
        messages: [
          expect.objectContaining({
            value: expect.stringContaining("AccountCreated"),
          }),
        ],
      }),
    );
  });

  it("should prepend topicPrefix to event name for topic", async () => {
    const mockProducer = makeMockProducer();
    const mockConsumer = makeMockConsumer();
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      topicPrefix: "noddde.",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({ name: "OrderPlaced", payload: {} });

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "noddde.OrderPlaced" }),
    );
  });

  it("should throw when dispatching before connect", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    bus.on("AccountCreated", handler);

    // Simulate consumer message delivery
    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await (bus as any)._handleMessage("AccountCreated", JSON.stringify(event));

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should invoke all handlers concurrently via Promise.all", async () => {
    const results: string[] = [];
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    bus.on("TestEvent", async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push("slow");
    });
    bus.on("TestEvent", async () => {
      results.push("fast");
    });

    const event = { name: "TestEvent", payload: {} };
    await (bus as any)._handleMessage("TestEvent", JSON.stringify(event));

    // Both handlers completed
    expect(results).toContain("slow");
    expect(results).toContain("fast");
    expect(results).toHaveLength(2);
    // "fast" completes before "slow" because they run in parallel
    expect(results[0]).toBe("fast");
  });

  it("should reject if any handler throws during parallel invocation", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    const successHandler = vi.fn();
    bus.on("TestEvent", successHandler);
    bus.on("TestEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "TestEvent", payload: {} };
    await expect(
      (bus as any)._handleMessage("TestEvent", JSON.stringify(event)),
    ).rejects.toThrow("handler failed");
  });

  it("should map BrokerResilience to kafkajs retry configuration", () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      resilience: {
        maxAttempts: 11,
        initialDelayMs: 500,
        maxDelayMs: 60000,
      },
    });

    // The resilience config should be stored for mapping during connect()
    expect((bus as any)._config.resilience).toEqual({
      maxAttempts: 11,
      initialDelayMs: 500,
      maxDelayMs: 60000,
    });
  });

  it("should configure consumer with sessionTimeout and heartbeatInterval", async () => {
    const mockProducer = makeMockProducer();
    const mockConsumer = makeMockConsumer();
    const consumerFn = vi.fn().mockReturnValue(mockConsumer);
    const mockKafka = { producer: () => mockProducer, consumer: consumerFn };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      sessionTimeout: 60000,
      heartbeatInterval: 5000,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    expect(consumerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "test-group",
        sessionTimeout: 60000,
        heartbeatInterval: 5000,
      }),
    );
  });

  it("should disconnect and clear handlers on close", async () => {
    const mockProducer = makeMockProducer();
    const mockConsumer = makeMockConsumer();
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    bus.on("TestEvent", vi.fn());
    await bus.close();

    expect(mockProducer.disconnect).toHaveBeenCalled();
    expect(mockConsumer.disconnect).toHaveBeenCalled();

    // Dispatch after close should throw
    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow();
  });

  it("should not throw when close is called multiple times", async () => {
    const mockProducer = makeMockProducer();
    const mockConsumer = makeMockConsumer();
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it("should pass autoCommit: false to consumer.run()", async () => {
    const mockProducer = makeMockProducer();
    const runFn = vi.fn().mockResolvedValue(undefined);
    const mockConsumer = {
      ...makeMockConsumer(),
      run: runFn,
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    expect(runFn).toHaveBeenCalledWith(
      expect.objectContaining({ autoCommit: false }),
    );
  });

  it("should call consumer.stop() before consumer.disconnect() on close", async () => {
    const callOrder: string[] = [];
    const mockProducer = makeMockProducer();
    const mockConsumer = {
      ...makeMockConsumer(),
      disconnect: vi.fn().mockImplementation(async () => {
        callOrder.push("disconnect");
      }),
      stop: vi.fn().mockImplementation(async () => {
        callOrder.push("stop");
      }),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.close();

    expect(callOrder).toEqual(["stop", "disconnect"]);
  });

  it("should skip poison messages without throwing on deserialization failure", async () => {
    const handler = vi.fn();
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    bus.on("TestEvent", handler);

    // Call _handleMessage with invalid JSON — should not throw
    await expect(
      (bus as any)._handleMessage("TestEvent", "{invalid json"),
    ).resolves.toBeUndefined();

    // Handler should not have been called
    expect(handler).not.toHaveBeenCalled();
  });

  it("should serialize the full event object including metadata", async () => {
    const mockProducer = makeMockProducer();
    const mockConsumer = makeMockConsumer();
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: { eventId: "evt-1", correlationId: "corr-1" },
    };
    await bus.dispatch(event);

    const sentValue = mockProducer.send.mock.calls[0]![0].messages[0].value;
    const parsed = JSON.parse(sentValue);
    expect(parsed).toEqual(event);
  });

  it("should explicitly commit offsets after handling", async () => {
    const mockProducer = makeMockProducer();
    const commitOffsets = vi.fn().mockResolvedValue(undefined);
    let capturedEachMessage: ReturnType<typeof vi.fn> | undefined;

    const mockConsumer = {
      ...makeMockConsumer(),
      commitOffsets,
      run: vi.fn().mockImplementation(async ({ eachMessage }: any) => {
        capturedEachMessage = eachMessage;
      }),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    const handler = vi.fn().mockResolvedValue(undefined);
    bus.on("AccountCreated", handler);

    await bus.connect();

    // Simulate kafkajs delivering a message via the eachMessage callback
    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await capturedEachMessage!({
      topic: "AccountCreated",
      partition: 0,
      message: {
        offset: "42",
        value: Buffer.from(JSON.stringify(event)),
      },
    });

    expect(handler).toHaveBeenCalledWith(event);
    expect(commitOffsets).toHaveBeenCalledWith([
      {
        topic: "AccountCreated",
        partition: 0,
        offset: "43",
      },
    ]);
  });

  it("should deduplicate concurrent connect() calls", async () => {
    const mockProducer = makeMockProducer();
    const mockConsumer = makeMockConsumer();
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    // Fire two concurrent connect() calls
    await Promise.all([bus.connect(), bus.connect()]);

    // Producer and consumer connect should each be called exactly once
    expect(mockProducer.connect).toHaveBeenCalledTimes(1);
    expect(mockConsumer.connect).toHaveBeenCalledTimes(1);
  });

  it("should log error and remove topic from subscribed set when subscribe fails after connect", async () => {
    const mockProducer = makeMockProducer();
    const subscribeError = new Error("subscribe failed");
    const mockConsumer = {
      ...makeMockConsumer(),
      subscribe: vi.fn().mockRejectedValue(subscribeError),
    };
    const mockKafka = {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    // Re-configure subscribe to always reject (connect() has no pre-registered
    // handlers so it won't call subscribe — only the on() call below will).
    mockConsumer.subscribe.mockImplementation(async () => {
      throw subscribeError;
    });

    // Force connect() to skip the subscribe loop (no pre-registered handlers)
    await bus.connect();

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    bus.on("NewEvent", vi.fn());

    // Allow the async subscribe rejection to propagate
    await new Promise((r) => setTimeout(r, 0));

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect((bus as any)._subscribedTopics.has("NewEvent")).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});
