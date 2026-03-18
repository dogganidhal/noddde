import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  QueryHandler,
  DefineQueries,
  QueryResult,
  Infrastructure,
  Query,
  CQRSInfrastructure,
} from "@noddde/core";

describe("QueryHandler", () => {
  interface AccountView {
    id: string;
    balance: number;
  }

  interface AccountInfra extends Infrastructure {
    accountRepo: { getById(id: string): Promise<AccountView> };
  }

  type AccountQuery = DefineQueries<{
    GetAccountById: { payload: { id: string }; result: AccountView };
  }>;

  type GetAccountByIdQuery = Extract<AccountQuery, { name: "GetAccountById" }>;
  type Handler = QueryHandler<AccountInfra, GetAccountByIdQuery>;

  it("should receive query payload as first parameter", () => {
    expectTypeOf<Parameters<Handler>[0]>().toEqualTypeOf<{ id: string }>();
  });

  it("should receive infrastructure as second parameter", () => {
    expectTypeOf<Parameters<Handler>[1]>().toEqualTypeOf<AccountInfra>();
  });

  it("should return the query result type or a promise of it", () => {
    expectTypeOf<ReturnType<Handler>>().toEqualTypeOf<
      AccountView | Promise<AccountView>
    >();
  });
});

describe("QueryHandler sync/async", () => {
  it("should allow synchronous handler", () => {
    const handler: QueryHandler<Infrastructure, Query<number>> = (_payload) => {
      return 42;
    };
    expect(handler({}, {})).toBe(42);
  });

  it("should allow asynchronous handler", async () => {
    const handler: QueryHandler<Infrastructure, Query<number>> = async (_payload) => {
      return 42;
    };
    await expect(handler({}, {})).resolves.toBe(42);
  });
});

describe("QueryHandler infrastructure isolation", () => {
  type Handler = QueryHandler<Infrastructure, Query<string>>;

  it("should not have commandBus in infrastructure", () => {
    expectTypeOf<Parameters<Handler>[1]>().not.toMatchTypeOf<CQRSInfrastructure>();
  });
});
