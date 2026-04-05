/* eslint-disable no-unused-vars */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DefineEvents, Event, EventHandler, Ports } from "@noddde/core";

describe("EventHandler", () => {
  type OrderEvent = DefineEvents<{
    OrderPlaced: { orderId: string; total: number };
  }>;
  type OrderPlacedEvent = Extract<OrderEvent, { name: "OrderPlaced" }>;

  interface MyPorts extends Ports {
    emailService: { send(to: string, body: string): Promise<void> };
  }

  type Handler = EventHandler<OrderPlacedEvent, MyPorts>;

  it("should accept the full event as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<OrderPlacedEvent>();
  });

  it("should accept ports as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyPorts>();
  });

  it("should return void or Promise<void>", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<void | Promise<void>>();
  });
});

describe("EventHandler sync/async", () => {
  it("should allow synchronous handler", () => {
    const handler: EventHandler<Event, Ports> = (_event, _ports) => {
      // no-op, sync
    };
    expect(handler).toBeDefined();
  });

  it("should allow asynchronous handler", () => {
    const handler: EventHandler<Event, Ports> = async (_event, _ports) => {
      // no-op, async
    };
    expect(handler).toBeDefined();
  });
});
