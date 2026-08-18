import { describe, it, expect } from "vitest";
import { getRowsAffected } from "../rows-affected";

describe("getRowsAffected", () => {
  it("reads better-sqlite3's `changes`", () => {
    expect(getRowsAffected({ changes: 1 })).toBe(1);
  });

  it("reads node-postgres's `rowCount`", () => {
    expect(getRowsAffected({ rowCount: 1 })).toBe(1);
  });

  it("reads drizzle-orm/postgres-js's `count`", () => {
    expect(getRowsAffected({ count: 1 })).toBe(1);
  });

  it("reads mysql2's `affectedRows` (plain and array-wrapped)", () => {
    expect(getRowsAffected({ affectedRows: 1 })).toBe(1);
    expect(getRowsAffected([{ affectedRows: 1 }])).toBe(1);
  });

  it("reads a raw `rowsAffected` field", () => {
    expect(getRowsAffected({ rowsAffected: 1 })).toBe(1);
  });

  it("returns 0 for an unrecognized or empty result", () => {
    expect(getRowsAffected({})).toBe(0);
    expect(getRowsAffected(undefined)).toBe(0);
    expect(getRowsAffected(null)).toBe(0);
  });
});
