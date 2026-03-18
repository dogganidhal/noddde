/* eslint-disable no-unused-vars */
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AggregateCommand,
  CommandHandler,
  DefineCommands,
  DefineEvents,
  InferAggregateCommands,
  InferAggregateEvents,
  InferAggregateID,
  InferAggregateInfrastructure,
  InferAggregateState,
  Infrastructure,
} from "@noddde/core";
import { defineAggregate } from "@noddde/core";

describe("defineAggregate", () => {
  type CounterState = { count: number };

  type CounterEvent = DefineEvents<{
    Incremented: { amount: number };
    Decremented: { amount: number };
  }>;

  type CounterCommand = DefineCommands<{
    Increment: { amount: number };
    Decrement: { amount: number };
  }>;

  type CounterTypes = {
    state: CounterState;
    events: CounterEvent;
    commands: CounterCommand;
    infrastructure: Infrastructure;
  };

  const Counter = defineAggregate<CounterTypes>({
    initialState: { count: 0 },
    commands: {
      Increment: (command, _state, _infra) => ({
        name: "Incremented",
        payload: { amount: command.payload.amount },
      }),
      Decrement: (command, _state, _infra) => ({
        name: "Decremented",
        payload: { amount: command.payload.amount },
      }),
    },
    apply: {
      Incremented: (payload, state) => ({
        count: state.count + payload.amount,
      }),
      Decremented: (payload, state) => ({
        count: state.count - payload.amount,
      }),
    },
  });

  it("should return the aggregate config object", () => {
    expectTypeOf(Counter.initialState).toEqualTypeOf<CounterState>();
  });

  it("should have typed command handlers", () => {
    expectTypeOf(Counter.commands.Increment).toBeFunction();
    expectTypeOf(Counter.commands.Decrement).toBeFunction();
  });

  it("should have typed apply handlers", () => {
    expectTypeOf(Counter.apply.Incremented).toBeFunction();
    expectTypeOf(Counter.apply.Decremented).toBeFunction();
  });
});

describe("CommandHandler", () => {
  interface CreateAccountCommand extends AggregateCommand {
    name: "CreateAccount";
    payload: { owner: string };
  }

  type AccountEvent = {
    name: "AccountCreated";
    payload: { id: string; owner: string };
  };

  type Handler = CommandHandler<
    CreateAccountCommand,
    { balance: number },
    AccountEvent,
    Infrastructure
  >;

  it("should receive the specific command as first parameter", () => {
    expectTypeOf<
      Parameters<Handler>[0]
    >().toEqualTypeOf<CreateAccountCommand>();
  });

  it("should receive state as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<{ balance: number }>();
  });

  it("should receive infrastructure as third parameter", () => {
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<Infrastructure>();
  });

  it("should return event(s) or Promise of event(s)", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      AccountEvent | AccountEvent[] | Promise<AccountEvent | AccountEvent[]>
    >();
  });
});

describe("Aggregate exhaustive handlers", () => {
  type Events = DefineEvents<{
    ItemAdded: { item: string };
    ItemRemoved: { item: string };
  }>;

  type Commands = DefineCommands<{
    AddItem: { item: string };
    RemoveItem: { item: string };
  }>;

  type CartTypes = {
    state: { items: string[] };
    events: Events;
    commands: Commands;
    infrastructure: Infrastructure;
  };

  it("should compile when all handlers are provided", () => {
    const cart = defineAggregate<CartTypes>({
      initialState: { items: [] },
      commands: {
        AddItem: (cmd) => ({
          name: "ItemAdded",
          payload: { item: cmd.payload.item },
        }),
        RemoveItem: (cmd) => ({
          name: "ItemRemoved",
          payload: { item: cmd.payload.item },
        }),
      },
      apply: {
        ItemAdded: (payload, state) => ({
          items: [...state.items, payload.item],
        }),
        ItemRemoved: (payload, state) => ({
          items: state.items.filter((i) => i !== payload.item),
        }),
      },
    });
    expect(cart.initialState).toEqual({ items: [] });
  });
});

describe("Infer utilities", () => {
  type MyState = { value: number };
  type MyEvent = DefineEvents<{ Updated: { newValue: number } }>;
  type MyCommand = DefineCommands<{ Update: { newValue: number } }>;

  interface MyInfra extends Infrastructure {
    logger: { log(msg: string): void };
  }

  type MyTypes = {
    state: MyState;
    events: MyEvent;
    commands: MyCommand;
    infrastructure: MyInfra;
  };

  const MyAggregate = defineAggregate<MyTypes>({
    initialState: { value: 0 },
    commands: {
      Update: (cmd) => ({
        name: "Updated",
        payload: { newValue: cmd.payload.newValue },
      }),
    },
    apply: {
      Updated: (payload, _state) => ({ value: payload.newValue }),
    },
  });

  it("should infer state type", () => {
    expectTypeOf<
      InferAggregateState<typeof MyAggregate>
    >().toEqualTypeOf<MyState>();
  });

  it("should infer events type", () => {
    expectTypeOf<
      InferAggregateEvents<typeof MyAggregate>
    >().toEqualTypeOf<MyEvent>();
  });

  it("should infer commands type", () => {
    expectTypeOf<
      InferAggregateCommands<typeof MyAggregate>
    >().toEqualTypeOf<MyCommand>();
  });

  it("should infer infrastructure type", () => {
    expectTypeOf<
      InferAggregateInfrastructure<typeof MyAggregate>
    >().toEqualTypeOf<MyInfra>();
  });

  it("should infer aggregate ID from types bundle", () => {
    expectTypeOf<InferAggregateID<MyTypes>>().toBeString();
  });
});

describe("Command handler return types", () => {
  type Events = DefineEvents<{ Done: { id: string } }>;
  type Commands = DefineCommands<{ DoIt: void; DoItTwice: void }>;

  type Types = {
    state: {};
    events: Events;
    commands: Commands;
    infrastructure: Infrastructure;
  };

  it("should accept single event return", () => {
    const agg = defineAggregate<Types>({
      initialState: {},
      commands: {
        DoIt: (cmd) => ({
          name: "Done",
          payload: { id: cmd.targetAggregateId },
        }),
        DoItTwice: (cmd) => [
          { name: "Done", payload: { id: cmd.targetAggregateId } },
          { name: "Done", payload: { id: cmd.targetAggregateId } },
        ],
      },
      apply: {
        Done: (_payload, state) => state,
      },
    });
    expect(agg).toBeDefined();
  });
});

describe("defineAggregate identity", () => {
  type E = DefineEvents<{ X: { v: number } }>;
  type C = DefineCommands<{ Y: { v: number } }>;
  type T = {
    state: { v: number };
    events: E;
    commands: C;
    infrastructure: Infrastructure;
  };

  it("should return the exact same config object", () => {
    const config = {
      initialState: { v: 0 },
      commands: {
        Y: (cmd: any) => ({
          name: "X" as const,
          payload: { v: cmd.payload.v },
        }),
      },
      apply: {
        X: (payload: any, state: any) => ({ v: payload.v }),
      },
    };
    const result = defineAggregate<T>(config as any);
    expect(result).toBe(config);
  });
});
