import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "../errors";

describe("isUniqueViolation", () => {
  it("detects Postgres SQLSTATE 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects MySQL ER_DUP_ENTRY / errno 1062", () => {
    expect(isUniqueViolation({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isUniqueViolation({ errno: 1062 })).toBe(true);
  });

  it("detects SQLite SQLITE_CONSTRAINT* codes", () => {
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe(
      true,
    );
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(true);
  });

  it("detects MSSQL 2627/2601", () => {
    expect(isUniqueViolation({ number: 2627 })).toBe(true);
    expect(isUniqueViolation({ number: 2601 })).toBe(true);
  });

  it("recurses into TypeORM's QueryFailedError.driverError", () => {
    expect(
      isUniqueViolation({
        message: "query failed",
        driverError: { code: "23505" },
      }),
    ).toBe(true);
  });

  it("falls back to message matching when no code is present, on a non-English message", () => {
    expect(isUniqueViolation({ message: "Duplicate entry 'x' for key" })).toBe(
      true,
    );
  });

  it("does not localize-match against an unrelated error with no code", () => {
    expect(isUniqueViolation({ message: "connection refused" })).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("plain string")).toBe(false);
  });
});
