import { describe, it, expect, vi } from "vitest";
import { InMemoryQueryBus } from "@noddde/core";
import type { Query } from "@noddde/core";

describe("InMemoryQueryBus", () => {
  it("dispatch routes query to registered handler and returns result", async () => {
    const bus = new InMemoryQueryBus();
    const expectedResult = { id: "acc-1", balance: 500 };

    // @ts-expect-error -- accessing internal registration API
    bus.register("GetAccountById", vi.fn().mockResolvedValue(expectedResult));

    type GetAccountByIdQuery = Query<{ id: string; balance: number }> & {
      name: "GetAccountById";
      payload: { id: string };
    };

    const query: GetAccountByIdQuery = {
      name: "GetAccountById",
      payload: { id: "acc-1" },
    };

    const result = await bus.dispatch(query);

    expect(result).toEqual(expectedResult);
  });

  it("dispatch throws when no handler is registered", async () => {
    const bus = new InMemoryQueryBus();

    await expect(
      bus.dispatch({ name: "UnknownQuery" }),
    ).rejects.toThrow(/no handler/i);
  });

  it("handler receives query payload not the full query object", async () => {
    const bus = new InMemoryQueryBus();
    const handler = vi.fn().mockResolvedValue([]);

    // @ts-expect-error -- accessing internal registration API
    bus.register("ListAccounts", handler);

    await bus.dispatch({
      name: "ListAccounts",
      payload: { limit: 10, offset: 0 },
    });

    expect(handler).toHaveBeenCalledWith({ limit: 10, offset: 0 });
  });

  it("handler returning null is forwarded as-is", async () => {
    const bus = new InMemoryQueryBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("FindAccount", vi.fn().mockResolvedValue(null));

    const result = await bus.dispatch({
      name: "FindAccount",
      payload: { id: "nonexistent" },
    });

    expect(result).toBeNull();
  });

  it("dispatch propagates handler errors", async () => {
    const bus = new InMemoryQueryBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("BrokenQuery", () => {
      throw new Error("Database connection failed");
    });

    await expect(
      bus.dispatch({ name: "BrokenQuery" }),
    ).rejects.toThrow("Database connection failed");
  });

  it("query with no payload passes undefined to handler", async () => {
    const bus = new InMemoryQueryBus();
    const handler = vi.fn().mockResolvedValue({ total: 42 });

    // @ts-expect-error -- accessing internal registration API
    bus.register("GetTotalCount", handler);

    await bus.dispatch({ name: "GetTotalCount" });

    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it("duplicate handler registration throws", () => {
    const bus = new InMemoryQueryBus();

    // @ts-expect-error -- accessing internal registration API
    bus.register("GetAccountById", vi.fn());

    expect(() => {
      // @ts-expect-error -- accessing internal registration API
      bus.register("GetAccountById", vi.fn());
    }).toThrow(/already registered/i);
  });
});
