import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  Command,
  AggregateCommand,
  StandaloneCommand,
  DefineCommands,
  ID,
} from "@noddde/core";

describe("Command, AggregateCommand, StandaloneCommand & DefineCommands", () => {
  // ### Command interface accepts minimal objects
  describe("Command", () => {
    it("should accept an object with only name", () => {
      const cmd: Command = { name: "DoSomething" };
      expectTypeOf(cmd.name).toBeString();
    });

    it("should accept an object with name and payload", () => {
      const cmd: Command = { name: "DoSomething", payload: { foo: "bar" } };
      expectTypeOf(cmd.payload).toBeAny();
    });

    it("should have optional payload", () => {
      expectTypeOf<Command["payload"]>().toBeAny();
    });
  });

  // ### AggregateCommand extends Command with targetAggregateId
  describe("AggregateCommand", () => {
    it("should be assignable to Command", () => {
      expectTypeOf<AggregateCommand>().toMatchTypeOf<Command>();
    });

    it("should have targetAggregateId defaulting to string", () => {
      expectTypeOf<AggregateCommand["targetAggregateId"]>().toBeString();
    });

    it("should accept custom ID type", () => {
      expectTypeOf<
        AggregateCommand<number>["targetAggregateId"]
      >().toBeNumber();
    });

    it("should accept bigint as custom ID type", () => {
      expectTypeOf<
        AggregateCommand<bigint>["targetAggregateId"]
      >().toEqualTypeOf<bigint>();
    });
  });

  // ### StandaloneCommand is an alias for Command
  describe("StandaloneCommand", () => {
    it("should be structurally identical to Command", () => {
      expectTypeOf<StandaloneCommand>().toEqualTypeOf<Command>();
    });
  });

  // ### DefineCommands produces discriminated union with void handling
  describe("DefineCommands", () => {
    type AccountCommand = DefineCommands<{
      CreateAccount: void;
      AuthorizeTransaction: { amount: number; merchant: string };
    }>;

    it("should omit payload for void commands", () => {
      type CreateCmd = Extract<AccountCommand, { name: "CreateAccount" }>;
      expectTypeOf<CreateCmd>().toEqualTypeOf<{
        name: "CreateAccount";
        targetAggregateId: string;
      }>();
    });

    it("should include payload for non-void commands", () => {
      type AuthCmd = Extract<AccountCommand, { name: "AuthorizeTransaction" }>;
      expectTypeOf<AuthCmd>().toEqualTypeOf<{
        name: "AuthorizeTransaction";
        targetAggregateId: string;
        payload: { amount: number; merchant: string };
      }>();
    });

    it("should produce never for empty record", () => {
      type NoCommands = DefineCommands<{}>;
      expectTypeOf<NoCommands>().toBeNever();
    });
  });

  // ### DefineCommands with custom ID type
  describe("DefineCommands with custom ID", () => {
    type Cmd = DefineCommands<{ Create: void }, number>;

    it("should use the custom ID type for targetAggregateId", () => {
      type CreateCmd = Extract<Cmd, { name: "Create" }>;
      expectTypeOf<CreateCmd["targetAggregateId"]>().toBeNumber();
    });
  });

  // ### Command accepts optional commandId
  describe("Command.commandId", () => {
    it("should accept an optional commandId of type ID", () => {
      const cmd: Command = { name: "DoSomething", commandId: "cmd-123" };
      expectTypeOf(cmd.commandId).toEqualTypeOf<ID | undefined>();
    });

    it("should be inherited by AggregateCommand", () => {
      const cmd: AggregateCommand = {
        name: "DoSomething",
        targetAggregateId: "agg-1",
        commandId: "cmd-456",
      };
      expectTypeOf(cmd.commandId).toEqualTypeOf<ID | undefined>();
    });

    it("should be optional — commands without commandId are valid", () => {
      const cmd: Command = { name: "DoSomething" };
      expect(cmd.commandId).toBeUndefined();
    });
  });
});
