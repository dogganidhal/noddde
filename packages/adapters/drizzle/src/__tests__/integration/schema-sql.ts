/**
 * SQL DDL used by integration tests to materialize the tables that
 * `@noddde/drizzle`'s shipped schemas expect. The framework itself ships
 * schema *definitions* (drizzle table objects), not migrations — apps
 * are expected to manage their own migrations. For tests we issue the
 * equivalent CREATE TABLE statements explicitly.
 */
export const SQLITE_DDL = `
  CREATE TABLE IF NOT EXISTS noddde_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    payload TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS noddde_events_stream_version_idx
    ON noddde_events (aggregate_name, aggregate_id, sequence_number);
  CREATE TABLE IF NOT EXISTS noddde_aggregate_states (
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    state TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (aggregate_name, aggregate_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_saga_states (
    saga_name TEXT NOT NULL,
    saga_id TEXT NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (saga_name, saga_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_snapshots (
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    state TEXT NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY (aggregate_name, aggregate_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_outbox (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    aggregate_name TEXT,
    aggregate_id TEXT,
    created_at TEXT NOT NULL,
    published_at TEXT
  );
`;

export const POSTGRES_DDL = `
  CREATE TABLE IF NOT EXISTS noddde_events (
    id SERIAL PRIMARY KEY,
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS noddde_events_stream_version_idx
    ON noddde_events (aggregate_name, aggregate_id, sequence_number);
  CREATE TABLE IF NOT EXISTS noddde_aggregate_states (
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    state JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (aggregate_name, aggregate_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_saga_states (
    saga_name TEXT NOT NULL,
    saga_id TEXT NOT NULL,
    state JSONB NOT NULL,
    PRIMARY KEY (saga_name, saga_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_snapshots (
    aggregate_name TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    state JSONB NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY (aggregate_name, aggregate_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_outbox (
    id TEXT PRIMARY KEY,
    event JSONB NOT NULL,
    aggregate_name TEXT,
    aggregate_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
  );
`;

export const MYSQL_DDL = `
  CREATE TABLE IF NOT EXISTS noddde_events (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    aggregate_name VARCHAR(255) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    sequence_number INT NOT NULL,
    event_name VARCHAR(255) NOT NULL,
    payload JSON NOT NULL,
    metadata JSON,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY noddde_events_stream_version_idx (aggregate_name, aggregate_id, sequence_number)
  );
  CREATE TABLE IF NOT EXISTS noddde_aggregate_states (
    aggregate_name VARCHAR(255) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    state TEXT NOT NULL,
    version INT NOT NULL DEFAULT 0,
    PRIMARY KEY (aggregate_name, aggregate_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_saga_states (
    saga_name VARCHAR(255) NOT NULL,
    saga_id VARCHAR(255) NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (saga_name, saga_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_snapshots (
    aggregate_name VARCHAR(255) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    state TEXT NOT NULL,
    version INT NOT NULL,
    PRIMARY KEY (aggregate_name, aggregate_id)
  );
  CREATE TABLE IF NOT EXISTS noddde_outbox (
    id VARCHAR(255) PRIMARY KEY,
    event JSON NOT NULL,
    aggregate_name VARCHAR(255),
    aggregate_id VARCHAR(255),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    published_at TIMESTAMP(3) NULL
  );
`;

/** Wipes every noddde table between tests, regardless of dialect. */
export const TRUNCATE_STATEMENTS = [
  "DELETE FROM noddde_events",
  "DELETE FROM noddde_aggregate_states",
  "DELETE FROM noddde_saga_states",
  "DELETE FROM noddde_snapshots",
  "DELETE FROM noddde_outbox",
];
