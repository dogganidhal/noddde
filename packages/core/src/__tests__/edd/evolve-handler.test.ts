import { describe, it, expect, expectTypeOf } from "vitest";
import type { EvolveHandler, DefineEvents, Event } from "@noddde/core";

describe("EvolveHandler", () => {
  // ### EvolveHandler evolves state from event payload
  describe("type signature", () => {
    type CounterEvent = DefineEvents<{
      Incremented: { amount: number };
    }>;
    type IncrementedEvent = Extract<CounterEvent, { name: "Incremented" }>;
    type CounterState = { count: number };

    type Handler = EvolveHandler<IncrementedEvent, CounterState>;

    it("should accept event payload as first parameter", () => {
      expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{
        amount: number;
      }>();
    });

    it("should accept state as second parameter", () => {
      expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<CounterState>();
    });

    it("should return the same state type", () => {
      expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<CounterState>();
    });
  });

  // ### EvolveHandler is synchronous (no Promise return)
  describe("synchronous constraint", () => {
    type Handler = EvolveHandler<Event, { value: string }>;

    it("should not return a Promise", () => {
      expectTypeOf<ReturnType<Handler>>().not.toMatchTypeOf<Promise<any>>();
    });

    it("should return the state type directly", () => {
      expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<{ value: string }>();
    });
  });

  // ### EvolveHandler works with primitive state
  describe("with primitive state", () => {
    type MyEvent = DefineEvents<{ ValueSet: { value: number } }>;
    type Handler = EvolveHandler<
      Extract<MyEvent, { name: "ValueSet" }>,
      number
    >;

    it("should accept and return a number", () => {
      expectTypeOf<Parameters<Handler>[1]>().toBeNumber();
      expectTypeOf<ReturnType<Handler>>().toBeNumber();
    });
  });

  // ### EvolveHandler runtime behavior
  describe("runtime", () => {
    type CounterEvent = DefineEvents<{ Incremented: { amount: number } }>;

    it("should produce new state from payload and current state", () => {
      const apply: EvolveHandler<
        Extract<CounterEvent, { name: "Incremented" }>,
        { count: number }
      > = (payload, state) => ({
        count: state.count + payload.amount,
      });

      const result = apply({ amount: 5 }, { count: 10 });
      expect(result).toEqual({ count: 15 });
    });
  });
});
