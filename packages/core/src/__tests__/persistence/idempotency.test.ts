import { describe, it, expectTypeOf } from "vitest";
import type { IdempotencyRecord, IdempotencyStore, ID } from "@noddde/core";

describe("IdempotencyRecord & IdempotencyStore", () => {
  // ### IdempotencyRecord and IdempotencyStore type shapes
  describe("IdempotencyRecord", () => {
    it("should have commandId of type ID", () => {
      expectTypeOf<IdempotencyRecord["commandId"]>().toEqualTypeOf<ID>();
    });

    it("should have aggregateName of type string", () => {
      expectTypeOf<IdempotencyRecord["aggregateName"]>().toBeString();
    });

    it("should have aggregateId of type ID", () => {
      expectTypeOf<IdempotencyRecord["aggregateId"]>().toEqualTypeOf<ID>();
    });

    it("should have processedAt of type string", () => {
      expectTypeOf<IdempotencyRecord["processedAt"]>().toBeString();
    });
  });

  describe("IdempotencyStore", () => {
    it("should have exists returning Promise<boolean>", () => {
      expectTypeOf<IdempotencyStore["exists"]>().toBeFunction();
      expectTypeOf<
        ReturnType<IdempotencyStore["exists"]>
      >().toEqualTypeOf<Promise<boolean>>();
    });

    it("should have save returning Promise<void>", () => {
      expectTypeOf<IdempotencyStore["save"]>().toBeFunction();
      expectTypeOf<
        ReturnType<IdempotencyStore["save"]>
      >().toEqualTypeOf<Promise<void>>();
    });

    it("should have remove returning Promise<void>", () => {
      expectTypeOf<IdempotencyStore["remove"]>().toBeFunction();
      expectTypeOf<
        ReturnType<IdempotencyStore["remove"]>
      >().toEqualTypeOf<Promise<void>>();
    });

    it("should have removeExpired returning Promise<void>", () => {
      expectTypeOf<IdempotencyStore["removeExpired"]>().toBeFunction();
      expectTypeOf<
        ReturnType<IdempotencyStore["removeExpired"]>
      >().toEqualTypeOf<Promise<void>>();
    });
  });
});
