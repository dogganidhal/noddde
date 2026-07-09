import { describe, it, expect, vi } from "vitest";
import { KafkaEventBus } from "@noddde/kafka";
import type { Logger } from "@noddde/core";

/** Builds a minimal mock consumer with all required methods. */
function makeMockConsumer() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    commitOffsets: vi.fn().mockResolvedValue(undefined),
    // KafkaEventBus.connect() listens for the FETCH_START event so it
    // can wait for the consumer to be polling. The mock fires the
    // listener immediately so unit tests don't hang waiting on a real
    // fetch — they only assert on synchronous behaviour after `await
    // connect()`.
    events: { FETCH_START: "consumer.fetch_start" },
    on: vi.fn().mockImplementation((_event: string, listener: () => void) => {
      // Fire on the next tick so connect()'s ready promise resolves
      // before the 30s timeout race kicks in.
      queueMicrotask(listener);
      return () => {};
    }),
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

/**
 * Builds a mock Kafka client for `warmup()` tests. Unlike `makeMockConsumer`
 * / `makeMockProducer`, the producer's `send` here synchronously feeds the
 * message straight into the consumer's captured `eachMessage` callback —
 * simulating a broker with zero network latency so the warmup round-trip
 * resolves deterministically without depending on real timers.
 *
 * Pass `neverDeliver: true` to simulate a broker that swallows the warmup
 * publish (used by the timeout scenario).
 */
function createMockKafkaForWarmup(options?: { neverDeliver?: boolean }) {
  const handlers: Record<
    string,
    // eslint-disable-next-line no-unused-vars
    (event: {
      message: { value: Buffer; offset: string };
      topic: string;
      partition: number;
    }) => Promise<void>
  > = {};

  const mockProducer = {
    send: vi.fn().mockImplementation(async ({ topic, messages }: any) => {
      if (options?.neverDeliver) {
        return;
      }
      const eachMessage = handlers["eachMessage"];
      if (eachMessage) {
        await eachMessage({
          message: {
            value: Buffer.from(messages[0].value as string),
            offset: "0",
          },
          topic,
          partition: 0,
        } as any);
      }
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const mockConsumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation(async ({ eachMessage }: any) => {
      handlers["eachMessage"] = eachMessage;
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    commitOffsets: vi.fn().mockResolvedValue(undefined),
    events: { FETCH_START: "consumer.fetch_start" },
    on: vi.fn().mockImplementation((_event: string, cb: () => void) => {
      cb();
      return () => {};
    }),
  };
  const mockAdmin = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    createTopics: vi.fn().mockResolvedValue(true),
  };

  return {
    mockKafka: {
      producer: () => mockProducer,
      consumer: () => mockConsumer,
      admin: () => mockAdmin,
    },
    mockProducer,
    mockConsumer,
    mockAdmin,
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
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      logger: mockLogger,
    });
    (bus as any)._kafka = mockKafka;

    // Re-configure subscribe to always reject (connect() has no pre-registered
    // handlers so it won't call subscribe — only the on() call below will).
    mockConsumer.subscribe.mockImplementation(async () => {
      throw subscribeError;
    });

    // Force connect() to skip the subscribe loop (no pre-registered handlers)
    await bus.connect();

    bus.on("NewEvent", vi.fn());

    // Allow the async subscribe rejection to propagate
    await new Promise((r) => setTimeout(r, 0));

    expect(mockLogger.error).toHaveBeenCalled();
    expect((bus as any)._subscribedTopics.has("NewEvent")).toBe(false);
  });

  it("should use aggregateId as message key by default", async () => {
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
    await bus.dispatch({
      name: "OrderPlaced",
      payload: {},
      metadata: {
        eventId: "evt-1",
        correlationId: "corr-1",
        timestamp: "2024-01-01T00:00:00.000Z",
        causationId: "cmd-1",
        aggregateId: "order-123",
      },
    } as any);

    const sentKey = mockProducer.send.mock.calls[0]![0].messages[0].key;
    expect(sentKey).toBe("order-123");
  });

  it("should use null key when event has no aggregateId", async () => {
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
    await bus.dispatch({ name: "TestEvent", payload: {} });

    const sentKey = mockProducer.send.mock.calls[0]![0].messages[0].key;
    expect(sentKey).toBeNull();
  });

  it("should use custom function for partition key when provided", async () => {
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
      partitionKeyStrategy: (event) => `custom-${event.name}`,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.dispatch({ name: "OrderPlaced", payload: {} });

    const sentKey = mockProducer.send.mock.calls[0]![0].messages[0].key;
    expect(sentKey).toBe("custom-OrderPlaced");
  });

  it("should use provided logger for warn logging with structured data", async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      logger: mockLogger,
    });

    const handler = vi.fn();
    bus.on("TestEvent", handler);

    // Trigger poison message logging via _handleMessage
    await (bus as any)._handleMessage("TestEvent", "not valid json {{{");

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("deserialize"),
      expect.objectContaining({ eventName: "TestEvent" }),
    );
  });
});

// ### sibling handler completes when an earlier handler throws (Promise.allSettled)
describe("KafkaEventBus error isolation", () => {
  it("should run every handler to completion even when an earlier one throws", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
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
        JSON.stringify({ name: "E", payload: {} }),
      ),
    ).rejects.toThrow();

    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
  });
});

// ### individual logging per failed handler with handlerName and error fields
describe("KafkaEventBus error isolation", () => {
  it("should log once per failed handler with handlerName and error fields", async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
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
        JSON.stringify({ name: "E", payload: {} }),
      ),
    ).rejects.toThrow();

    const errorCalls = (logger.error as ReturnType<typeof vi.fn>).mock.calls;
    // One error log per failed handler (2 failures → 2 log entries).
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

// ### offset commit behavior is unchanged under partial failure
describe("KafkaEventBus error isolation", () => {
  it("should not commit the offset when any handler fails (existing redelivery behavior is preserved)", async () => {
    const mockProducer = {
      send: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const commitOffsets = vi.fn().mockResolvedValue(undefined);
    const mockConsumer = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      commitOffsets,
      run: vi.fn().mockResolvedValue(undefined),
      events: { FETCH_START: "consumer.fetch_start" },
      on: vi.fn().mockImplementation((_event: string, listener: () => void) => {
        queueMicrotask(listener);
        return () => {};
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

    bus.on("E", vi.fn());
    bus.on("E", async () => {
      throw new Error("boom");
    });

    await expect(
      (bus as any)._handleMessage(
        "E",
        JSON.stringify({ name: "E", payload: {} }),
        "topic:0:42",
      ),
    ).rejects.toThrow();

    // The Kafka consumer never commits the offset on a failed handler — broker
    // redelivers per existing retry/maxRetries semantics. Regression guard.
    expect(commitOffsets).not.toHaveBeenCalled();
  });
});

// ### warmup performs a publish/consume round-trip on an internal topic
// ### warmup is idempotent
// ### warmup throws before connect
// ### warmupOnConnect runs warmup as part of connect
// ### warmup times out when the round-trip never completes
describe("KafkaEventBus warmup", () => {
  it("should create the warmup topic, dispatch, and resolve once the round-trip is observed", async () => {
    const { mockKafka, mockAdmin, mockProducer } = createMockKafkaForWarmup();
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.warmup();

    expect(mockAdmin.createTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        waitForLeaders: true,
        topics: [
          expect.objectContaining({ topic: expect.stringContaining("test") }),
        ],
      }),
    );
    expect(mockProducer.send).toHaveBeenCalled();
  });

  it("should not repeat the round-trip on a second call after success", async () => {
    const { mockKafka, mockAdmin } = createMockKafkaForWarmup();
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();
    await bus.warmup();
    const callsAfterFirst = mockAdmin.createTopics.mock.calls.length;
    await bus.warmup();

    expect(mockAdmin.createTopics.mock.calls.length).toBe(callsAfterFirst);
  });

  it("should throw when warmup is called before connect", async () => {
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
    });

    await expect(bus.warmup()).rejects.toThrow(/not connected/i);
  });

  it("should perform the warmup round-trip during connect when warmupOnConnect is true", async () => {
    const { mockKafka, mockAdmin, mockProducer } = createMockKafkaForWarmup();
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      warmupOnConnect: true,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    expect(mockAdmin.createTopics).toHaveBeenCalled();
    expect(mockProducer.send).toHaveBeenCalled();
  });

  it("should reject with a timeout error when the handler never observes the warmup event", async () => {
    const { mockKafka } = createMockKafkaForWarmup({ neverDeliver: true });
    const bus = new KafkaEventBus({
      brokers: ["localhost:9092"],
      clientId: "test",
      groupId: "test-group",
      warmupTimeoutMs: 50,
    });
    (bus as any)._kafka = mockKafka;

    await bus.connect();

    await expect(bus.warmup()).rejects.toThrow(/timed out/i);
  }, 10_000);

  it("should clear the retry interval once warmup resolves synchronously, instead of dispatching forever", async () => {
    vi.useFakeTimers();
    try {
      const { mockKafka, mockProducer } = createMockKafkaForWarmup();
      const bus = new KafkaEventBus({
        brokers: ["localhost:9092"],
        clientId: "test",
        groupId: "test-group",
      });
      (bus as any)._kafka = mockKafka;

      await bus.connect();
      // The mock delivers the warmup message synchronously from within the
      // first dispatchOnce() call, so finish() runs before the interval/
      // timeout handles would have been assigned under the old (buggy)
      // ordering — this is exactly the race Copilot flagged.
      await bus.warmup();

      const callsAtResolution = mockProducer.send.mock.calls.length;

      // Advance well past several 1s interval ticks. If the interval was
      // never cleared (the bug), send() keeps getting called.
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockProducer.send.mock.calls.length).toBe(callsAtResolution);
    } finally {
      vi.useRealTimers();
    }
  });
});
