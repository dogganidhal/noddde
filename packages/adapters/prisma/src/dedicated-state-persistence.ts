/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import {
  ConcurrencyError,
  type StateStoredAggregatePersistence,
} from "@noddde/core";
import type { PrismaTransactionStore } from "./unit-of-work";
import type { PrismaStateMapper } from "./builder";

/**
 * Prisma-backed state-stored aggregate persistence bound to a
 * dedicated per-aggregate Prisma model. Unlike the shared persistence,
 * this class ignores the `aggregateName` parameter — the model
 * itself is the namespace.
 *
 * All state encoding/decoding is delegated to the provided
 * {@link PrismaStateMapper}. The adapter writes the aggregate id
 * and version columns itself using the property names declared on the mapper.
 */
export class PrismaDedicatedStateStoredPersistence
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
    private readonly modelName: string,
    private readonly mapper: PrismaStateMapper<
      unknown,
      Record<string, unknown>
    >,
  ) {}

  private getDelegate(): any {
    const executor = this.txStore.current ?? this.prisma;
    return (executor as any)[this.modelName];
  }

  async save(
    _aggregateName: string,
    aggregateId: string,
    state: unknown,
    expectedVersion: number,
  ): Promise<void> {
    const delegate = this.getDelegate();
    const stateRow = this.mapper.toRow(state);

    if (expectedVersion === 0) {
      // Insert path: new aggregate
      try {
        await delegate.create({
          data: {
            ...stateRow,
            [this.mapper.aggregateIdField]: aggregateId,
            [this.mapper.versionField]: 1,
          },
        });
      } catch (error: any) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as any).code === "P2002"
        ) {
          throw new ConcurrencyError(
            _aggregateName,
            aggregateId,
            expectedVersion,
            -1,
          );
        }
        throw error;
      }
    } else {
      // Update path: optimistic concurrency check via version match
      const result = await delegate.updateMany({
        where: {
          [this.mapper.aggregateIdField]: aggregateId,
          [this.mapper.versionField]: expectedVersion,
        },
        data: {
          ...stateRow,
          [this.mapper.versionField]: expectedVersion + 1,
        },
      });

      if (result.count === 0) {
        throw new ConcurrencyError(
          _aggregateName,
          aggregateId,
          expectedVersion,
          -1,
        );
      }
    }
  }

  async load(
    _aggregateName: string,
    aggregateId: string,
  ): Promise<{ state: unknown; version: number } | null> {
    const delegate = this.getDelegate();

    const row = await delegate.findFirst({
      where: { [this.mapper.aggregateIdField]: aggregateId },
    });

    if (!row) return null;

    const version: number = row[this.mapper.versionField];

    // Strip the id and version properties before handing the row to the mapper
    const {
      [this.mapper.aggregateIdField]: _id,
      [this.mapper.versionField]: _ver,
      ...stateRow
    } = row;

    const state = this.mapper.fromRow(stateRow);

    return { state, version };
  }
}
