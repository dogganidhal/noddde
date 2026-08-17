import { describe, it, expect, expectTypeOf } from "vitest";
import type { IdempotencyRecord, IdempotencyStore, ID } from "@noddde/core";
import { IdempotencyConflictError } from "@noddde/core";

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
      expectTypeOf<ReturnType<IdempotencyStore["exists"]>>().toEqualTypeOf<
        Promise<boolean>
      >();
    });

    it("should have save returning Promise<void>", () => {
      expectTypeOf<IdempotencyStore["save"]>().toBeFunction();
      expectTypeOf<ReturnType<IdempotencyStore["save"]>>().toEqualTypeOf<
        Promise<void>
      >();
    });

    it("should have remove returning Promise<void>", () => {
      expectTypeOf<IdempotencyStore["remove"]>().toBeFunction();
      expectTypeOf<ReturnType<IdempotencyStore["remove"]>>().toEqualTypeOf<
        Promise<void>
      >();
    });

    it("should have removeExpired returning Promise<void>", () => {
      expectTypeOf<IdempotencyStore["removeExpired"]>().toBeFunction();
      expectTypeOf<
        ReturnType<IdempotencyStore["removeExpired"]>
      >().toEqualTypeOf<Promise<void>>();
    });
  });

  describe("IdempotencyConflictError", () => {
    it("should have correct name, message, and commandId property", () => {
      const error = new IdempotencyConflictError("cmd-1");
      expect(error.name).toBe("IdempotencyConflictError");
      expect(error.commandId).toBe("cmd-1");
      expect(error.message).toContain("cmd-1");
    });

    it("should be an instance of Error", () => {
      const error = new IdempotencyConflictError("cmd-1");
      expect(error).toBeInstanceOf(Error);
    });
  });
});
