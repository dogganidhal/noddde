/* eslint-disable no-unused-vars */
import { describe, expectTypeOf, it } from "vitest";
import type {
  CommandBus,
  CQRSPorts,
  EventBus,
  Ports,
  QueryBus,
} from "@noddde/core";

describe("Ports", () => {
  it("should be assignable from any object", () => {
    expectTypeOf<{ foo: string }>().toMatchTypeOf<Ports>();
  });

  it("should be assignable from empty object", () => {
    expectTypeOf<{}>().toEqualTypeOf<Ports>();
  });

  it("should allow extension via interface", () => {
    interface MyPorts extends Ports {
      clock: { now(): Date };
    }
    expectTypeOf<MyPorts>().toMatchTypeOf<Ports>();
    expectTypeOf<MyPorts["clock"]>().toEqualTypeOf<{ now(): Date }>();
  });
});

describe("CQRSPorts", () => {
  it("should have commandBus", () => {
    expectTypeOf<CQRSPorts["commandBus"]>().toEqualTypeOf<CommandBus>();
  });

  it("should have eventBus", () => {
    expectTypeOf<CQRSPorts["eventBus"]>().toEqualTypeOf<EventBus>();
  });

  it("should have queryBus", () => {
    expectTypeOf<CQRSPorts["queryBus"]>().toEqualTypeOf<QueryBus>();
  });
});

describe("Ports & CQRSPorts intersection", () => {
  interface MyPorts extends Ports {
    db: { query(sql: string): Promise<any[]> };
  }

  type MergedPorts = MyPorts & CQRSPorts;

  it("should include custom ports fields", () => {
    expectTypeOf<MergedPorts["db"]>().toEqualTypeOf<{
      query(sql: string): Promise<any[]>;
    }>();
  });

  it("should include CQRS buses", () => {
    expectTypeOf<MergedPorts["commandBus"]>().toEqualTypeOf<CommandBus>();
  });
});
