import { describe, it, expectTypeOf } from "vitest";
import type { ID } from "@noddde/core";

describe("ID", () => {
  it("should accept string", () => {
    expectTypeOf<string>().toMatchTypeOf<ID>();
  });

  it("should accept number", () => {
    expectTypeOf<number>().toMatchTypeOf<ID>();
  });

  it("should accept bigint", () => {
    expectTypeOf<bigint>().toMatchTypeOf<ID>();
  });
});

describe("ID rejects non-serializable types", () => {
  it("should not accept boolean", () => {
    expectTypeOf<boolean>().not.toMatchTypeOf<ID>();
  });

  it("should not accept symbol", () => {
    expectTypeOf<symbol>().not.toMatchTypeOf<ID>();
  });

  it("should not accept object", () => {
    expectTypeOf<{ id: string }>().not.toMatchTypeOf<ID>();
  });
});

describe("ID accepts branded types", () => {
  type UserId = string & { __brand: "UserId" };
  type AccountId = number & { __brand: "AccountId" };

  it("should accept branded string", () => {
    expectTypeOf<UserId>().toMatchTypeOf<ID>();
  });

  it("should accept branded number", () => {
    expectTypeOf<AccountId>().toMatchTypeOf<ID>();
  });
});
