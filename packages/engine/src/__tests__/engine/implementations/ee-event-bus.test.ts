import { describe, it, expect, vi } from "vitest";
import { EventEmitterEventBus } from "@noddde/engine";

describe("EventEmitterEventBus", () => {
  it("dispatch emits event payload on the correct channel", async () => {
    const bus = new EventEmitterEventBus();
    const listener = vi.fn();

    bus.on("AccountCreated", listener);

    const event = {
      name: "AccountCreated" as const,
      payload: { id: "acc-1", owner: "Alice" },
    };

    await bus.dispatch(event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ id: "acc-1", owner: "Alice" });
  });

  it("dispatch resolves when no listeners are registered", async () => {
    const bus = new EventEmitterEventBus();

    await expect(
      bus.dispatch({ name: "UnhandledEvent", payload: {} }),
    ).resolves.toBeUndefined();
  });

  it("multiple listeners all receive the payload", async () => {
    const bus = new EventEmitterEventBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.on("DepositMade", listener1);
    bus.on("DepositMade", listener2);

    await bus.dispatch({
      name: "DepositMade",
      payload: { amount: 100 },
    });

    expect(listener1).toHaveBeenCalledWith({ amount: 100 });
    expect(listener2).toHaveBeenCalledWith({ amount: 100 });
  });

  it("dispatching the same event twice emits twice", async () => {
    const bus = new EventEmitterEventBus();
    const listener = vi.fn();

    bus.on("ItemAdded", listener);

    const event = { name: "ItemAdded", payload: { itemId: "x" } };

    await bus.dispatch(event);
    await bus.dispatch(event);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("events on different channels do not interfere", async () => {
    const bus = new EventEmitterEventBus();
    const accountListener = vi.fn();
    const orderListener = vi.fn();

    bus.on("AccountCreated", accountListener);
    bus.on("OrderPlaced", orderListener);

    await bus.dispatch({
      name: "AccountCreated",
      payload: { id: "acc-1" },
    });

    expect(accountListener).toHaveBeenCalledOnce();
    expect(orderListener).not.toHaveBeenCalled();
  });
});
