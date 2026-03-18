import { describe, it, expectTypeOf } from "vitest";
import type {
  QueryBus,
  Query,
  DefineQueries,
  QueryResult,
} from "@noddde/core";

describe("QueryBus", () => {
  interface UserView {
    id: string;
    name: string;
  }

  type UserQuery = DefineQueries<{
    GetUserById: { payload: { id: string }; result: UserView };
    ListUsers: { result: UserView[] };
  }>;

  // ### QueryBus dispatch returns typed result
  it("should return typed result for a specific query", () => {
    const bus: QueryBus = { dispatch: async () => ({}) as any };
    type GetUserById = Extract<UserQuery, { name: "GetUserById" }>;
    const query = {} as GetUserById;
    expectTypeOf(bus.dispatch(query)).toEqualTypeOf<Promise<UserView>>();
  });

  it("should return array type for list queries", () => {
    const bus: QueryBus = { dispatch: async () => ({}) as any };
    type ListUsers = Extract<UserQuery, { name: "ListUsers" }>;
    const query = {} as ListUsers;
    expectTypeOf(bus.dispatch(query)).toEqualTypeOf<Promise<UserView[]>>();
  });

  it("should return Promise<any> for base Query<any>", () => {
    const bus: QueryBus = { dispatch: async () => ({}) as any };
    const query = {} as Query<any>;
    expectTypeOf(bus.dispatch(query)).toEqualTypeOf<Promise<any>>();
  });

  // ### QueryBus preserves phantom type through dispatch
  it("should infer the result type from the query", () => {
    const bus: QueryBus = { dispatch: async () => ({}) as any };
    const query: Query<number> = { name: "GetCount" };
    const result = bus.dispatch(query);
    expectTypeOf(result).toEqualTypeOf<Promise<number>>();
  });
});
