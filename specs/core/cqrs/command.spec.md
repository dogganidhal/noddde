---
title: "Command, AggregateCommand, StandaloneCommand & DefineCommands"
module: cqrs/command/command
source_file: packages/core/src/cqrs/command/command.ts
status: implemented
exports: [Command, AggregateCommand, StandaloneCommand, DefineCommands]
depends_on: [id]
docs:
  - commands/defining-commands.mdx
---

# Command, AggregateCommand, StandaloneCommand & DefineCommands

> Commands represent intent to perform an action in the domain. The module provides a base `Command` interface, an `AggregateCommand` extension that targets a specific aggregate instance, a `StandaloneCommand` alias for non-aggregate commands, and a `DefineCommands` utility type that builds discriminated unions of aggregate commands from a payload map.

## Type Contract

- **`Command`** is an interface with:
  - `name: string` -- discriminant for type narrowing.
  - `payload?: any` -- optional data carried by the command.
- **`AggregateCommand<TID extends ID = string>`** extends `Command` with:
  - `targetAggregateId: TID` -- identifies which aggregate instance handles this command.
  - `TID` is bounded by `ID` and defaults to `string`.
- **`StandaloneCommand`** is a type alias for `Command` (no additional fields).
- **`DefineCommands<TPayloads, TID extends ID = string>`** maps a record of payload types to a discriminated union of `AggregateCommand` types:
  - When `TPayloads[K]` is `void`, the command has `{ name: K; targetAggregateId: TID }` (no `payload` field).
  - When `TPayloads[K]` is not `void`, the command has `{ name: K; targetAggregateId: TID; payload: TPayloads[K] }`.

## Behavioral Requirements

- `Command` is structural; any `{ name: string }` satisfies it (payload is optional).
- `AggregateCommand` adds routing information via `targetAggregateId`.
- `StandaloneCommand` is identical to `Command` -- it is a semantic alias for clarity.
- `DefineCommands` conditionally omits `payload` when the value type is `void`, producing a cleaner API for payload-less commands.
- `DefineCommands` always includes `targetAggregateId`, making every member an `AggregateCommand`.

## Invariants

- Every member of a `DefineCommands` union has `name` as a string literal and `targetAggregateId` of type `TID`.
- Members with `void` payload do NOT have a `payload` property at all.
- Members with non-`void` payload always have a `payload` property.
- `StandaloneCommand` is structurally identical to `Command`.
- `AggregateCommand` is a strict superset of `Command`.
- `DefineCommands<{}>` produces `never`.

## Edge Cases

- **`void` payload**: `DefineCommands<{ Create: void }>` yields `{ name: "Create"; targetAggregateId: string }` with no `payload`.
- **Mixed void and non-void**: The union correctly differentiates members with and without `payload`.
- **Custom ID type**: `DefineCommands<{ Create: void }, number>` uses `targetAggregateId: number`.
- **Non-ID type rejected**: `DefineCommands<{ Create: void }, boolean>` fails at the `TID extends ID` bound — `boolean` is not assignable to `ID`.
- **Empty record**: `DefineCommands<{}>` produces `never`.
- **`any` payload**: `DefineCommands<{ Foo: any }>` produces `{ name: "Foo"; targetAggregateId: string; payload: any }` since `any extends void` is true in TypeScript's conditional type distribution, but `any` is special -- it distributes to both branches, resulting in a union. This is a known TypeScript edge case.

## Integration Points

- `Command` is the base constraint for `CommandBus.dispatch` and `SagaTypes["commands"]`.
- `AggregateCommand` is the constraint for `AggregateTypes["commands"]` and the aggregate `CommandHandler`.
- `StandaloneCommand` is the constraint for `StandaloneCommandHandler`.
- `DefineCommands` is the primary way users define command unions that flow into `AggregateTypes`.

## Test Scenarios

### Command interface accepts minimal objects

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Command } from "@noddde/core";

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
```

### AggregateCommand extends Command with targetAggregateId

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { AggregateCommand, Command } from "@noddde/core";

describe("AggregateCommand", () => {
  it("should be assignable to Command", () => {
    expectTypeOf<AggregateCommand>().toMatchTypeOf<Command>();
  });

  it("should have targetAggregateId defaulting to string", () => {
    expectTypeOf<AggregateCommand["targetAggregateId"]>().toBeString();
  });

  it("should accept bigint as custom ID type", () => {
    expectTypeOf<
      AggregateCommand<bigint>["targetAggregateId"]
    >().toEqualTypeOf<bigint>();
  });

  it("should accept custom ID type", () => {
    expectTypeOf<AggregateCommand<number>["targetAggregateId"]>().toBeNumber();
  });
});
```

### StandaloneCommand is an alias for Command

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { StandaloneCommand, Command } from "@noddde/core";

describe("StandaloneCommand", () => {
  it("should be structurally identical to Command", () => {
    expectTypeOf<StandaloneCommand>().toEqualTypeOf<Command>();
  });
});
```

### DefineCommands produces discriminated union with void handling

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineCommands } from "@noddde/core";

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
```

### DefineCommands with custom ID type

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { DefineCommands } from "@noddde/core";

describe("DefineCommands with custom ID", () => {
  type Cmd = DefineCommands<{ Create: void }, number>;

  it("should use the custom ID type for targetAggregateId", () => {
    type CreateCmd = Extract<Cmd, { name: "Create" }>;
    expectTypeOf<CreateCmd["targetAggregateId"]>().toBeNumber();
  });
});
```
