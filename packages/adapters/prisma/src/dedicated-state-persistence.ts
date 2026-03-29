/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import {
  ConcurrencyError,
  type StateStoredAggregatePersistence,
} from "@noddde/core";
import type { PrismaTransactionStore } from "./unit-of-work";
import type { PrismaStateTableColumnMap } from "./builder";

/**
 * Prisma-backed state-stored aggregate persistence bound to a
 * dedicated per-aggregate Prisma model. Unlike the shared persistence,
 * this class ignores the `aggregateName` parameter — the model
 * itself is the namespace.
 *
 * Supports custom column mappings for models where property names
 * differ from the noddde convention.
 */
export class PrismaDedicatedStateStoredPersistence
  implements StateStoredAggregatePersistence
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly txStore: PrismaTransactionStore,
    private readonly modelName: string,
    private readonly columns: PrismaStateTableColumnMap,
  ) {}

  private getDelegate(): any {
    const executor = this.txStore.current ?? this.prisma;
    return (executor as any)[this.modelName];
  }

  async save(
    _aggregateName: string,
    aggregateId: string,
    state: any,
    expectedVersion: number,
  ): Promise<void> {
    const delegate = this.getDelegate();
    const serialized = JSON.stringify(state);

    if (expectedVersion === 0) {
      // Insert path: new aggregate
      try {
        await delegate.create({
          data: {
            [this.columns.aggregateId]: aggregateId,
            [this.columns.state]: serialized,
            [this.columns.version]: 1,
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
          [this.columns.aggregateId]: aggregateId,
          [this.columns.version]: expectedVersion,
        },
        data: {
          [this.columns.state]: serialized,
          [this.columns.version]: expectedVersion + 1,
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
  ): Promise<{ state: any; version: number } | null> {
    const delegate = this.getDelegate();

    const row = await delegate.findFirst({
      where: { [this.columns.aggregateId]: aggregateId },
    });

    if (!row) return null;

    const stateValue = row[this.columns.state];
    const versionValue = row[this.columns.version];

    return {
      state:
        typeof stateValue === "string" ? JSON.parse(stateValue) : stateValue,
      version: versionValue,
    };
  }
}
