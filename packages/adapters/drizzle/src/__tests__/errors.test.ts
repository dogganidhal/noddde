import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "../errors";

describe("isUniqueViolation", () => {
  it("detects PostgreSQL SQLSTATE 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects MySQL ER_DUP_ENTRY / errno 1062", () => {
    expect(isUniqueViolation({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isUniqueViolation({ errno: 1062 })).toBe(true);
  });

  it("detects SQLite SQLITE_CONSTRAINT* codes", () => {
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT" })).toBe(true);
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })).toBe(
      true,
    );
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(true);
  });

  it("falls back to message matching when no driver code is present", () => {
    expect(
      isUniqueViolation({ message: "UNIQUE constraint failed: t.x" }),
    ).toBe(true);
    expect(isUniqueViolation({ message: "Duplicate entry 'x' for key" })).toBe(
      true,
    );
  });

  it("does not misclassify a non-localized, non-code error", () => {
    expect(isUniqueViolation({ code: "23503", message: "fk violation" })).toBe(
      false,
    );
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
  });

  it("handles non-object / nullish input", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("plain string")).toBe(false);
  });
});
