import { describe, it, expectTypeOf } from "vitest";
import type { EventBus, Event, DefineEvents } from "@noddde/core";

describe("EventBus", () => {
  // ### EventBus dispatch accepts any Event subtype
  it("should accept a base Event", () => {
    const bus: EventBus = {
      dispatch: async (_event: Event) => {},
    };
    expectTypeOf(bus.dispatch).parameter(0).toMatchTypeOf<Event>();
  });

  it("should accept a narrowed event type", () => {
    type OrderEvent = DefineEvents<{ OrderPlaced: { orderId: string } }>;
    const bus: EventBus = { dispatch: async () => {} };
    const event: OrderEvent = {
      name: "OrderPlaced",
      payload: { orderId: "1" },
    };
    expectTypeOf(bus.dispatch(event)).toEqualTypeOf<Promise<void>>();
  });

  it("should return Promise<void>", () => {
    const bus: EventBus = { dispatch: async () => {} };
    const result = bus.dispatch({ name: "test", payload: {} });
    expectTypeOf(result).toEqualTypeOf<Promise<void>>();
  });

  // ### EventBus can be implemented structurally
  it("should allow any object with a matching dispatch method", () => {
    const myBus = {
      dispatch: async () => {},
    };
    expectTypeOf(myBus).toMatchTypeOf<EventBus>();
  });
});
