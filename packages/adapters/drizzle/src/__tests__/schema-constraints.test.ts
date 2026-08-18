import { describe, it, expect } from "vitest";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import * as pg from "../pg/schema";
import * as mysql from "../mysql/schema";
import * as sqlite from "../sqlite/schema";

/**
 * Introspects the exported table objects directly (rather than re-deriving
 * DDL) so a future edit that silently drops a constraint fails here instead
 * of only being caught by the hand-written integration-test DDL agreeing
 * with itself. This is the regression guard for issue #130 (Drizzle's
 * shipped schemas had no PK on aggregate_states/saga_states/snapshots).
 */
function pkColumnNames(config: { primaryKeys: any[] }): string[] {
  if (config.primaryKeys.length === 0) return [];
  return config.primaryKeys[0].columns.map((c: any) => c.name).sort();
}

function indexedColumnNames(config: { indexes: any[] }): string[] {
  return config.indexes.flatMap((idx: any) =>
    idx.config.columns.map((c: any) => c.name),
  );
}

describe("Drizzle schema constraints (issue #130)", () => {
  describe("pg", () => {
    it("aggregateStates has a composite PK", () => {
      expect(pkColumnNames(pgTableConfig(pg.aggregateStates))).toEqual(
        ["aggregate_id", "aggregate_name"].sort(),
      );
    });
    it("sagaStates has a composite PK", () => {
      expect(pkColumnNames(pgTableConfig(pg.sagaStates))).toEqual(
        ["saga_id", "saga_name"].sort(),
      );
    });
    it("snapshots has a composite PK", () => {
      expect(pkColumnNames(pgTableConfig(pg.snapshots))).toEqual(
        ["aggregate_id", "aggregate_name"].sort(),
      );
    });
    it("outbox has an indexed event_id column", () => {
      expect(pg.outbox.eventId).toBeDefined();
      expect(indexedColumnNames(pgTableConfig(pg.outbox))).toContain(
        "event_id",
      );
    });
  });

  describe("mysql", () => {
    it("aggregateStates has a composite PK", () => {
      expect(pkColumnNames(mysqlTableConfig(mysql.aggregateStates))).toEqual(
        ["aggregate_id", "aggregate_name"].sort(),
      );
    });
    it("sagaStates has a composite PK", () => {
      expect(pkColumnNames(mysqlTableConfig(mysql.sagaStates))).toEqual(
        ["saga_id", "saga_name"].sort(),
      );
    });
    it("snapshots has a composite PK", () => {
      expect(pkColumnNames(mysqlTableConfig(mysql.snapshots))).toEqual(
        ["aggregate_id", "aggregate_name"].sort(),
      );
    });
    it("outbox has an indexed event_id column", () => {
      expect(mysql.outbox.eventId).toBeDefined();
      expect(indexedColumnNames(mysqlTableConfig(mysql.outbox))).toContain(
        "event_id",
      );
    });
  });

  describe("sqlite", () => {
    it("aggregateStates has a composite PK", () => {
      expect(pkColumnNames(sqliteTableConfig(sqlite.aggregateStates))).toEqual(
        ["aggregate_id", "aggregate_name"].sort(),
      );
    });
    it("sagaStates has a composite PK", () => {
      expect(pkColumnNames(sqliteTableConfig(sqlite.sagaStates))).toEqual(
        ["saga_id", "saga_name"].sort(),
      );
    });
    it("snapshots has a composite PK", () => {
      expect(pkColumnNames(sqliteTableConfig(sqlite.snapshots))).toEqual(
        ["aggregate_id", "aggregate_name"].sort(),
      );
    });
    it("outbox has an indexed event_id column", () => {
      expect(sqlite.outbox.eventId).toBeDefined();
      expect(indexedColumnNames(sqliteTableConfig(sqlite.outbox))).toContain(
        "event_id",
      );
    });
  });
});
