import { describe, it, expect, vi } from "vitest";
import { InMemoryCommandBus } from "@noddde/core";

describe("InMemoryCommandBus", () => {
  it("dispatch routes command to registered handler", async () => {
    const bus = new InMemoryCommandBus();
    const handler = vi.fn().mockResolvedValue(undefined);

    bus.register("CreateAccount", handler);

    const command = {
      name: "CreateAccount",
      targetAggregateId: "acc-1",
      payload: { owner: "Alice" },
    };

    await bus.dispatch(command);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(command);
  });

  it("dispatch throws when no handler is registered", async () => {
    const bus = new InMemoryCommandBus();

    await expect(
      bus.dispatch({ name: "UnknownCommand" }),
    ).rejects.toThrow(/no handler/i);
  });

  it("dispatch propagates handler errors", async () => {
    const bus = new InMemoryCommandBus();

    bus.register("FailingCommand", () => {
      throw new Error("Handler failed");
    });

    await expect(
      bus.dispatch({ name: "FailingCommand" }),
    ).rejects.toThrow("Handler failed");
  });

  it("dispatch propagates async handler rejections", async () => {
    const bus = new InMemoryCommandBus();

    bus.register("AsyncFail", async () => {
      throw new Error("Async handler failed");
    });

    await expect(
      bus.dispatch({ name: "AsyncFail" }),
    ).rejects.toThrow("Async handler failed");
  });

  it("dispatch handles commands with no payload", async () => {
    const bus = new InMemoryCommandBus();
    const handler = vi.fn().mockResolvedValue(undefined);

    bus.register("ResetAccount", handler);

    const command = { name: "ResetAccount", targetAggregateId: "acc-1" };
    await bus.dispatch(command);

    expect(handler).toHaveBeenCalledWith(command);
  });

  it("duplicate handler registration throws", () => {
    const bus = new InMemoryCommandBus();

    bus.register("CreateAccount", vi.fn());

    expect(() => {
      bus.register("CreateAccount", vi.fn());
    }).toThrow(/already registered/i);
  });
});
