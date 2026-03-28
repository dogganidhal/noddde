import { describe, it, expect, vi } from "vitest";
import {
  wireDomain,
  defineDomain,
  DomainShutdownError,
  InMemoryOutboxStore,
} from "@noddde/engine";
import { defineAggregate } from "@noddde/core";
import type { Closeable } from "@noddde/core";

describe("Domain.shutdown", () => {
  it("should reject commands after shutdown", async () => {
    const Agg = defineAggregate({
      name: "Acc",
      initialState: { balance: 0 },
      commands: {
        Deposit: (cmd) => ({
          name: "Deposited" as const,
          payload: { amount: cmd.payload.amount },
        }),
      },
      apply: {
        Deposited: (payload, state) => ({
          ...state,
          balance: state.balance + payload.amount,
        }),
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { Acc: Agg } },
        readModel: { projections: {} },
      }),
    );

    await domain.shutdown();

    await expect(
      domain.dispatchCommand({
        name: "Deposit",
        payload: { amount: 100 },
        targetAggregateId: "a1",
      }),
    ).rejects.toThrow(DomainShutdownError);
  });

  it("should reject queries after shutdown", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    await domain.shutdown();

    await expect(
      domain.dispatchQuery({ name: "GetBalance", payload: { id: "a1" } }),
    ).rejects.toThrow(DomainShutdownError);
  });

  it("should wait for in-flight commands before resolving", async () => {
    let unblock!: () => void;
    const blockPromise = new Promise<void>((r) => {
      unblock = r;
    });
    let commandHandlerEntered = false;

    const Agg = defineAggregate({
      name: "SlowAgg",
      initialState: {},
      commands: {
        SlowCmd: async () => {
          commandHandlerEntered = true;
          await blockPromise;
          return { name: "Done" as const, payload: {} };
        },
      },
      apply: {
        Done: (_payload, state) => state,
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { SlowAgg: Agg } },
        readModel: { projections: {} },
      }),
    );

    // Start command but don't await
    const commandPromise = domain.dispatchCommand({
      name: "SlowCmd",
      payload: {},
      targetAggregateId: "a1",
    });

    // Wait for handler to enter
    await vi.waitFor(() => expect(commandHandlerEntered).toBe(true));

    // Start shutdown — should not resolve yet
    let shutdownResolved = false;
    const shutdownPromise = domain.shutdown().then(() => {
      shutdownResolved = true;
    });

    // Give microtasks a chance
    await new Promise((r) => setTimeout(r, 50));
    expect(shutdownResolved).toBe(false);

    // Unblock the command
    unblock();
    await commandPromise;
    await shutdownPromise;

    expect(shutdownResolved).toBe(true);
  });

  it("should return the same promise when called twice", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    const p1 = domain.shutdown();
    const p2 = domain.shutdown();

    expect(p1).toBe(p2);

    await p1;
    await p2;
  });

  it("should call close() on infrastructure implementing Closeable", async () => {
    const closeFn = vi.fn(async () => {});

    interface MyInfra {
      db: { query: () => void } & Closeable;
    }

    const domain = await wireDomain<MyInfra>(
      defineDomain<MyInfra>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({
          db: { query: () => {}, close: closeFn },
        }),
      },
    );

    await domain.shutdown();

    expect(closeFn).toHaveBeenCalledOnce();
  });

  it("should close infrastructure in reverse order", async () => {
    const order: string[] = [];

    interface MyInfra {
      first: { close: () => Promise<void> };
      second: { close: () => Promise<void> };
    }

    const domain = await wireDomain<MyInfra>(
      defineDomain<MyInfra>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({
          first: {
            close: async () => {
              order.push("first");
            },
          },
          second: {
            close: async () => {
              order.push("second");
            },
          },
        }),
      },
    );

    await domain.shutdown();

    expect(order).toEqual(["second", "first"]);
  });

  it("should proceed after timeout even if operations are still running", async () => {
    const Agg = defineAggregate({
      name: "NeverAgg",
      initialState: {},
      commands: {
        NeverCmd: async () => {
          await new Promise(() => {}); // never resolves
          return { name: "Done" as const, payload: {} };
        },
      },
      apply: { Done: (_p, s) => s },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { NeverAgg: Agg } },
        readModel: { projections: {} },
      }),
    );

    // Start a command that will never complete
    void domain.dispatchCommand({
      name: "NeverCmd",
      payload: {},
      targetAggregateId: "a1",
    });

    // Shutdown with very short timeout should resolve
    const start = Date.now();
    await domain.shutdown({ timeoutMs: 100 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("should continue closing remaining infrastructure if one close() throws", async () => {
    const order: string[] = [];

    interface MyInfra {
      failing: { close: () => Promise<void> };
      healthy: { close: () => Promise<void> };
    }

    const domain = await wireDomain<MyInfra>(
      defineDomain<MyInfra>({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
      {
        infrastructure: () => ({
          failing: {
            close: async () => {
              order.push("failing");
              throw new Error("close failed");
            },
          },
          healthy: {
            close: async () => {
              order.push("healthy");
            },
          },
        }),
      },
    );

    // Should not throw
    await domain.shutdown();

    // Both should have been attempted
    expect(order).toContain("failing");
    expect(order).toContain("healthy");
  });

  it("should allow in-flight commands to complete successfully", async () => {
    let unblock!: () => void;
    const blockPromise = new Promise<void>((r) => {
      unblock = r;
    });
    let handlerEntered = false;

    const Agg = defineAggregate({
      name: "CmdAgg",
      initialState: { done: false },
      commands: {
        DoWork: async () => {
          handlerEntered = true;
          await blockPromise;
          return { name: "WorkDone" as const, payload: {} };
        },
      },
      apply: {
        WorkDone: () => ({ done: true }),
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { CmdAgg: Agg } },
        readModel: { projections: {} },
      }),
    );

    const cmdPromise = domain.dispatchCommand({
      name: "DoWork",
      payload: {},
      targetAggregateId: "a1",
    });

    await vi.waitFor(() => expect(handlerEntered).toBe(true));

    // Start shutdown while command is in-flight
    const shutdownPromise = domain.shutdown();

    // Unblock
    unblock();

    // Command should succeed
    const result = await cmdPromise;
    expect(result).toBe("a1");

    await shutdownPromise;
  });

  it("should reject withUnitOfWork calls after shutdown", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    await domain.shutdown();

    await expect(domain.withUnitOfWork(async () => {})).rejects.toThrow(
      DomainShutdownError,
    );
  });

  it("should resolve immediately when no operations are in-flight", async () => {
    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: {} },
        readModel: { projections: {} },
      }),
    );

    const start = Date.now();
    await domain.shutdown();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

describe("DomainShutdownError", () => {
  it("should have the correct name and message", () => {
    const error = new DomainShutdownError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DomainShutdownError");
    expect(error.message).toContain("shutting down");
  });
});

describe("Domain.shutdown outbox relay", () => {
  it("should drain the outbox relay during shutdown", async () => {
    const outboxStore = new InMemoryOutboxStore();

    const Agg = defineAggregate({
      name: "Acc",
      initialState: { balance: 0 },
      commands: {
        Deposit: (cmd) => ({
          name: "Deposited" as const,
          payload: { amount: cmd.payload.amount },
        }),
      },
      apply: {
        Deposited: (payload, state) => ({
          ...state,
          balance: state.balance + payload.amount,
        }),
      },
    });

    const domain = await wireDomain(
      defineDomain({
        writeModel: { aggregates: { Acc: Agg } },
        readModel: { projections: {} },
      }),
      { outbox: { store: () => outboxStore } },
    );

    // Dispatch a command to produce events in the outbox
    await domain.dispatchCommand({
      name: "Deposit",
      payload: { amount: 100 },
      targetAggregateId: "a1",
    });

    // Manually add an unpublished entry to simulate relay backlog
    await outboxStore.save([
      {
        id: "relay-test",
        event: { name: "Deposited", payload: { amount: 50 } },
        createdAt: new Date().toISOString(),
        publishedAt: null,
      },
    ]);

    // Shutdown should drain remaining entries
    await domain.shutdown();

    const remaining = await outboxStore.loadUnpublished();
    expect(remaining).toHaveLength(0);
  });
});
