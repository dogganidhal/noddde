import { describe, it, expectTypeOf } from "vitest";
import type {
  Command,
  AggregateCommand,
  StandaloneCommand,
  DefineCommands,
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
});
