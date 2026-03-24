/* eslint-disable no-unused-vars */
import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  Event,
  DefineEvents,
  TypedEventUpcasterChain,
  StepsFromVersions,
  Last,
  UpcasterMap,
} from "@noddde/core";
import {
  upcastEvent,
  upcastEvents,
  currentEventVersion,
  defineEventUpcasterChain,
  defineUpcasters,
} from "@noddde/core";

describe("Upcaster (Event Versioning)", () => {
  describe("upcastEvent with no chain", () => {
    it("should return the event unchanged when no chain exists for its name", () => {
      const event: Event = {
        name: "OrderPlaced",
        payload: { orderId: "123" },
      };
      const result = upcastEvent(event, {});
      expect(result).toBe(event);
    });
  });

  describe("upcastEvent with missing version", () => {
    type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

    it("should treat events without metadata.version as version 1 and apply the chain", () => {
      const upcasters = defineUpcasters<TestEvent>({
        Created: defineEventUpcasterChain<
          [{ id: string }, { id: string; status: string }]
        >((v1) => ({ ...v1, status: "active" })),
      });

      const event: Event = { name: "Created", payload: { id: "1" } };
      const result = upcastEvent(event, upcasters);
      expect(result.payload).toEqual({ id: "1", status: "active" });
    });

    it("should treat events with metadata but no version as version 1", () => {
      const upcasters = defineUpcasters<TestEvent>({
        Created: defineEventUpcasterChain<
          [{ id: string }, { id: string; status: string }]
        >((v1) => ({ ...v1, status: "active" })),
      });

      const event: Event = {
        name: "Created",
        payload: { id: "1" },
        metadata: {
          eventId: "evt-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "corr-1",
          causationId: "cmd-1",
        },
      };
      const result = upcastEvent(event, upcasters);
      expect(result.payload).toEqual({ id: "1", status: "active" });
    });
  });

  describe("upcastEvent multi-step chain", () => {
    type V1 = { id: string };
    type V2 = { id: string; status: string };
    type V3 = { id: string; status: string; createdAt: string };

    type TestEvent = DefineEvents<{ Created: V3 }>;

    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<[V1, V2, V3]>(
        (v1) => ({ ...v1, status: "active" }),
        (v2) => ({ ...v2, createdAt: "2024-01-01" }),
      ),
    });

    it("should apply all steps for a v1 event", () => {
      const event: Event = { name: "Created", payload: { id: "1" } };
      const result = upcastEvent(event, upcasters);
      expect(result.payload).toEqual({
        id: "1",
        status: "active",
        createdAt: "2024-01-01",
      });
    });

    it("should apply only remaining steps for a v2 event", () => {
      const event: Event = {
        name: "Created",
        payload: { id: "1", status: "active" },
        metadata: {
          eventId: "evt-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "corr-1",
          causationId: "cmd-1",
          version: 2,
        },
      };
      const result = upcastEvent(event, upcasters);
      expect(result.payload).toEqual({
        id: "1",
        status: "active",
        createdAt: "2024-01-01",
      });
    });
  });

  describe("upcastEvent at current version", () => {
    type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<
        [{ id: string }, { id: string; status: string }]
      >((v1) => ({ ...v1, status: "active" })),
    });

    it("should return the event unchanged when already at current version", () => {
      const event: Event = {
        name: "Created",
        payload: { id: "1", status: "active" },
        metadata: {
          eventId: "evt-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "corr-1",
          causationId: "cmd-1",
          version: 2,
        },
      };
      const result = upcastEvent(event, upcasters);
      expect(result).toBe(event);
    });
  });

  describe("upcastEvent future version", () => {
    type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<
        [{ id: string }, { id: string; status: string }]
      >((v1) => ({ ...v1, status: "active" })),
    });

    it("should return the event unchanged when version is higher than current", () => {
      const event: Event = {
        name: "Created",
        payload: { id: "1", status: "active", futureField: true },
        metadata: {
          eventId: "evt-1",
          timestamp: "2024-01-01T00:00:00.000Z",
          correlationId: "corr-1",
          causationId: "cmd-1",
          version: 99,
        },
      };
      const result = upcastEvent(event, upcasters);
      expect(result).toBe(event);
    });
  });

  describe("upcastEvent immutability", () => {
    type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

    it("should not mutate the original event or payload", () => {
      const upcasters = defineUpcasters<TestEvent>({
        Created: defineEventUpcasterChain<
          [{ id: string }, { id: string; status: string }]
        >((v1) => ({ ...v1, status: "active" })),
      });

      const originalPayload = { id: "1" };
      const event: Event = { name: "Created", payload: originalPayload };
      const result = upcastEvent(event, upcasters);

      expect(result).not.toBe(event);
      expect(result.payload).not.toBe(originalPayload);
      expect(originalPayload).toEqual({ id: "1" });
      expect(event.payload).toEqual({ id: "1" });
    });
  });

  describe("currentEventVersion", () => {
    type TestEvent = DefineEvents<{
      Created: { id: string; status: string; createdAt: string };
      Updated: { id: string };
    }>;

    const upcasters = defineUpcasters<TestEvent>({
      Created: defineEventUpcasterChain<
        [
          { id: string },
          { id: string; status: string },
          { id: string; status: string; createdAt: string },
        ]
      >(
        (v1) => ({ ...v1, status: "active" }),
        (v2) => ({ ...v2, createdAt: "2024-01-01" }),
      ),
    });

    it("should return chain.length + 1 for events with a chain", () => {
      expect(currentEventVersion("Created", upcasters)).toBe(3);
    });

    it("should return 1 for events without a chain", () => {
      expect(currentEventVersion("Updated", upcasters)).toBe(1);
    });

    it("should return 1 for unknown event names", () => {
      expect(currentEventVersion("NonExistent", upcasters)).toBe(1);
    });
  });

  describe("upcastEvents", () => {
    type TestEvent = DefineEvents<{ Created: { id: string; status: string } }>;

    it("should upcast each event in the array", () => {
      const upcasters = defineUpcasters<TestEvent>({
        Created: defineEventUpcasterChain<
          [{ id: string }, { id: string; status: string }]
        >((v1) => ({ ...v1, status: "active" })),
      });

      const events: Event[] = [
        { name: "Created", payload: { id: "1" } },
        { name: "Created", payload: { id: "2" } },
        { name: "Unknown", payload: {} },
      ];

      const results = upcastEvents(events, upcasters);
      expect(results).toHaveLength(3);
      expect(results[0]!.payload).toEqual({ id: "1", status: "active" });
      expect(results[1]!.payload).toEqual({ id: "2", status: "active" });
      expect(results[2]).toBe(events[2]);
    });
  });

  describe("defineEventUpcasterChain type safety", () => {
    it("should derive step types from version tuple", () => {
      type V1 = { id: string };
      type V2 = { id: string; status: string };
      type Steps = StepsFromVersions<[V1, V2]>;
      expectTypeOf<Steps>().toEqualTypeOf<[(payload: V1) => V2]>();
    });

    it("should derive multi-step types from version tuple", () => {
      type V1 = { id: string };
      type V2 = { id: string; status: string };
      type V3 = { id: string; status: string; createdAt: string };
      type Steps = StepsFromVersions<[V1, V2, V3]>;
      expectTypeOf<Steps>().toEqualTypeOf<
        [(payload: V1) => V2, (payload: V2) => V3]
      >();
    });

    it("should extract last element of tuple", () => {
      expectTypeOf<Last<[string, number, boolean]>>().toEqualTypeOf<boolean>();
      expectTypeOf<Last<[string]>>().toEqualTypeOf<string>();
    });

    it("should produce empty steps for single-element tuple", () => {
      type Steps = StepsFromVersions<[{ id: string }]>;
      expectTypeOf<Steps>().toEqualTypeOf<[]>();
    });

    it("should constrain UpcasterMap keys to valid event names", () => {
      type TestEvent = DefineEvents<{
        Created: { id: string };
        Updated: { name: string };
      }>;
      type Map = UpcasterMap<TestEvent>;
      expectTypeOf<Map>().toHaveProperty("Created");
      expectTypeOf<Map>().toHaveProperty("Updated");
    });

    it("should constrain chain output to match current event payload", () => {
      type TestEvent = DefineEvents<{
        Created: { id: string; status: string };
      }>;
      type Map = UpcasterMap<TestEvent>;

      // Valid: chain output matches current payload
      expectTypeOf<
        TypedEventUpcasterChain<{ id: string; status: string }>
      >().toMatchTypeOf<NonNullable<Map["Created"]>>();
    });
  });

  describe("defineUpcasters", () => {
    type TestEvent = DefineEvents<{
      Created: { id: string };
      Updated: { value: number };
    }>;

    it("should return the same map with correct typing", () => {
      const upcasters = defineUpcasters<TestEvent>({});
      expectTypeOf(upcasters).toMatchTypeOf<UpcasterMap<TestEvent>>();
    });

    it("should accept an empty map", () => {
      const upcasters = defineUpcasters<TestEvent>({});
      expectTypeOf(upcasters).toMatchTypeOf<UpcasterMap<TestEvent>>();
    });
  });
});
