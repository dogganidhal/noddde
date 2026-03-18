import { describe, it, expectTypeOf } from "vitest";
import type { Query, QueryResult, DefineQueries } from "@noddde/core";

describe("Query, QueryResult & DefineQueries", () => {
  // ### Query interface with phantom result type
  describe("Query", () => {
    it("should accept a basic query object", () => {
      const query: Query<string[]> = { name: "ListUsers" };
      expectTypeOf(query.name).toBeString();
    });

    it("should accept query with payload", () => {
      const query: Query<{ id: string; name: string }> = {
        name: "GetUserById",
        payload: { id: "123" },
      };
      expectTypeOf(query).toMatchTypeOf<Query<any>>();
    });
  });

  // ### QueryResult extracts phantom type
  describe("QueryResult", () => {
    it("should extract the result type from Query", () => {
      type UserListQuery = Query<string[]>;
      expectTypeOf<QueryResult<UserListQuery>>().toEqualTypeOf<string[]>();
    });

    it("should work with complex result types", () => {
      interface UserView {
        id: string;
        name: string;
        email: string;
      }
      type GetUserQuery = Query<UserView>;
      expectTypeOf<QueryResult<GetUserQuery>>().toEqualTypeOf<UserView>();
    });

    it("should return any for Query<any>", () => {
      expectTypeOf<QueryResult<Query<any>>>().toBeAny();
    });
  });

  // ### DefineQueries produces typed union with payload handling
  describe("DefineQueries", () => {
    interface AccountView {
      id: string;
      balance: number;
    }

    type AccountQuery = DefineQueries<{
      GetAccountById: { payload: { id: string }; result: AccountView };
      ListAccounts: { result: AccountView[] };
    }>;

    it("should produce members with payload when specified", () => {
      type GetById = Extract<AccountQuery, { name: "GetAccountById" }>;
      expectTypeOf<GetById["name"]>().toEqualTypeOf<"GetAccountById">();
      expectTypeOf<GetById["payload"]>().toEqualTypeOf<{ id: string }>();
    });

    it("should produce members without explicit payload when omitted", () => {
      type ListAll = Extract<AccountQuery, { name: "ListAccounts" }>;
      expectTypeOf<ListAll["name"]>().toEqualTypeOf<"ListAccounts">();
    });

    it("should allow QueryResult to extract the result type", () => {
      type GetById = Extract<AccountQuery, { name: "GetAccountById" }>;
      expectTypeOf<QueryResult<GetById>>().toEqualTypeOf<AccountView>();
    });

    it("should allow QueryResult on the no-payload member", () => {
      type ListAll = Extract<AccountQuery, { name: "ListAccounts" }>;
      expectTypeOf<QueryResult<ListAll>>().toEqualTypeOf<AccountView[]>();
    });
  });

  // ### DefineQueries with void payload omits payload field
  describe("DefineQueries with void payload", () => {
    type MyQuery = DefineQueries<{
      ListAll: { payload: void; result: string[] };
    }>;

    it("should not have an explicit payload property in the intersected type", () => {
      type ListAll = Extract<MyQuery, { name: "ListAll" }>;
      expectTypeOf<ListAll["name"]>().toEqualTypeOf<"ListAll">();
    });
  });

  // ### DefineQueries with empty record produces never
  describe("DefineQueries with empty record", () => {
    type NoQueries = DefineQueries<{}>;

    it("should produce never", () => {
      expectTypeOf<NoQueries>().toBeNever();
    });
  });
});
