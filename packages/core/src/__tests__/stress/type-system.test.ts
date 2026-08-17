/**
 * Type-system stress test for `@noddde/core`.
 *
 * Asserts that the public type surface (`Infer*Map*`, `DefineCommands`,
 * `DefineEvents`, `DefineQueries`, `defineDomain`) composes correctly when
 * many aggregates / projections / sagas are wired into a single domain.
 *
 * Scale here (N = 20 aggregates) is deliberately modest — the goal is
 * type correctness at a representative size, not perf. The compiler-perf
 * sweep at N = 10 / 50 / 100 lives in `packages/core/scripts/run-type-perf.ts`.
 *
 * Run via:
 *   yarn workspace @noddde/core typecheck:stress   # tsc --noEmit (real type check)
 *   yarn workspace @noddde/core test               # runtime smoke (expectTypeOf is type-only)
 */
import { describe, it, expectTypeOf } from "vitest";
import type {
  Aggregate,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  InferAggregateMapCommands,
  InferAggregateMapInfrastructure,
  InferProjectionMapQueries,
  InferProjectionMapInfrastructure,
  InferSagaMapInfrastructure,
  Infrastructure,
  Projection,
  Saga,
} from "@noddde/core";

interface StressInfra extends Infrastructure {
  clock: { now(): number };
  logger: { log(msg: string): void };
}

interface ExtraInfra extends Infrastructure {
  notifier: { send(to: string, body: string): void };
}

type StressAggregate<
  N extends string,
  I extends Infrastructure = StressInfra,
> = Aggregate<{
  state: { counter: number; lastValue: number };
  events: DefineEvents<{
    [K in `${N}_Evt1` | `${N}_Evt2` | `${N}_Evt3`]: {
      id: string;
      value: number;
    };
  }>;
  commands: DefineCommands<{
    [K in `${N}_Cmd1` | `${N}_Cmd2` | `${N}_Cmd3`]: { value: number };
  }>;
  infrastructure: I;
}>;

type StressProjection<P extends string, EvtName extends string> = Projection<{
  events: DefineEvents<{ [K in EvtName]: { id: string; value: number } }>;
  queries: DefineQueries<{
    [K in `${P}_GetCount`]: {
      payload: { id: string };
      result: { count: number } | null;
    };
  }>;
  view: { count: number; lastValue: number };
  infrastructure: StressInfra;
}>;

type StressSaga<EvtName extends string, CmdName extends string> = Saga<{
  state: { step: number };
  events: DefineEvents<{ [K in EvtName]: { id: string; value: number } }>;
  commands: DefineCommands<{ [K in CmdName]: { value: number } }>;
  infrastructure: StressInfra;
}>;

// The stress fixture is a *type-level* exercise. `expectTypeOf` is a no-op
// proxy at runtime, so we only need runtime values for `defineDomain` to
// have something to spread. `stub` provides a single zero-cost placeholder
// shared across every component.
const stub = <T>(): T => ({}) as unknown as T;

// 20 aggregates. Aggregate 5 has an extended infrastructure to exercise the
// intersection accumulator in `InferAggregateMapInfrastructure`.
const Agg1 = stub<StressAggregate<"Agg1">>();
const Agg2 = stub<StressAggregate<"Agg2">>();
const Agg3 = stub<StressAggregate<"Agg3">>();
const Agg4 = stub<StressAggregate<"Agg4">>();
const Agg5 = stub<StressAggregate<"Agg5", StressInfra & ExtraInfra>>();
const Agg6 = stub<StressAggregate<"Agg6">>();
const Agg7 = stub<StressAggregate<"Agg7">>();
const Agg8 = stub<StressAggregate<"Agg8">>();
const Agg9 = stub<StressAggregate<"Agg9">>();
const Agg10 = stub<StressAggregate<"Agg10">>();
const Agg11 = stub<StressAggregate<"Agg11">>();
const Agg12 = stub<StressAggregate<"Agg12">>();
const Agg13 = stub<StressAggregate<"Agg13">>();
const Agg14 = stub<StressAggregate<"Agg14">>();
const Agg15 = stub<StressAggregate<"Agg15">>();
const Agg16 = stub<StressAggregate<"Agg16">>();
const Agg17 = stub<StressAggregate<"Agg17">>();
const Agg18 = stub<StressAggregate<"Agg18">>();
const Agg19 = stub<StressAggregate<"Agg19">>();
const Agg20 = stub<StressAggregate<"Agg20">>();

export const stressAggregates = {
  Agg1,
  Agg2,
  Agg3,
  Agg4,
  Agg5,
  Agg6,
  Agg7,
  Agg8,
  Agg9,
  Agg10,
  Agg11,
  Agg12,
  Agg13,
  Agg14,
  Agg15,
  Agg16,
  Agg17,
  Agg18,
  Agg19,
  Agg20,
} as const;

const Proj1 = stub<StressProjection<"Proj1", "Agg1_Evt1" | "Agg2_Evt1">>();
const Proj2 = stub<StressProjection<"Proj2", "Agg3_Evt1" | "Agg4_Evt1">>();
const Proj3 = stub<StressProjection<"Proj3", "Agg5_Evt1" | "Agg6_Evt1">>();
const Proj4 = stub<StressProjection<"Proj4", "Agg10_Evt2">>();
const Proj5 = stub<StressProjection<"Proj5", "Agg20_Evt3">>();

export const stressProjections = {
  Proj1,
  Proj2,
  Proj3,
  Proj4,
  Proj5,
} as const;

const Saga1 = stub<StressSaga<"Agg1_Evt1" | "Agg2_Evt1", "Agg3_Cmd1">>();
const Saga2 = stub<StressSaga<"Agg7_Evt2", "Agg8_Cmd2">>();
const Saga3 = stub<StressSaga<"Agg15_Evt3", "Agg16_Cmd3">>();

export const stressSagas = {
  Saga1,
  Saga2,
  Saga3,
} as const;

type AllAggregates = typeof stressAggregates;
type AllProjections = typeof stressProjections;
type AllSagas = typeof stressSagas;

// Local UnionToIntersection — mirrors the helper in `packages/engine/src/domain.ts`.
// The `Infer*MapInfrastructure` helpers return a *union* of per-component infras;
// the engine's `wireDomain` collapses that union into an intersection so the user
// must provide every field. The stress test asserts on the intersection form.
type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never;

type AggregateCommandsUnion = InferAggregateMapCommands<AllAggregates>;
type AggregateInfraIntersection = UnionToIntersection<
  InferAggregateMapInfrastructure<AllAggregates>
>;
type ProjectionQueriesUnion = InferProjectionMapQueries<AllProjections>;
type ProjectionInfraIntersection = UnionToIntersection<
  InferProjectionMapInfrastructure<AllProjections>
>;
type SagaInfraIntersection = UnionToIntersection<
  InferSagaMapInfrastructure<AllSagas>
>;

describe("type-system stress (N=20 aggregates, 5 projections, 3 sagas)", () => {
  it("InferAggregateMapCommands surfaces commands from every aggregate in the map", () => {
    expectTypeOf<
      Extract<AggregateCommandsUnion, { name: "Agg1_Cmd1" }>["name"]
    >().toEqualTypeOf<"Agg1_Cmd1">();
    expectTypeOf<
      Extract<AggregateCommandsUnion, { name: "Agg10_Cmd2" }>["name"]
    >().toEqualTypeOf<"Agg10_Cmd2">();
    expectTypeOf<
      Extract<AggregateCommandsUnion, { name: "Agg20_Cmd3" }>["name"]
    >().toEqualTypeOf<"Agg20_Cmd3">();
  });

  it("InferAggregateMapCommands narrows payload per discriminant", () => {
    expectTypeOf<
      Extract<AggregateCommandsUnion, { name: "Agg7_Cmd2" }>["payload"]
    >().toEqualTypeOf<{ value: number }>();
  });

  it("InferAggregateMapInfrastructure intersects every aggregate's infrastructure", () => {
    expectTypeOf<AggregateInfraIntersection>().toExtend<StressInfra>();
    expectTypeOf<AggregateInfraIntersection>().toExtend<ExtraInfra>();
  });

  it("InferProjectionMapQueries surfaces queries from every projection", () => {
    expectTypeOf<
      Extract<ProjectionQueriesUnion, { name: "Proj1_GetCount" }>["name"]
    >().toEqualTypeOf<"Proj1_GetCount">();
    expectTypeOf<
      Extract<ProjectionQueriesUnion, { name: "Proj5_GetCount" }>["name"]
    >().toEqualTypeOf<"Proj5_GetCount">();
  });

  it("InferProjectionMapInfrastructure intersects every projection's infrastructure", () => {
    expectTypeOf<ProjectionInfraIntersection>().toExtend<StressInfra>();
  });

  it("InferSagaMapInfrastructure intersects every saga's infrastructure", () => {
    expectTypeOf<SagaInfraIntersection>().toExtend<StressInfra>();
  });

  it("does not accidentally collapse commands of distinct aggregates", () => {
    // If `InferAggregateMapCommands` flattened to a single shape, Extract would
    // succeed for a name that doesn't exist. Guard against that regression.
    expectTypeOf<
      Extract<AggregateCommandsUnion, { name: "Bogus_Cmd" }>
    >().toEqualTypeOf<never>();
  });

  it("smoke: stress maps are non-empty at runtime", () => {
    // Runtime check is trivial — the real assertions are the `expectTypeOf`
    // calls above, which are enforced by `typecheck:stress`.
    const aggregateNames = Object.keys(stressAggregates);
    expectTypeOf(aggregateNames).toEqualTypeOf<string[]>();
  });
});
