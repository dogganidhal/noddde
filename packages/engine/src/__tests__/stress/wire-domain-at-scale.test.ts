/**
 * Type-system stress test for `@noddde/engine`.
 *
 * Verifies that `InferDomain` (the type users reach for when annotating
 * a wired `Domain` instance without calling `wireDomain` — e.g., NestJS
 * DI) still produces correctly narrowed dispatch types when the
 * underlying definition contains many aggregates, projections, and sagas.
 *
 * This is the engine-side companion to the core stress test at
 * [`packages/core/src/__tests__/stress/type-system.test.ts`](../../../../core/src/__tests__/stress/type-system.test.ts).
 * Core verifies `Infer*Map*` composition; this file verifies that those
 * unions thread through the `Domain<...>` generics correctly.
 *
 * Run via:
 *   yarn workspace @noddde/engine typecheck:stress
 *   yarn workspace @noddde/engine test
 */
import { describe, it, expectTypeOf } from "vitest";
import { defineDomain } from "@noddde/core";
import type {
  Aggregate,
  DefineCommands,
  DefineEvents,
  DefineQueries,
  Infrastructure,
  Projection,
  Saga,
} from "@noddde/core";
import type { Domain, InferDomain } from "@noddde/engine";

interface StressInfra extends Infrastructure {
  clock: { now(): number };
  logger: { log(msg: string): void };
}

type StressAggregate<N extends string> = Aggregate<{
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
  infrastructure: StressInfra;
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

// `expectTypeOf` is type-only at runtime; `defineDomain` only spreads its
// argument. `stub` gives every component a real runtime value so vitest can
// evaluate the module body — types come entirely from the generic parameter.
const stub = <T>(): T => ({}) as unknown as T;

const Agg1 = stub<StressAggregate<"Agg1">>();
const Agg2 = stub<StressAggregate<"Agg2">>();
const Agg3 = stub<StressAggregate<"Agg3">>();
const Agg4 = stub<StressAggregate<"Agg4">>();
const Agg5 = stub<StressAggregate<"Agg5">>();
const Agg6 = stub<StressAggregate<"Agg6">>();
const Agg7 = stub<StressAggregate<"Agg7">>();
const Agg8 = stub<StressAggregate<"Agg8">>();
const Agg9 = stub<StressAggregate<"Agg9">>();
const Agg10 = stub<StressAggregate<"Agg10">>();

const Proj1 = stub<StressProjection<"Proj1", "Agg1_Evt1" | "Agg2_Evt1">>();
const Proj2 = stub<StressProjection<"Proj2", "Agg3_Evt1" | "Agg4_Evt1">>();

const Saga1 = stub<StressSaga<"Agg5_Evt1" | "Agg6_Evt2", "Agg7_Cmd1">>();

const definition = defineDomain({
  writeModel: {
    aggregates: {
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
    },
  },
  readModel: { projections: { Proj1, Proj2 } },
  processModel: { sagas: { Saga1 } },
});

type AppDomain = InferDomain<typeof definition>;

type DomainGenerics<D> =
  D extends Domain<infer I, infer _SC, infer _SQ, infer AC, infer PQ, infer _P>
    ? { Infra: I; AggCmd: AC; ProjQuery: PQ }
    : never;
type G = DomainGenerics<AppDomain>;

// The Domain type's TInfrastructure generic is already an intersection (the
// engine's `wireDomain` collapses the per-component union via
// `UnionToIntersection`), so `G["Infra"]` should be assignable to each
// component's infrastructure.

describe("engine wire-domain narrowing at scale (10 aggregates, 2 projections, 1 saga)", () => {
  it("InferDomain accumulates aggregate commands into the dispatch union", () => {
    expectTypeOf<
      Extract<G["AggCmd"], { name: "Agg1_Cmd1" }>["name"]
    >().toEqualTypeOf<"Agg1_Cmd1">();
    expectTypeOf<
      Extract<G["AggCmd"], { name: "Agg5_Cmd2" }>["name"]
    >().toEqualTypeOf<"Agg5_Cmd2">();
    expectTypeOf<
      Extract<G["AggCmd"], { name: "Agg10_Cmd3" }>["name"]
    >().toEqualTypeOf<"Agg10_Cmd3">();
  });

  it("InferDomain accumulates projection queries into the query union", () => {
    expectTypeOf<
      Extract<G["ProjQuery"], { name: "Proj1_GetCount" }>["name"]
    >().toEqualTypeOf<"Proj1_GetCount">();
    expectTypeOf<
      Extract<G["ProjQuery"], { name: "Proj2_GetCount" }>["name"]
    >().toEqualTypeOf<"Proj2_GetCount">();
  });

  it("InferDomain intersects infrastructure from aggregates, projections, and sagas", () => {
    expectTypeOf<G["Infra"]>().toExtend<StressInfra>();
  });

  it("dispatchCommand on the inferred Domain narrows by name (compile-time)", () => {
    type Cmd = Extract<G["AggCmd"], { name: "Agg3_Cmd2" }>;
    expectTypeOf<Cmd>().not.toBeNever();
    expectTypeOf<Cmd["payload"]>().toEqualTypeOf<{ value: number }>();
  });

  it("dispatchCommand rejects names that aren't in the union (compile-time)", () => {
    expectTypeOf<
      Extract<G["AggCmd"], { name: "Bogus_Cmd" }>
    >().toEqualTypeOf<never>();
  });
});
