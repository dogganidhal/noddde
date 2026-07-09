import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  type ColumnOptions,
  type PrimaryColumnOptions,
  type DatabaseType,
} from "typeorm";

/**
 * JSON payloads are stored as serialized strings. On most dialects a plain
 * `text` column is Unicode-safe. MSSQL is the exception: TypeORM maps `text`
 * to the legacy `TEXT` column type, which is codepage-limited and silently
 * mangles characters outside the basic multilingual plane (emoji, etc.). MSSQL
 * therefore needs `nvarchar(max)`.
 *
 * These constants are the defaults used by the statically-declared entity
 * classes below (safe for postgres / mysql / sqlite). For MSSQL, use
 * {@link createNodddeEntities}, which returns entities whose JSON/text columns
 * are `nvarchar(max)`.
 */
const JSON_COLUMN_TYPE = { type: "text" as const };
const JSON_COLUMN_TYPE_NULLABLE = { type: "text" as const, nullable: true };

/**
 * Bidirectional transformer for nullable Date columns. We can't rely on
 * TypeORM's reflect-metadata inference here: `Date | null` collapses to
 * `Object` in the emit, and TypeORM throws `Data type "Object" not
 * supported`. Storing as ISO text via a transformer is portable across
 * every dialect we target.
 */
const NULLABLE_DATE_TRANSFORMER = {
  // Type as `unknown` because TypeORM also calls the transformer on
  // `FindOperator` values inside `where` clauses (e.g. `Not(IsNull())`).
  // We only convert real Date instances; anything else is passed through
  // so TypeORM can apply its own find-operator handling.
  to: (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (value == null) return null;
    return value;
  },
  from: (value: string | null): Date | null => (value ? new Date(value) : null),
};

/**
 * TypeORM entity for event-sourced aggregate persistence.
 */
@Entity("noddde_events")
@Index(["aggregateName", "aggregateId", "sequenceNumber"], { unique: true })
export class NodddeEventEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "aggregate_name" })
  aggregateName!: string;

  @Column({ name: "aggregate_id" })
  aggregateId!: string;

  @Column({ name: "sequence_number" })
  sequenceNumber!: number;

  @Column({ name: "event_name" })
  eventName!: string;

  @Column(JSON_COLUMN_TYPE)
  payload!: string;

  @Column(JSON_COLUMN_TYPE_NULLABLE)
  metadata!: string | null;

  // No explicit `type` — TypeORM picks the dialect-native datetime
  // (`datetime` on sqlite/mysql, `timestamp without time zone` on
  // postgres, `datetime2` on mssql).
  @Column({ name: "created_at" })
  createdAt!: Date;
}

/**
 * TypeORM entity for state-stored aggregate persistence.
 */
@Entity("noddde_aggregate_states")
export class NodddeAggregateStateEntity {
  @PrimaryColumn({ name: "aggregate_name" })
  aggregateName!: string;

  @PrimaryColumn({ name: "aggregate_id" })
  aggregateId!: string;

  @Column({ type: "text" })
  state!: string;

  @Column({ type: "int", default: 0 })
  version!: number;
}

/**
 * TypeORM entity for saga persistence.
 */
@Entity("noddde_saga_states")
export class NodddeSagaStateEntity {
  @PrimaryColumn({ name: "saga_name" })
  sagaName!: string;

  @PrimaryColumn({ name: "saga_id" })
  sagaId!: string;

  @Column({ type: "text" })
  state!: string;
}

/**
 * TypeORM entity for aggregate state snapshots.
 */
@Entity("noddde_snapshots")
export class NodddeSnapshotEntity {
  @PrimaryColumn({ name: "aggregate_name" })
  aggregateName!: string;

  @PrimaryColumn({ name: "aggregate_id" })
  aggregateId!: string;

  @Column({ type: "text" })
  state!: string;

  @Column({ type: "int" })
  version!: number;
}

/**
 * TypeORM entity for the transactional outbox.
 */
@Entity("noddde_outbox")
export class NodddeOutboxEntryEntity {
  @PrimaryColumn()
  id!: string;

  @Column({ type: "text" })
  event!: string;

  @Column({ name: "aggregate_name", type: "varchar", nullable: true })
  aggregateName!: string | null;

  @Column({ name: "aggregate_id", type: "varchar", nullable: true })
  aggregateId!: string | null;

  // No explicit `type` — TypeORM picks the dialect-native datetime.
  @Column({ name: "created_at" })
  createdAt!: Date;

  // Nullable Date: use a text-backed transformer (see comment above)
  // because TypeORM can't infer `Date | null`.
  @Column({
    name: "published_at",
    type: "text",
    nullable: true,
    transformer: NULLABLE_DATE_TRANSFORMER,
  })
  publishedAt!: Date | null;
}

/**
 * The set of TypeORM entity classes backing noddde's built-in stores. Register
 * every value on your `DataSource` and pass the same `DataSource` to
 * {@link createTypeORMAdapter}.
 */
export interface NodddeEntities {
  NodddeEventEntity: new () => NodddeEventEntity;
  NodddeAggregateStateEntity: new () => NodddeAggregateStateEntity;
  NodddeSagaStateEntity: new () => NodddeSagaStateEntity;
  NodddeSnapshotEntity: new () => NodddeSnapshotEntity;
  NodddeOutboxEntryEntity: new () => NodddeOutboxEntryEntity;
}

/** Column-type overrides used when building dialect-specific entity classes. */
interface EntityColumnTypes {
  /** Large serialized-JSON / text columns (payload, metadata, state, event). */
  json: ColumnOptions;
  /** Bounded string columns used as primary keys / index members and ids. */
  key: ColumnOptions;
  /** Non-nullable datetime column (created_at). */
  datetime: ColumnOptions;
  /** Nullable, text-backed date column (published_at) — keeps the transformer. */
  publishedAt: ColumnOptions;
}

/**
 * Programmatically builds a fresh set of entity classes with the given
 * column types. Decorators are applied imperatively (rather than via `@`
 * syntax) so the column types can be chosen at call time from `types`. Every
 * column specifies an explicit `type`, so no `reflect-metadata` design-type
 * inference is required.
 *
 * Keep the columns here in sync with the statically-declared classes above.
 */
function buildEntities(types: EntityColumnTypes): NodddeEntities {
  const key = (name?: string): ColumnOptions =>
    name ? { name, ...types.key } : { ...types.key };
  // PrimaryColumn accepts a narrower options type than Column; the shared
  // `types.key` (type + length) is valid for both, so cast at the PK sites.
  const pk = (name?: string): PrimaryColumnOptions =>
    key(name) as PrimaryColumnOptions;

  class NodddeEventEntity {
    id!: number;
    aggregateName!: string;
    aggregateId!: string;
    sequenceNumber!: number;
    eventName!: string;
    payload!: string;
    metadata!: string | null;
    createdAt!: Date;
  }
  PrimaryGeneratedColumn()(NodddeEventEntity.prototype, "id");
  Column(key("aggregate_name"))(NodddeEventEntity.prototype, "aggregateName");
  Column(key("aggregate_id"))(NodddeEventEntity.prototype, "aggregateId");
  Column({ name: "sequence_number", type: "int" })(
    NodddeEventEntity.prototype,
    "sequenceNumber",
  );
  Column(key("event_name"))(NodddeEventEntity.prototype, "eventName");
  Column({ ...types.json })(NodddeEventEntity.prototype, "payload");
  Column({ ...types.json, nullable: true })(
    NodddeEventEntity.prototype,
    "metadata",
  );
  Column({ name: "created_at", ...types.datetime })(
    NodddeEventEntity.prototype,
    "createdAt",
  );
  Index(["aggregateName", "aggregateId", "sequenceNumber"], { unique: true })(
    NodddeEventEntity,
  );
  Entity("noddde_events")(NodddeEventEntity);

  class NodddeAggregateStateEntity {
    aggregateName!: string;
    aggregateId!: string;
    state!: string;
    version!: number;
  }
  PrimaryColumn(pk("aggregate_name"))(
    NodddeAggregateStateEntity.prototype,
    "aggregateName",
  );
  PrimaryColumn(pk("aggregate_id"))(
    NodddeAggregateStateEntity.prototype,
    "aggregateId",
  );
  Column({ ...types.json })(NodddeAggregateStateEntity.prototype, "state");
  Column({ type: "int", default: 0 })(
    NodddeAggregateStateEntity.prototype,
    "version",
  );
  Entity("noddde_aggregate_states")(NodddeAggregateStateEntity);

  class NodddeSagaStateEntity {
    sagaName!: string;
    sagaId!: string;
    state!: string;
  }
  PrimaryColumn(pk("saga_name"))(NodddeSagaStateEntity.prototype, "sagaName");
  PrimaryColumn(pk("saga_id"))(NodddeSagaStateEntity.prototype, "sagaId");
  Column({ ...types.json })(NodddeSagaStateEntity.prototype, "state");
  Entity("noddde_saga_states")(NodddeSagaStateEntity);

  class NodddeSnapshotEntity {
    aggregateName!: string;
    aggregateId!: string;
    state!: string;
    version!: number;
  }
  PrimaryColumn(pk("aggregate_name"))(
    NodddeSnapshotEntity.prototype,
    "aggregateName",
  );
  PrimaryColumn(pk("aggregate_id"))(
    NodddeSnapshotEntity.prototype,
    "aggregateId",
  );
  Column({ ...types.json })(NodddeSnapshotEntity.prototype, "state");
  Column({ type: "int" })(NodddeSnapshotEntity.prototype, "version");
  Entity("noddde_snapshots")(NodddeSnapshotEntity);

  class NodddeOutboxEntryEntity {
    id!: string;
    event!: string;
    aggregateName!: string | null;
    aggregateId!: string | null;
    createdAt!: Date;
    publishedAt!: Date | null;
  }
  PrimaryColumn(pk())(NodddeOutboxEntryEntity.prototype, "id");
  Column({ ...types.json })(NodddeOutboxEntryEntity.prototype, "event");
  Column({ name: "aggregate_name", ...types.key, nullable: true })(
    NodddeOutboxEntryEntity.prototype,
    "aggregateName",
  );
  Column({ name: "aggregate_id", ...types.key, nullable: true })(
    NodddeOutboxEntryEntity.prototype,
    "aggregateId",
  );
  Column({ name: "created_at", ...types.datetime })(
    NodddeOutboxEntryEntity.prototype,
    "createdAt",
  );
  Column({
    name: "published_at",
    ...types.publishedAt,
    nullable: true,
    transformer: NULLABLE_DATE_TRANSFORMER,
  })(NodddeOutboxEntryEntity.prototype, "publishedAt");
  Entity("noddde_outbox")(NodddeOutboxEntryEntity);

  return {
    NodddeEventEntity,
    NodddeAggregateStateEntity,
    NodddeSagaStateEntity,
    NodddeSnapshotEntity,
    NodddeOutboxEntryEntity,
  };
}

/** The statically-declared (default) entity classes. */
const STATIC_ENTITIES: NodddeEntities = {
  NodddeEventEntity,
  NodddeAggregateStateEntity,
  NodddeSagaStateEntity,
  NodddeSnapshotEntity,
  NodddeOutboxEntryEntity,
};

/**
 * Returns the TypeORM entity classes to register on a `DataSource`, with
 * column types chosen for the given database dialect.
 *
 * - **MSSQL** (`"mssql"`): JSON/text columns use `nvarchar(max)` and string
 *   keys use `nvarchar(255)`, so supplementary-plane Unicode (emoji, etc.) in
 *   event payloads round-trips correctly. MSSQL's legacy `text` column would
 *   otherwise silently corrupt such characters.
 * - **Every other dialect** (postgres, mysql, mariadb, sqlite, …) and when the
 *   dialect is omitted: the default classes, whose `text` columns are already
 *   Unicode-safe. Returned unchanged, so there is no schema difference from
 *   registering the exported entity classes directly.
 *
 * Register the returned classes on your `DataSource` and pass that same
 * `DataSource` to {@link createTypeORMAdapter}; the adapter resolves each store
 * by table name, so it works with whichever variant you register.
 *
 * @example
 * ```ts
 * const entities = createNodddeEntities("mssql");
 * const dataSource = new DataSource({
 *   type: "mssql",
 *   entities: Object.values(entities),
 *   // ...connection options
 * });
 * await dataSource.initialize();
 * const adapter = createTypeORMAdapter(dataSource, { outboxStore: true });
 * ```
 */
export function createNodddeEntities(dialect?: DatabaseType): NodddeEntities {
  if (dialect === "mssql") {
    return buildEntities({
      json: { type: "nvarchar", length: "MAX" },
      key: { type: "nvarchar", length: "255" },
      datetime: { type: "datetime2" },
      // published_at holds ISO date strings (ASCII); nvarchar(max) keeps it
      // consistent with the other text columns and never truncates.
      publishedAt: { type: "nvarchar", length: "MAX" },
    });
  }
  return STATIC_ENTITIES;
}
