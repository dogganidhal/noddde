/* eslint-disable no-unused-vars */
import { describe, it, expectTypeOf } from "vitest";
import type {
  EventBus,
  Event,
  DefineEvents,
  AsyncEventHandler,
  Closeable,
} from "@noddde/core";

// ### EventBus dispatch accepts any Event subtype
describe("EventBus", () => {
  it("should accept a base Event", () => {
    const bus = {} as EventBus;
    expectTypeOf(bus.dispatch).parameter(0).toMatchTypeOf<Event>();
  });

  it("should accept a narrowed event type", () => {
    type OrderEvent = DefineEvents<{ OrderPlaced: { orderId: string } }>;
    const bus = {} as EventBus;
    expectTypeOf(bus.dispatch<OrderEvent>).returns.toEqualTypeOf<
      Promise<void>
    >();
  });

  it("should return Promise<void>", () => {
    const bus = {} as EventBus;
    expectTypeOf(bus.dispatch).returns.toEqualTypeOf<Promise<void>>();
  });
});

// ### EventBus has on method for handler registration
describe("EventBus", () => {
  it("should have an on method that accepts eventName and handler", () => {
    const bus = {} as EventBus;
    expectTypeOf(bus.on).toBeFunction();
    expectTypeOf(bus.on).parameters.toEqualTypeOf<
      [string, AsyncEventHandler]
    >();
    expectTypeOf(bus.on).returns.toEqualTypeOf<void>();
  });
});

// ### EventBus extends Closeable
describe("EventBus", () => {
  it("should extend Closeable and have a close method", () => {
    const bus = {} as EventBus;
    expectTypeOf(bus).toMatchTypeOf<Closeable>();
    expectTypeOf(bus.close).toBeFunction();
    expectTypeOf(bus.close).returns.toEqualTypeOf<Promise<void>>();
  });
});

// ### AsyncEventHandler type matches expected signature
describe("AsyncEventHandler", () => {
  it("should accept an Event and return void or Promise<void>", () => {
    const syncHandler: AsyncEventHandler = (_event: Event) => {};
    const asyncHandler: AsyncEventHandler = async (_event: Event) => {};
    expectTypeOf(syncHandler).toMatchTypeOf<AsyncEventHandler>();
    expectTypeOf(asyncHandler).toMatchTypeOf<AsyncEventHandler>();
  });
});

// ### EventBus can be implemented structurally
describe("EventBus structural implementation", () => {
  it("should allow any object with matching dispatch, on, and close methods", () => {
    const myBus = {
      dispatch: async () => {},
      on: () => {},
      close: async () => {},
    };
    expectTypeOf(myBus).toMatchTypeOf<EventBus>();
  });
});
