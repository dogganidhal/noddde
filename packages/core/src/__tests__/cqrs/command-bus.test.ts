import { describe, it, expectTypeOf } from "vitest";
import type { CommandBus, Command, AggregateCommand } from "@noddde/core";

describe("CommandBus", () => {
  // ### CommandBus dispatch accepts any Command
  it("should accept a base Command", () => {
    const bus: CommandBus = { dispatch: async () => {} };
    const cmd: Command = { name: "DoSomething" };
    expectTypeOf(bus.dispatch(cmd)).toEqualTypeOf<Promise<void>>();
  });

  it("should accept an AggregateCommand", () => {
    const bus: CommandBus = { dispatch: async () => {} };
    const cmd: AggregateCommand = {
      name: "CreateAccount",
      targetAggregateId: "123",
    };
    expectTypeOf(bus.dispatch(cmd)).toEqualTypeOf<Promise<void>>();
  });

  it("should return Promise<void>", () => {
    const bus: CommandBus = { dispatch: async () => {} };
    expectTypeOf(bus.dispatch).returns.toEqualTypeOf<Promise<void>>();
  });

  // ### CommandBus dispatch is not generic
  it("should accept Command parameter type", () => {
    expectTypeOf<CommandBus["dispatch"]>()
      .parameter(0)
      .toEqualTypeOf<Command>();
  });
});
