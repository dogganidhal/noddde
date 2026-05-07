import { describe, it, expect, expectTypeOf } from "vitest";
import type { AggregateStateMapper } from "@noddde/core";

describe("AggregateStateMapper - type contract", () => {
  it("accepts arbitrary TState and TRow", () => {
    type State = { count: number };
    type Row = { c: number };
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ c: s.count }),
      fromRow: (r) => ({ count: r.c }),
    };
    expectTypeOf(mapper.toRow).parameter(0).toEqualTypeOf<State>();
    expectTypeOf(mapper.fromRow).parameter(0).toEqualTypeOf<Row>();
    expectTypeOf(mapper.toRow).returns.toEqualTypeOf<Row>();
    expectTypeOf(mapper.fromRow).returns.toEqualTypeOf<State>();
  });
});

describe("AggregateStateMapper - round trip", () => {
  it("returns the original state through toRow then fromRow", () => {
    type State = {
      customerId: string;
      total: number;
      status: "open" | "paid" | "cancelled";
    };
    type Row = State;
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ ...s }),
      fromRow: (r) => ({ ...r }),
    };
    const state: State = {
      customerId: "c-1",
      total: 4200,
      status: "open",
    };
    expect(mapper.fromRow(mapper.toRow(state))).toEqual(state);
  });
});

describe("AggregateStateMapper - purity", () => {
  it("does not mutate the state object passed to toRow", () => {
    type State = { value: number };
    type Row = { v: number };
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ v: s.value }),
      fromRow: (r) => ({ value: r.v }),
    };
    const state: State = { value: 42 };
    const snapshot = { ...state };
    mapper.toRow(state);
    expect(state).toEqual(snapshot);
  });

  it("does not mutate the row object passed to fromRow", () => {
    type State = { value: number };
    type Row = { v: number };
    const mapper: AggregateStateMapper<State, Row> = {
      toRow: (s) => ({ v: s.value }),
      fromRow: (r) => ({ value: r.v }),
    };
    const row: Row = { v: 42 };
    const snapshot = { ...row };
    mapper.fromRow(row);
    expect(row).toEqual(snapshot);
  });
});

describe("AggregateStateMapper - structural typing", () => {
  it("accepts any object with compatible toRow / fromRow methods", () => {
    type State = { name: string };
    type Row = { n: string };
    const mapper = {
      toRow: (s: State) => ({ n: s.name }),
      fromRow: (r: Row) => ({ name: r.n }),
    };
    expectTypeOf(mapper).toMatchTypeOf<AggregateStateMapper<State, Row>>();
  });
});

describe("AggregateStateMapper - extension", () => {
  it("can be extended with adapter-specific column pointers", () => {
    type State = { value: number };
    type Row = { v: number; id: string; ver: number };
    interface MyAdapterStateMapper<TS, TR extends object>
      // eslint-disable-next-line no-unused-vars
      extends AggregateStateMapper<TS, TR> {
      readonly aggregateIdField: keyof TR & string;
      readonly versionField: keyof TR & string;
    }
    const mapper: MyAdapterStateMapper<State, Row> = {
      aggregateIdField: "id",
      versionField: "ver",
      toRow: (s) => ({ v: s.value, id: "", ver: 0 }),
      fromRow: (r) => ({ value: r.v }),
    };
    expectTypeOf(mapper).toMatchTypeOf<AggregateStateMapper<State, Row>>();
  });
});
