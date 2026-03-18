import { describe, it, expectTypeOf } from "vitest";
import type {
  Infrastructure,
  CQRSInfrastructure,
  CommandBus,
  EventBus,
  QueryBus,
} from "@noddde/core";

describe("Infrastructure", () => {
  it("should be assignable from any object", () => {
    expectTypeOf<{ foo: string }>().toMatchTypeOf<Infrastructure>();
  });

  it("should be assignable from empty object", () => {
    expectTypeOf<{}>().toEqualTypeOf<Infrastructure>();
  });

  it("should allow extension via interface", () => {
    interface MyInfra extends Infrastructure {
      clock: { now(): Date };
    }
    expectTypeOf<MyInfra>().toMatchTypeOf<Infrastructure>();
    expectTypeOf<MyInfra["clock"]>().toEqualTypeOf<{ now(): Date }>();
  });
});

describe("CQRSInfrastructure", () => {
  it("should have commandBus", () => {
    expectTypeOf<CQRSInfrastructure["commandBus"]>().toEqualTypeOf<CommandBus>();
  });

  it("should have eventBus", () => {
    expectTypeOf<CQRSInfrastructure["eventBus"]>().toEqualTypeOf<EventBus>();
  });

  it("should have queryBus", () => {
    expectTypeOf<CQRSInfrastructure["queryBus"]>().toEqualTypeOf<QueryBus>();
  });
});

describe("Infrastructure & CQRSInfrastructure intersection", () => {
  interface MyInfra extends Infrastructure {
    db: { query(sql: string): Promise<any[]> };
  }

  type MergedInfra = MyInfra & CQRSInfrastructure;

  it("should include custom infrastructure fields", () => {
    expectTypeOf<MergedInfra["db"]>().toEqualTypeOf<{
      query(sql: string): Promise<any[]>;
    }>();
  });

  it("should include CQRS buses", () => {
    expectTypeOf<MergedInfra["commandBus"]>().toEqualTypeOf<CommandBus>();
  });
});
