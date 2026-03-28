/**
 * Prisma-compatible migration SQL generation for noddde persistence tables.
 *
 * Generates `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS`
 * statements for both shared noddde tables and per-aggregate dedicated tables.
 *
 * @module
 */

/**
 * Options for generating Prisma-compatible migration SQL.
 */
export interface PrismaMigrationOptions {
  /** Which shared noddde tables to include. */
  sharedTables?: {
    /** Include noddde_events table. Default: true. */
    events?: boolean;
    /** Include noddde_aggregate_states table. Default: true. */
    aggregateStates?: boolean;
    /** Include noddde_saga_states table. Default: true. */
    sagaStates?: boolean;
    /** Include noddde_snapshots table. Default: false. */
    snapshots?: boolean;
    /** Include noddde_outbox table. Default: false. */
    outbox?: boolean;
  };
  /** Per-aggregate state tables to include in the migration. */
  aggregateStateTables?: Record<
    string,
    {
      /** Table name in the database. */
      tableName: string;
      /** Custom column names. Defaults: aggregate_id, state, version. */
      columns?: {
        aggregateId?: string;
        state?: string;
        version?: string;
      };
    }
  >;
}

/** Supported SQL dialects. */
export type SqlDialect = "postgresql" | "mysql" | "sqlite";

interface DialectTypes {
  autoIncrementPk: string;
  text: string;
  textNotNull: string;
  nameColumn: string;
  jsonNotNull: string;
  jsonNullable: string;
  intNotNull: string;
  intNotNullDefault0: string;
  intNotNull_: string;
}

function dialectTypes(dialect: SqlDialect): DialectTypes {
  switch (dialect) {
    case "postgresql":
      return {
        autoIncrementPk: "SERIAL PRIMARY KEY",
        text: "TEXT",
        textNotNull: "TEXT NOT NULL",
        nameColumn: "TEXT NOT NULL",
        jsonNotNull: "JSONB NOT NULL",
        jsonNullable: "JSONB",
        intNotNull: "INTEGER NOT NULL",
        intNotNullDefault0: "INTEGER NOT NULL DEFAULT 0",
        intNotNull_: "INTEGER NOT NULL",
      };
    case "mysql":
      return {
        autoIncrementPk: "INT AUTO_INCREMENT PRIMARY KEY",
        text: "TEXT",
        textNotNull: "TEXT NOT NULL",
        nameColumn: "VARCHAR(255) NOT NULL",
        jsonNotNull: "JSON NOT NULL",
        jsonNullable: "JSON",
        intNotNull: "INTEGER NOT NULL",
        intNotNullDefault0: "INTEGER NOT NULL DEFAULT 0",
        intNotNull_: "INTEGER NOT NULL",
      };
    case "sqlite":
      return {
        autoIncrementPk: "INTEGER PRIMARY KEY AUTOINCREMENT",
        text: "TEXT",
        textNotNull: "TEXT NOT NULL",
        nameColumn: "TEXT NOT NULL",
        jsonNotNull: "TEXT NOT NULL",
        jsonNullable: "TEXT",
        intNotNull: "INTEGER NOT NULL",
        intNotNullDefault0: "INTEGER NOT NULL DEFAULT 0",
        intNotNull_: "INTEGER NOT NULL",
      };
  }
}

function eventsTableSql(d: DialectTypes): string {
  return `CREATE TABLE IF NOT EXISTS noddde_events (
  id ${d.autoIncrementPk},
  aggregate_name ${d.nameColumn},
  aggregate_id ${d.textNotNull},
  sequence_number ${d.intNotNull},
  event_name ${d.nameColumn},
  payload ${d.jsonNotNull},
  metadata ${d.jsonNullable}
);

CREATE UNIQUE INDEX IF NOT EXISTS noddde_events_stream_version_idx
  ON noddde_events (aggregate_name, aggregate_id, sequence_number);`;
}

function aggregateStatesTableSql(d: DialectTypes): string {
  return `CREATE TABLE IF NOT EXISTS noddde_aggregate_states (
  aggregate_name ${d.nameColumn},
  aggregate_id ${d.textNotNull},
  state ${d.jsonNotNull},
  version ${d.intNotNullDefault0},
  PRIMARY KEY (aggregate_name, aggregate_id)
);`;
}

function sagaStatesTableSql(d: DialectTypes): string {
  return `CREATE TABLE IF NOT EXISTS noddde_saga_states (
  saga_name ${d.nameColumn},
  saga_id ${d.textNotNull},
  state ${d.jsonNotNull},
  PRIMARY KEY (saga_name, saga_id)
);`;
}

function snapshotsTableSql(d: DialectTypes): string {
  return `CREATE TABLE IF NOT EXISTS noddde_snapshots (
  aggregate_name ${d.nameColumn},
  aggregate_id ${d.textNotNull},
  state ${d.jsonNotNull},
  version ${d.intNotNull_},
  PRIMARY KEY (aggregate_name, aggregate_id)
);`;
}

function outboxTableSql(d: DialectTypes): string {
  return `CREATE TABLE IF NOT EXISTS noddde_outbox (
  id ${d.textNotNull} PRIMARY KEY,
  event ${d.jsonNotNull},
  aggregate_name ${d.text},
  aggregate_id ${d.text},
  created_at ${d.textNotNull},
  published_at ${d.text}
);`;
}

function perAggregateStateTableSql(
  d: DialectTypes,
  tableName: string,
  columns?: { aggregateId?: string; state?: string; version?: string },
): string {
  const idCol = columns?.aggregateId ?? "aggregate_id";
  const stateCol = columns?.state ?? "state";
  const versionCol = columns?.version ?? "version";

  return `CREATE TABLE IF NOT EXISTS ${tableName} (
  ${idCol} ${d.textNotNull} PRIMARY KEY,
  ${stateCol} ${d.jsonNotNull},
  ${versionCol} ${d.intNotNullDefault0}
);`;
}

/**
 * Generates a Prisma-compatible migration SQL string.
 * Can be written to a migration directory for use with `prisma migrate` or applied directly.
 *
 * @param dialect - Target SQL dialect: `"postgresql"`, `"mysql"`, or `"sqlite"`.
 * @param options - Migration configuration. Defaults include the three shared tables.
 * @returns SQL string with `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` statements.
 *
 * @example
 * ```ts
 * import { generatePrismaMigration } from "@noddde/prisma";
 *
 * const sql = generatePrismaMigration("postgresql", {
 *   sharedTables: { snapshots: true, outbox: true },
 *   aggregateStateTables: {
 *     Order: { tableName: "orders" },
 *   },
 * });
 *
 * // Write to migration file
 * fs.writeFileSync("prisma/migrations/0001_init/migration.sql", sql);
 * ```
 */
export function generatePrismaMigration(
  dialect: SqlDialect,
  options?: PrismaMigrationOptions,
): string {
  const d = dialectTypes(dialect);
  const parts: string[] = [];

  const shared = options?.sharedTables ?? {};
  const includeEvents = shared.events !== false;
  const includeAggregateStates = shared.aggregateStates !== false;
  const includeSagaStates = shared.sagaStates !== false;
  const includeSnapshots = shared.snapshots === true;
  const includeOutbox = shared.outbox === true;

  parts.push(`-- Generated by @noddde/prisma for ${dialect}`);
  parts.push("");

  if (includeEvents) {
    parts.push("-- Shared event store");
    parts.push(eventsTableSql(d));
    parts.push("");
  }

  if (includeAggregateStates) {
    parts.push("-- Shared aggregate states");
    parts.push(aggregateStatesTableSql(d));
    parts.push("");
  }

  if (includeSagaStates) {
    parts.push("-- Shared saga states");
    parts.push(sagaStatesTableSql(d));
    parts.push("");
  }

  if (includeSnapshots) {
    parts.push("-- Snapshots");
    parts.push(snapshotsTableSql(d));
    parts.push("");
  }

  if (includeOutbox) {
    parts.push("-- Transactional outbox");
    parts.push(outboxTableSql(d));
    parts.push("");
  }

  if (options?.aggregateStateTables) {
    for (const [name, config] of Object.entries(options.aggregateStateTables)) {
      parts.push(`-- Per-aggregate state table: ${name}`);
      parts.push(
        perAggregateStateTableSql(d, config.tableName, config.columns),
      );
      parts.push("");
    }
  }

  return parts.join("\n").trimEnd() + "\n";
}
