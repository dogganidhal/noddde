import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  EventHandler,
  DefineEvents,
  Infrastructure,
  Event,
} from "@noddde/core";

describe("EventHandler", () => {
  type OrderEvent = DefineEvents<{
    OrderPlaced: { orderId: string; total: number };
  }>;
  type OrderPlacedEvent = Extract<OrderEvent, { name: "OrderPlaced" }>;

  interface MyInfrastructure extends Infrastructure {
    emailService: { send(to: string, body: string): Promise<void> };
  }

  type Handler = EventHandler<OrderPlacedEvent, MyInfrastructure>;

  it("should accept payload as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{
      orderId: string;
      total: number;
    }>();
  });

  it("should accept infrastructure as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyInfrastructure>();
  });

  it("should return void or Promise<void>", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<void | Promise<void>>();
  });
});

describe("EventHandler sync/async", () => {
  it("should allow synchronous handler", () => {
    const handler: EventHandler<Event, Infrastructure> = (_payload, _infra) => {
      // no-op, sync
    };
    expect(handler).toBeDefined();
  });

  it("should allow asynchronous handler", () => {
    const handler: EventHandler<Event, Infrastructure> = async (_payload, _infra) => {
      // no-op, async
    };
    expect(handler).toBeDefined();
  });
});
