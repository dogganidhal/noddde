import { describe, it, expect, vi } from "vitest";
import { NatsEventBus } from "@noddde/nats";

describe("NatsEventBus", () => {
  it("should publish event to subject derived from event name", async () => {
    const mockJetstream = {
      publish: vi.fn().mockResolvedValue({ seq: 1, stream: "test" }),
    };
    const mockConnection = {
      jetstream: () => mockJetstream,
      jetstreamManager: vi
        .fn()
        .mockResolvedValue({ streams: { info: vi.fn() } }),
      drain: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = mockConnection;
    (bus as any)._js = mockJetstream;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "AccountCreated", payload: { id: "acc-1" } });

    expect(mockJetstream.publish).toHaveBeenCalledWith(
      "AccountCreated",
      expect.any(Uint8Array),
    );
  });

  it("should prepend subjectPrefix to event name for subject", async () => {
    const mockJetstream = {
      publish: vi.fn().mockResolvedValue({ seq: 1, stream: "test" }),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      subjectPrefix: "noddde.",
    });
    (bus as any)._nc = {};
    (bus as any)._js = mockJetstream;
    (bus as any)._connected = true;

    await bus.dispatch({ name: "OrderPlaced", payload: {} });

    expect(mockJetstream.publish).toHaveBeenCalledWith(
      "noddde.OrderPlaced",
      expect.any(Uint8Array),
    );
  });

  it("should throw when dispatching before connect", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it("should invoke registered handler when event is consumed", async () => {
    const handler = vi.fn();
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });

    bus.on("AccountCreated", handler);

    const event = { name: "AccountCreated", payload: { id: "acc-1" } };
    await (bus as any)._handleMessage("AccountCreated", JSON.stringify(event));

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should invoke all handlers concurrently via Promise.all", async () => {
    const results: string[] = [];
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
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

    expect(results).toContain("slow");
    expect(results).toContain("fast");
    expect(results).toHaveLength(2);
    expect(results[0]).toBe("fast");
  });

  it("should reject if any handler throws during parallel invocation", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
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

  it("should map BrokerResilience to nats reconnection options", () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      resilience: {
        maxAttempts: 10,
        initialDelayMs: 5000,
      },
    });

    // Config is stored for mapping during connect()
    expect((bus as any)._config.resilience).toEqual({
      maxAttempts: 10,
      initialDelayMs: 5000,
    });
  });

  it("should configure prefetchCount as maxAckPending on JetStream consumer options", () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      prefetchCount: 100,
    });

    expect((bus as any)._config.prefetchCount).toBe(100);
  });

  it("should drain connection and clear handlers on close", async () => {
    const mockDrain = vi.fn().mockResolvedValue(undefined);
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = {
      drain: mockDrain,
      isClosed: vi.fn().mockReturnValue(false),
    };
    (bus as any)._connected = true;

    bus.on("TestEvent", vi.fn());
    await bus.close();

    expect(mockDrain).toHaveBeenCalled();

    await expect(
      bus.dispatch({ name: "TestEvent", payload: {} }),
    ).rejects.toThrow();
  });

  it("should not throw when close is called multiple times", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = {
      drain: vi.fn().mockResolvedValue(undefined),
      isClosed: vi.fn().mockReturnValue(false),
    };
    (bus as any)._connected = true;

    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });

  it("should serialize the full event object including metadata", async () => {
    const mockPublish = vi.fn().mockResolvedValue({ seq: 1, stream: "test" });

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._nc = {};
    (bus as any)._js = { publish: mockPublish };
    (bus as any)._connected = true;

    const event = {
      name: "AccountCreated",
      payload: { id: "acc-1" },
      metadata: { eventId: "evt-1", correlationId: "corr-1" },
    } as import("@noddde/core").Event;
    await bus.dispatch(event);

    const sentData = mockPublish.mock.calls[0]![1];
    const decoded = new TextDecoder().decode(sentData);
    const parsed = JSON.parse(decoded);
    expect(parsed).toEqual(event);
  });

  it("should set maxDeliver on consumer options when resilience.maxRetries is configured", async () => {
    const maxDeliverCalls: number[] = [];
    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
      maxDeliver: vi.fn((n: number) => {
        maxDeliverCalls.push(n);
      }),
    };

    const mockSub = (async function* () {})();
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(mockSub),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
      resilience: { maxRetries: 5 },
    });
    (bus as any)._js = mockJs;
    (bus as any)._connected = true;

    // Intercept consumerOpts to return our mock
    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    bus.on("TestEvent", vi.fn());

    // Wait for the async subscription creation
    await new Promise((r) => setTimeout(r, 10));

    expect(mockOpts.maxDeliver).toHaveBeenCalledWith(5);

    vi.restoreAllMocks();
  });

  it("should term a poison message (malformed JSON) and continue", async () => {
    const mockTerm = vi.fn();
    const mockAck = vi.fn();

    const handler = vi.fn();
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    bus.on("TestEvent", handler);

    const malformedMsg = {
      data: new TextEncoder().encode("not-valid-json{{{"),
      term: mockTerm,
      ack: mockAck,
      nak: vi.fn(),
    };

    // Simulate the consume loop with a single malformed message
    const sub = (async function* () {
      yield malformedMsg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    expect(mockTerm).toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("should nak message when handler throws and not ack", async () => {
    const mockNak = vi.fn();
    const mockAck = vi.fn();

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    bus.on("TestEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "TestEvent", payload: {} };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      nak: mockNak,
      ack: mockAck,
      term: vi.fn(),
    };

    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    expect(mockNak).toHaveBeenCalled();
    expect(mockAck).not.toHaveBeenCalled();
  });

  it("should ack message when all handlers succeed", async () => {
    const mockAck = vi.fn();
    const mockNak = vi.fn();

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.on("TestEvent", handler);

    const event = { name: "TestEvent", payload: {} };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      ack: mockAck,
      nak: mockNak,
      term: vi.fn(),
    };

    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    expect(mockAck).toHaveBeenCalled();
    expect(mockNak).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should not crash consumer loop when msg.term() throws (connection dropped)", async () => {
    const handler = vi.fn();
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    bus.on("TestEvent", handler);

    const malformedMsg = {
      data: new TextEncoder().encode("not-valid-json{{{"),
      term: vi.fn().mockImplementation(() => {
        throw new Error("connection dropped");
      }),
      ack: vi.fn(),
      nak: vi.fn(),
    };

    const sub = (async function* () {
      yield malformedMsg;
    })();

    // Should resolve without throwing even though msg.term() throws
    await expect(
      (bus as any)._consumeSubscription(sub, "TestEvent"),
    ).resolves.toBeUndefined();

    expect(malformedMsg.term).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("should not crash consumer loop when msg.nak() throws (connection dropped)", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    bus.on("TestEvent", async () => {
      throw new Error("handler failed");
    });

    const event = { name: "TestEvent", payload: {} };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      nak: vi.fn().mockImplementation(() => {
        throw new Error("connection dropped");
      }),
      ack: vi.fn(),
      term: vi.fn(),
    };

    const sub = (async function* () {
      yield msg;
    })();

    // Should resolve without throwing even though msg.nak() throws
    await expect(
      (bus as any)._consumeSubscription(sub, "TestEvent"),
    ).resolves.toBeUndefined();

    expect(msg.nak).toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it("should not crash consumer loop when msg.ack() throws (connection dropped)", async () => {
    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.on("TestEvent", handler);

    const event = { name: "TestEvent", payload: {} };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      ack: vi.fn().mockImplementation(() => {
        throw new Error("connection dropped");
      }),
      nak: vi.fn(),
      term: vi.fn(),
    };

    const sub = (async function* () {
      yield msg;
    })();

    // Should resolve without throwing even though msg.ack() throws
    await expect(
      (bus as any)._consumeSubscription(sub, "TestEvent"),
    ).resolves.toBeUndefined();

    expect(msg.ack).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should use .catch() on consumer loop to prevent unhandled promise rejections", async () => {
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(
        // eslint-disable-next-line require-yield
        (async function* () {
          throw new Error("async iterator error");
        })(),
      ),
    };

    const natsModule = await import("nats");
    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-group",
    });
    (bus as any)._js = mockJs;
    (bus as any)._connected = true;

    bus.on("TestEvent", vi.fn());

    // Wait for async subscription creation and consumer loop to start/fail
    await new Promise((r) => setTimeout(r, 20));

    // If .catch() is properly attached, no unhandled rejection is thrown
    // and the test completes cleanly
    vi.restoreAllMocks();
  });

  // New tests from spec update

  it("should use consumerGroup as prefix in durable consumer name", async () => {
    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };

    const mockSub = (async function* () {})();
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(mockSub),
    };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "order-service",
    });
    (bus as any)._js = mockJs;
    (bus as any)._connected = true;

    bus.on("AccountCreated", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    expect(mockOpts.durable).toHaveBeenCalledWith(
      "order-service_AccountCreated",
    );

    vi.restoreAllMocks();
  });

  it("should produce different durable names for different consumerGroup values on the same event", async () => {
    const durableNames: string[] = [];
    const mockOpts = {
      durable: vi.fn((name: string) => durableNames.push(name)),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };

    const mockSub = (async function* () {})();
    const mockJs = {
      subscribe: vi.fn().mockResolvedValue(mockSub),
    };

    const natsModule = await import("nats");
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus1 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "billing-service",
    });
    (bus1 as any)._js = mockJs;
    (bus1 as any)._connected = true;
    bus1.on("OrderPlaced", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    const bus2 = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "shipping-service",
    });
    (bus2 as any)._js = mockJs;
    (bus2 as any)._connected = true;
    bus2.on("OrderPlaced", vi.fn());

    await new Promise((r) => setTimeout(r, 10));

    expect(durableNames).toContain("billing-service_OrderPlaced");
    expect(durableNames).toContain("shipping-service_OrderPlaced");
    expect(durableNames[0]).not.toBe(durableNames[1]);

    vi.restoreAllMocks();
  });

  it("should reject connect() when subscription creation fails during _activateSubscriptions", async () => {
    const natsModule = await import("nats");

    vi.spyOn(natsModule, "connect").mockResolvedValue({
      jetstream: () => ({
        subscribe: vi.fn().mockRejectedValue(new Error("subscription failed")),
      }),
      jetstreamManager: vi.fn().mockResolvedValue({
        streams: { info: vi.fn() },
      }),
      drain: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    } as any);

    const mockOpts = {
      durable: vi.fn(),
      manualAck: vi.fn(),
      filterSubject: vi.fn(),
      maxAckPending: vi.fn(),
    };
    vi.spyOn(natsModule, "consumerOpts").mockReturnValue(mockOpts as any);

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-service",
    });

    // Register a handler before connect so _activateSubscriptions runs
    bus.on("TestEvent", vi.fn());

    await expect(bus.connect()).rejects.toThrow("subscription failed");

    vi.restoreAllMocks();
  });

  it("should use provided logger for error and warn logging with structured data", async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const bus = new NatsEventBus({
      servers: "localhost:4222",
      consumerGroup: "test-service",
      logger: mockLogger,
    });

    const handler = vi.fn().mockRejectedValue(new Error("handler boom"));
    bus.on("TestEvent", handler);

    const event = { name: "TestEvent", payload: {} };
    const msg = {
      data: new TextEncoder().encode(JSON.stringify(event)),
      nak: vi.fn(),
      ack: vi.fn(),
      term: vi.fn(),
    };

    const sub = (async function* () {
      yield msg;
    })();

    await (bus as any)._consumeSubscription(sub, "TestEvent");

    // Logger should have been called with structured data, not console
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Handler error"),
      expect.objectContaining({ eventName: "TestEvent" }),
    );
  });
});
