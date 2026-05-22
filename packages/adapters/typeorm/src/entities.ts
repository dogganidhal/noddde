import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
} from "typeorm";

/**
 * MSSQL needs `nvarchar(max)` for Unicode-safe JSON storage; `text` is
 * legacy and ASCII-only there. For every other dialect, plain `text`
 * is correct. `simple-json`-style column types would be more idiomatic
 * but break the JSON-string round-trip the persistence layer relies on.
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
