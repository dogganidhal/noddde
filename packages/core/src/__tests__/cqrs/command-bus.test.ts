/* eslint-disable no-unused-vars */
import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  CommandBus,
  CommandHandlerRegistry,
  Command,
  AggregateCommand,
} from "@noddde/core";

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

  // ### CommandHandlerRegistry is a separate, optional sub-interface
  describe("CommandHandlerRegistry", () => {
    it("should not be required by CommandBus", () => {
      // A CommandBus with no register() is a valid CommandBus.
      const bus: CommandBus = { dispatch: async () => {} };
      expectTypeOf(bus).toMatchTypeOf<CommandBus>();
    });

    it("should allow a bus to implement both CommandBus and CommandHandlerRegistry", async () => {
      const handlers = new Map<string, (command: Command) => void>();
      const bus: CommandBus & CommandHandlerRegistry = {
        dispatch: async (command) => {
          handlers.get(command.name)?.(command);
        },
        register: (commandName, handler) => {
          handlers.set(commandName, handler as (command: Command) => void);
        },
      };

      let received: Command | undefined;
      bus.register("DoSomething", (command) => {
        received = command;
      });
      await bus.dispatch({ name: "DoSomething" });

      expect(received).toEqual({ name: "DoSomething" });
    });

    it("should type register's handler parameter as Command", () => {
      expectTypeOf<CommandHandlerRegistry["register"]>()
        .parameter(1)
        .parameter(0)
        .toEqualTypeOf<Command>();
    });
  });
});
