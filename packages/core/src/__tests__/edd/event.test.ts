import { describe, it, expectTypeOf } from "vitest";
import type { Event, DefineEvents, EventMetadata } from "@noddde/core";

describe("Event & DefineEvents", () => {
  // ### Event interface accepts any conforming object
  describe("Event", () => {
    it("should accept an object with name and payload", () => {
      const event: Event = { name: "OrderPlaced", payload: { orderId: "123" } };
      expectTypeOf(event.name).toBeString();
      expectTypeOf(event.payload).toBeAny();
    });

    it("should accept any string as name", () => {
      const event: Event = { name: "anything", payload: null };
      expectTypeOf(event).toMatchTypeOf<Event>();
    });
  });

  // ### DefineEvents produces a discriminated union
  describe("DefineEvents", () => {
    type AccountEvent = DefineEvents<{
      AccountCreated: { id: string; owner: string };
      DepositMade: { amount: number };
    }>;

    it("should produce a union of two event types", () => {
      expectTypeOf<AccountEvent>().toMatchTypeOf<
        | { name: "AccountCreated"; payload: { id: string; owner: string } }
        | { name: "DepositMade"; payload: { amount: number } }
      >();
    });

    it("should allow narrowing by name", () => {
      const handle = (event: AccountEvent) => {
        if (event.name === "AccountCreated") {
          expectTypeOf(event).toMatchTypeOf<{
            name: "AccountCreated";
            payload: { id: string; owner: string };
          }>();
        }
      };
      expectTypeOf(handle).toBeFunction();
    });

    it("should be assignable to Event", () => {
      expectTypeOf<AccountEvent>().toMatchTypeOf<Event>();
    });
  });

  // ### DefineEvents with single event produces a non-union type
  describe("DefineEvents with single key", () => {
    type SingleEvent = DefineEvents<{ OrderPlaced: { orderId: string } }>;

    it("should produce a single object type", () => {
      expectTypeOf<SingleEvent>().toEqualTypeOf<{
        name: "OrderPlaced";
        payload: { orderId: string };
      }>();
    });
  });

  // ### DefineEvents with empty record produces never
  describe("DefineEvents with empty record", () => {
    type NoEvents = DefineEvents<{}>;

    it("should produce never", () => {
      expectTypeOf<NoEvents>().toBeNever();
    });
  });

  // ### Event accepts optional metadata
  describe("Event metadata", () => {
    it("should accept an event without metadata", () => {
      const event: Event = { name: "OrderPlaced", payload: { orderId: "123" } };
      expectTypeOf(event).toMatchTypeOf<Event>();
    });

    it("should accept an event with metadata", () => {
      const event: Event = {
        name: "OrderPlaced",
        payload: { orderId: "123" },
        metadata: {
          eventId: "0190a6e0-0000-7000-8000-000000000001",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "corr-1",
          causationId: "cmd-1",
        },
      };
      expectTypeOf(event).toMatchTypeOf<Event>();
    });

    it("should have metadata typed as EventMetadata or undefined", () => {
      expectTypeOf<Event["metadata"]>().toEqualTypeOf<
        EventMetadata | undefined
      >();
    });
  });

  // ### DefineEvents output is assignable to Event with metadata
  describe("DefineEvents assignability with metadata", () => {
    type MyEvent = DefineEvents<{ Created: { id: string } }>;

    it("should be assignable to Event (metadata is optional)", () => {
      expectTypeOf<MyEvent>().toMatchTypeOf<Event>();
    });
  });
});
