// Step 1: defineDomain returns the input unchanged with type inference
import { describe, it, expect } from "vitest";
import { defineDomain, defineAggregate } from "@noddde/core";
import type {
  AggregateTypes,
  DefineCommands,
  DefineEvents,
  Infrastructure,
} from "@noddde/core";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { by: number } }>;
type CounterCommand = DefineCommands<{ Increment: { by: number } }>;
type CounterTypes = AggregateTypes & {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: Infrastructure;
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  decide: {
    Increment: (cmd) => ({
      name: "Incremented",
      payload: { by: cmd.payload.by },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.by }),
  },
});

describe("defineDomain (core)", () => {
  it("returns the same object reference (identity)", () => {
    const input = {
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    };

    const definition = defineDomain(input);

    expect(definition).toBe(input);
  });

  it("preserves writeModel, readModel, and processModel as provided", () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Counter } },
      readModel: { projections: {} },
    });

    expect(definition.writeModel.aggregates).toEqual({ Counter });
    expect(definition.readModel.projections).toEqual({});
    expect(definition.processModel).toBeUndefined();
  });

  it("accepts an empty domain (no aggregates, no projections, no process model)", () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    expect(definition.writeModel.aggregates).toEqual({});
    expect(definition.readModel.projections).toEqual({});
    expect(definition.processModel).toBeUndefined();
  });

  it("returns a fresh reference per call", () => {
    const a = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });
    const b = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    expect(a).not.toBe(b);
  });
});

// Step 2: defineDomain accepts the legacy explicit-generic overload
describe("defineDomain (core) — legacy overload", () => {
  it("accepts an explicit TInfrastructure generic and returns the input", () => {
    const input = {
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    };

    const definition = defineDomain<Infrastructure>(input);

    expect(definition).toBe(input);
  });
});

// Step 3: defineDomain supports processModel with sagas and standalone event handlers
describe("defineDomain (core) — processModel", () => {
  it("accepts processModel with sagas omitted but standaloneEventHandlers present", () => {
    const handler = async () => {};
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: {
        standaloneEventHandlers: {
          SomethingHappened: handler,
        },
      },
    });

    expect(definition.processModel).toBeDefined();
    expect(definition.processModel?.sagas).toBeUndefined();
    expect(definition.processModel?.standaloneEventHandlers).toEqual({
      SomethingHappened: handler,
    });
  });

  it("accepts processModel as an empty object", () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
      processModel: {},
    });

    expect(definition.processModel).toEqual({});
  });
});

// Step 4: @noddde/engine re-exports defineDomain and DomainDefinition from @noddde/core
import { defineDomain as coreDefineDomain } from "@noddde/core";
import { defineDomain as engineDefineDomain } from "@noddde/engine";

describe("defineDomain re-export from @noddde/engine", () => {
  it("the engine package re-exports the same function reference as core", () => {
    expect(engineDefineDomain).toBe(coreDefineDomain);
  });
});
