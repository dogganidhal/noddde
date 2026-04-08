/* eslint-disable no-unused-vars */
import type {
  PersistenceAdapter,
  EventSourcedAggregatePersistence,
  StateStoredAggregatePersistence,
  SagaPersistence,
  UnitOfWorkFactory,
  SnapshotStore,
  OutboxStore,
  AggregateLocker,
} from "@noddde/core";
import type { DrizzleTransactionStore } from "./index";
import type { StateTableColumnMap } from "./builder";
import {
  DrizzleEventSourcedAggregatePersistence,
  DrizzleStateStoredAggregatePersistence,
  DrizzleSagaPersistence,
  DrizzleSnapshotStore,
  DrizzleOutboxStore,
} from "./persistence";
import { DrizzleDedicatedStateStoredPersistence } from "./dedicated-state-persistence";
import { createDrizzleUnitOfWorkFactory } from "./unit-of-work";
import { resolveColumns } from "./column-resolver";
import { DrizzleAdvisoryLocker } from "./advisory-locker";
import type { DrizzleDialect } from "./advisory-locker";

// Static imports of pre-built schemas for all dialects
import * as pgSchema from "./pg/schema";
import * as sqliteSchema from "./sqlite/schema";
import * as mysqlSchema from "./mysql/schema";

/**
 * Optional configuration for {@link DrizzleAdapter}.
 * When omitted, tables are auto-resolved from the dialect.
 */
export interface DrizzleAdapterOptions {
  /** Override auto-resolved table definitions. Partial — only override what you need. */
  tables?: {
    eventStore?: any;
    stateStore?: any;
    sagaStore?: any;
    snapshotStore?: any;
    outboxStore?: any;
  };
}

/**
 * Infers the Drizzle dialect from a database instance.
 * Uses the internal `_.dialect` property that Drizzle sets.
 * @internal
 */
function inferDialect(db: any): DrizzleDialect {
  const dialectName = db?._.dialect?.constructor?.name ?? db?.dialect?.name;
  if (!dialectName) {
    throw new Error(
      "Could not infer dialect from Drizzle db instance. " +
        "Ensure you are passing a valid Drizzle database instance.",
    );
  }

  const normalized = dialectName.toLowerCase();
  if (normalized.includes("pg") || normalized.includes("postgres")) {
    return "pg";
  }
  if (normalized.includes("mysql")) {
    return "mysql";
  }
  if (normalized.includes("sqlite")) {
    return "sqlite";
  }

  throw new Error(
    `Unrecognized Drizzle dialect: "${dialectName}". ` +
      "Supported dialects: pg, mysql, sqlite.",
  );
}

/**
 * Returns pre-built schema tables for the given dialect.
 * @internal
 */
function getSchemaForDialect(dialect: DrizzleDialect) {
  switch (dialect) {
    case "pg":
      return pgSchema;
    case "mysql":
      return mysqlSchema;
    case "sqlite":
      return sqliteSchema;
  }
}

/**
 * Drizzle-backed persistence adapter implementing {@link PersistenceAdapter}.
 *
 * Infers the database dialect from the Drizzle `db` instance (via internal
 * dialect property) and auto-resolves pre-built table schemas for that dialect.
 * All persistence stores are created eagerly in the constructor.
 *
 * @example
 * ```ts
 * import { DrizzleAdapter } from "@noddde/drizzle";
 * import { wireDomain } from "@noddde/engine";
 *
 * const adapter = new DrizzleAdapter(db);
 * const domain = await wireDomain(definition, { persistenceAdapter: adapter });
 * ```
 */
export class DrizzleAdapter implements PersistenceAdapter {
  readonly unitOfWorkFactory: UnitOfWorkFactory;
  readonly eventSourcedPersistence: EventSourcedAggregatePersistence;
  readonly stateStoredPersistence: StateStoredAggregatePersistence;
  readonly sagaPersistence: SagaPersistence;
  readonly snapshotStore: SnapshotStore;
  readonly outboxStore: OutboxStore;
  readonly aggregateLocker?: AggregateLocker;

  private readonly txStore: DrizzleTransactionStore;
  private readonly db: any;
  private readonly dialect: DrizzleDialect;

  constructor(db: any, options?: DrizzleAdapterOptions) {
    this.db = db;
    this.dialect = inferDialect(db);
    this.txStore = { current: null };

    const defaultSchema = getSchemaForDialect(this.dialect);
    const tables = options?.tables ?? {};

    const schema: any = {
      events: tables.eventStore ?? defaultSchema.events,
      aggregateStates: tables.stateStore ?? defaultSchema.aggregateStates,
      sagaStates: tables.sagaStore ?? defaultSchema.sagaStates,
      snapshots: tables.snapshotStore ?? defaultSchema.snapshots,
      outbox: tables.outboxStore ?? defaultSchema.outbox,
    };

    this.eventSourcedPersistence = new DrizzleEventSourcedAggregatePersistence(
      db,
      this.txStore,
      schema,
    );
    this.stateStoredPersistence = new DrizzleStateStoredAggregatePersistence(
      db,
      this.txStore,
      schema,
    );
    this.sagaPersistence = new DrizzleSagaPersistence(db, this.txStore, schema);
    this.snapshotStore = new DrizzleSnapshotStore(db, this.txStore, schema);
    this.outboxStore = new DrizzleOutboxStore(db, this.txStore, schema);
    this.unitOfWorkFactory = createDrizzleUnitOfWorkFactory(db, this.txStore);

    // Advisory locker only for PG and MySQL
    if (this.dialect === "pg" || this.dialect === "mysql") {
      this.aggregateLocker = new DrizzleAdvisoryLocker(db, this.dialect);
    }
  }

  /**
   * Returns a {@link StateStoredAggregatePersistence} bound to a dedicated
   * Drizzle table. Use this when an aggregate needs its own state table
   * instead of the shared one.
   *
   * @param table - A Drizzle table definition.
   * @param columns - Optional column mapping overrides.
   * @returns A persistence implementation bound to the given table.
   */
  stateStored(
    table: any,
    columns?: Partial<StateTableColumnMap>,
  ): StateStoredAggregatePersistence {
    const resolvedColumns = resolveColumns(table, "(dedicated)", columns);
    return new DrizzleDedicatedStateStoredPersistence(
      this.db,
      this.txStore,
      table,
      resolvedColumns,
    );
  }

  /**
   * No-op — Drizzle does not own the database connection.
   * The caller is responsible for closing the underlying pool.
   */
  async close(): Promise<void> {
    // No-op: Drizzle doesn't own the connection
  }
}
