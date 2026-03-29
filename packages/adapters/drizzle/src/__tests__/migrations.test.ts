import { describe, it, expect } from "vitest";
import { generateDrizzleMigration } from "../migrations";

describe("Migration Generation", () => {
  it("generates SQL for default shared tables (SQLite)", () => {
    const sql = generateDrizzleMigration("sqlite");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_events");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_aggregate_states");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_saga_states");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
    expect(sql).not.toContain("noddde_snapshots");
    expect(sql).not.toContain("noddde_outbox");
  });

  it("includes snapshots and outbox tables when requested", () => {
    const sql = generateDrizzleMigration("sqlite", {
      sharedTables: { snapshots: true, outbox: true },
    });

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_snapshots");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS noddde_outbox");
  });

  it("generates per-aggregate state tables", () => {
    const sql = generateDrizzleMigration("sqlite", {
      aggregateStateTables: {
        Order: { tableName: "orders" },
        BankAccount: {
          tableName: "bank_accounts",
          columns: {
            aggregateId: "account_id",
            state: "data",
            version: "ver",
          },
        },
      },
    });

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS orders");
    expect(sql).toContain("aggregate_id TEXT NOT NULL PRIMARY KEY");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bank_accounts");
    expect(sql).toContain("account_id TEXT NOT NULL PRIMARY KEY");
    expect(sql).toContain("data TEXT NOT NULL");
    expect(sql).toContain("ver INTEGER NOT NULL DEFAULT 0");
  });

  it("generates PostgreSQL-specific DDL", () => {
    const sql = generateDrizzleMigration("postgresql");

    expect(sql).toContain("SERIAL PRIMARY KEY");
    expect(sql).toContain("JSONB NOT NULL");
    expect(sql).toContain("TEXT NOT NULL");
  });

  it("generates MySQL-specific DDL", () => {
    const sql = generateDrizzleMigration("mysql");

    expect(sql).toContain("INT AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("JSON NOT NULL");
    expect(sql).toContain("VARCHAR(255) NOT NULL");
  });
});
