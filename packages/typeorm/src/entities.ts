import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
} from "typeorm";

/**
 * TypeORM entity for event-sourced aggregate persistence.
 */
@Entity("noddde_events")
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

  @Column({ type: "text" })
  payload!: string;
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
