/* eslint-disable no-unused-vars */
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AggregateCommand,
  DecideHandler,
  DefineCommands,
  DefineEvents,
  FrameworkInfrastructure,
  InferAggregateCommands,
  InferAggregateEvents,
  InferAggregateID,
  InferAggregateInfrastructure,
  InferAggregateState,
  InferEvolveHandler,
  InferDecideHandler,
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
    decide: {
      Increment: (command, _state, _infra) => ({
        name: "Incremented",
        payload: { amount: command.payload.amount },
      }),
      Decrement: (command, _state, _infra) => ({
        name: "Decremented",
        payload: { amount: command.payload.amount },
      }),
    },
    evolve: {
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

  it("should have typed decide handlers", () => {
    expectTypeOf(Counter.decide.Increment).toBeFunction();
    expectTypeOf(Counter.decide.Decrement).toBeFunction();
  });

  it("should have typed evolve handlers", () => {
    expectTypeOf(Counter.evolve.Incremented).toBeFunction();
    expectTypeOf(Counter.evolve.Decremented).toBeFunction();
  });
});

describe("DecideHandler", () => {
  interface CreateAccountCommand extends AggregateCommand {
    name: "CreateAccount";
    payload: { owner: string };
  }

  type AccountEvent = {
    name: "AccountCreated";
    payload: { id: string; owner: string };
  };

  type Handler = DecideHandler<
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
      decide: {
        AddItem: (cmd) => ({
          name: "ItemAdded",
          payload: { item: cmd.payload.item },
        }),
        RemoveItem: (cmd) => ({
          name: "ItemRemoved",
          payload: { item: cmd.payload.item },
        }),
      },
      evolve: {
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
    decide: {
      Update: (cmd) => ({
        name: "Updated",
        payload: { newValue: cmd.payload.newValue },
      }),
    },
    evolve: {
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

describe("Decide handler return types", () => {
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
      decide: {
        DoIt: (cmd) => ({
          name: "Done",
          payload: { id: cmd.targetAggregateId },
        }),
        DoItTwice: (cmd) => [
          { name: "Done", payload: { id: cmd.targetAggregateId } },
          { name: "Done", payload: { id: cmd.targetAggregateId } },
        ],
      },
      evolve: {
        Done: (_payload, state) => state,
      },
    });
    expect(agg).toBeDefined();
  });
});

describe("InferAggregateID with number ID", () => {
  type MyEvent = DefineEvents<{ Created: { id: number } }>;
  type MyCommand = DefineCommands<{ Create: { id: number } }, number>;

  type NumericIdTypes = {
    state: {};
    events: MyEvent;
    commands: MyCommand;
    infrastructure: Infrastructure;
  };

  it("should infer number as the aggregate ID type", () => {
    expectTypeOf<InferAggregateID<NumericIdTypes>>().toBeNumber();
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
      decide: {
        Y: (cmd: any) => ({
          name: "X" as const,
          payload: { v: cmd.payload.v },
        }),
      },
      evolve: {
        X: (payload: any, _state: any) => ({ v: payload.v }),
      },
    };
    const result = defineAggregate<T>(config as any);
    expect(result).toBe(config);
  });
});

describe("InferDecideHandler", () => {
  type MyState = { value: number };

  type MyEvent = DefineEvents<{
    Updated: { newValue: number };
    Reset: {};
  }>;

  type MyCommand = DefineCommands<{
    Update: { newValue: number };
    Reset: void;
  }>;

  interface MyInfra extends Infrastructure {
    clock: { now(): Date };
  }

  type MyTypes = {
    state: MyState;
    events: MyEvent;
    commands: MyCommand;
    infrastructure: MyInfra;
  };

  it("should narrow the command to the specific variant", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    type Cmd = Parameters<Handler>[0];
    expectTypeOf<Cmd>().toEqualTypeOf<Extract<MyCommand, { name: "Update" }>>();
  });

  it("should use the aggregate state as second parameter", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyState>();
  });

  it("should merge infrastructure with FrameworkInfrastructure", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    expectTypeOf<Parameters<Handler>[2]>().toEqualTypeOf<
      MyInfra & FrameworkInfrastructure
    >();
  });

  it("should return the event union", () => {
    type Handler = InferDecideHandler<MyTypes, "Update">;
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      MyEvent | MyEvent[] | Promise<MyEvent | MyEvent[]>
    >();
  });

  it("should be usable in defineAggregate decide map", () => {
    const handleUpdate: InferDecideHandler<MyTypes, "Update"> = (
      command,
      _state,
      _infra,
    ) => ({
      name: "Updated",
      payload: { newValue: command.payload.newValue },
    });

    const handleReset: InferDecideHandler<MyTypes, "Reset"> = (
      _command,
      _state,
      _infra,
    ) => ({
      name: "Reset",
      payload: {},
    });

    const agg = defineAggregate<MyTypes>({
      initialState: { value: 0 },
      decide: {
        Update: handleUpdate,
        Reset: handleReset,
      },
      evolve: {
        Updated: (payload, _state) => ({ value: payload.newValue }),
        Reset: (_payload, _state) => ({ value: 0 }),
      },
    });

    expectTypeOf(agg.decide.Update).toEqualTypeOf<typeof handleUpdate>();
  });
});

describe("InferEvolveHandler", () => {
  type MyState = { value: number };

  type MyEvent = DefineEvents<{
    Updated: { newValue: number };
    Reset: {};
  }>;

  type MyCommand = DefineCommands<{
    Update: { newValue: number };
    Reset: void;
  }>;

  type MyTypes = {
    state: MyState;
    events: MyEvent;
    commands: MyCommand;
    infrastructure: Infrastructure;
  };

  it("should narrow the event payload to the specific variant", () => {
    type Handler = InferEvolveHandler<MyTypes, "Updated">;
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{
      newValue: number;
    }>();
  });

  it("should use the aggregate state as second parameter and return type", () => {
    type Handler = InferEvolveHandler<MyTypes, "Updated">;
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<MyState>();
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<MyState>();
  });

  it("should be usable in defineAggregate evolve map", () => {
    const evolveUpdated: InferEvolveHandler<MyTypes, "Updated"> = (
      payload,
      _state,
    ) => ({ value: payload.newValue });

    const evolveReset: InferEvolveHandler<MyTypes, "Reset"> = (
      _payload,
      _state,
    ) => ({ value: 0 });

    const agg = defineAggregate<MyTypes>({
      initialState: { value: 0 },
      decide: {
        Update: (cmd) => ({
          name: "Updated",
          payload: { newValue: cmd.payload.newValue },
        }),
        Reset: (_cmd) => ({
          name: "Reset",
          payload: {},
        }),
      },
      evolve: {
        Updated: evolveUpdated,
        Reset: evolveReset,
      },
    });

    expectTypeOf(agg.evolve.Updated).toEqualTypeOf<typeof evolveUpdated>();
  });
});
