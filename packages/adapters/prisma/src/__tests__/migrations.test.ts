import { describe, it, expect } from "vitest";
import { generatePrismaMigration } from "@noddde/prisma";

describe("generatePrismaMigration", () => {
  it("should generate default shared tables for sqlite", () => {
    const sql = generatePrismaMigration("sqlite");

    expect(sql).toContain("noddde_events");
    expect(sql).toContain("noddde_aggregate_states");
    expect(sql).toContain("noddde_saga_states");
    expect(sql).not.toContain("noddde_snapshots");
    expect(sql).not.toContain("noddde_outbox");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
  });

  it("should include optional tables when requested", () => {
    const sql = generatePrismaMigration("sqlite", {
      sharedTables: { snapshots: true, outbox: true },
    });

    expect(sql).toContain("noddde_snapshots");
    expect(sql).toContain("noddde_outbox");
  });

  it("should generate per-aggregate state tables", () => {
    const sql = generatePrismaMigration("sqlite", {
      aggregateStateTables: {
        Order: { tableName: "orders" },
        BankAccount: {
          tableName: "bank_accounts",
          columns: { aggregateId: "account_id" },
        },
      },
    });

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS orders");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bank_accounts");
    expect(sql).toContain("account_id");
  });

  it("should use PostgreSQL types for postgresql dialect", () => {
    const sql = generatePrismaMigration("postgresql");

    expect(sql).toContain("SERIAL PRIMARY KEY");
    expect(sql).toContain("JSONB NOT NULL");
    expect(sql).toContain("TEXT NOT NULL");
  });

  it("should use MySQL types for mysql dialect", () => {
    const sql = generatePrismaMigration("mysql");

    expect(sql).toContain("INT AUTO_INCREMENT PRIMARY KEY");
    expect(sql).toContain("JSON NOT NULL");
    expect(sql).toContain("VARCHAR(255) NOT NULL");
  });
});
