---
title: "OutboxStore & OutboxEntry"
module: persistence/outbox
source_file: packages/core/src/persistence/outbox.ts
status: implemented
exports:
  - OutboxEntry
  - OutboxStore
depends_on:
  - edd/event
docs:
  - domain-configuration/adapters.mdx
---

# OutboxStore & OutboxEntry

> Defines the transactional outbox interfaces for guaranteed at-least-once event delivery. An `OutboxStore` persists domain events atomically within the same Unit of Work as aggregate persistence. A background relay reads unpublished entries and dispatches them via the `EventBus`. If the node crashes after database commit but before event publishing, the relay recovers the unpublished events on restart.

## Type Contract

```ts
import type { Event } from "../edd";

/**
 * A single outbox entry representing a domain event pending publication.
 * Written atomically with aggregate persistence within a UnitOfWork.
 * Read by the OutboxRelay for guaranteed delivery.
 */
interface OutboxEntry {
  /** Unique entry identifier (UUID v7, time-ordered). */
  id: string;
  /** The fully enriched domain event to publish. */
  event: Event;
  /** Which aggregate type produced this event (for debugging/filtering). Optional because standalone command handlers may not have aggregate context. */
  aggregateName?: string;
  /** Which aggregate instance produced this event (for debugging/filtering). Optional for the same reason. */
  aggregateId?: string;
  /** ISO 8601 timestamp of when the entry was created. */
  createdAt: string;
  /** ISO 8601 timestamp of when the entry was published, or null if pending. */
  publishedAt: string | null;
}

/**
 * Storage interface for the transactional outbox.
 * Implementations must support atomic writes within a UnitOfWork
 * and polling reads for the OutboxRelay.
 */
interface OutboxStore {
  /**
   * Persists one or more outbox entries. Designed to be called within
   * a UoW's enlisted operation to ensure atomicity with aggregate persistence.
   *
   * @param entries - The outbox entries to persist.
   */
  save(entries: OutboxEntry[]): Promise<void>;

  /**
   * Loads unpublished entries ordered by createdAt (oldest first).
   * Used by the OutboxRelay to poll for pending events.
   *
   * @param batchSize - Maximum number of entries to return. Defaults to 100.
   */
  loadUnpublished(batchSize?: number): Promise<OutboxEntry[]>;

  /**
   * Marks entries as published by setting their publishedAt timestamp.
   * Called after the relay successfully dispatches the events.
   *
   * @param ids - The entry IDs to mark as published.
   */
  markPublished(ids: string[]): Promise<void>;

  /**
   * Marks entries as published by matching on their event's metadata.eventId.
   * Used for happy-path post-dispatch marking where only the dispatched
   * Event[] is available (outbox entry IDs are not accessible to the caller).
   *
   * @param eventIds - The event metadata eventIds to match.
   */
  markPublishedByEventIds(eventIds: string[]): Promise<void>;

  /**
   * Removes published entries older than the given date.
   * Used for periodic cleanup to prevent unbounded growth.
   *
   * @param olderThan - Cutoff date. Published entries created before this
   *   date are removed. If omitted, all published entries are removed.
   */
  deletePublished(olderThan?: Date): Promise<void>;
}
```

- `OutboxEntry.event` stores the fully enriched event (with metadata). The outbox does not modify or re-enrich events.
- `OutboxEntry.aggregateName` and `aggregateId` are optional convenience fields extracted from `event.metadata` for debugging and operational queries. They are not used by the relay.
- `OutboxEntry.publishedAt` is `null` when the entry is pending and set to an ISO 8601 timestamp when published. This is the primary discriminator for `loadUnpublished`.
- `markPublishedByEventIds` exists because after `uow.commit()`, the Domain has the dispatched `Event[]` but not the outbox entry IDs (those were generated inside the `onEventsProduced` callback closure). Using `event.metadata.eventId` as a correlation key avoids threading entry IDs through the UoW.

## Behavioral Requirements

1. **save persists entries atomically** -- `save(entries)` stores all provided entries. It is designed to be enlisted in a `UnitOfWork` so that outbox writes commit atomically with aggregate persistence.
2. **loadUnpublished returns pending entries ordered by createdAt** -- Returns entries where `publishedAt === null`, sorted by `createdAt` ascending (oldest first). Limited by `batchSize` (defaults to 100 if omitted).
3. **markPublished sets publishedAt for matching entry IDs** -- For each entry ID in `ids`, sets `publishedAt` to the current ISO 8601 timestamp. Non-matching IDs are silently ignored.
4. **markPublishedByEventIds matches on event metadata** -- For each `eventId`, finds entries whose `event.metadata.eventId` matches and sets their `publishedAt`. Non-matching event IDs are silently ignored.
5. **deletePublished removes old published entries** -- Removes entries where `publishedAt !== null` and `createdAt < olderThan`. If `olderThan` is omitted, removes all published entries regardless of age.
6. **loadUnpublished respects batchSize** -- If there are more unpublished entries than `batchSize`, only the oldest `batchSize` entries are returned.

## Invariants

- Entries saved via `save()` always have `publishedAt === null` (they are unpublished by definition).
- `loadUnpublished` never returns entries where `publishedAt !== null`.
- `loadUnpublished` ordering is deterministic: oldest `createdAt` first.
- `markPublished` and `markPublishedByEventIds` are idempotent: marking an already-published entry again is a no-op.
- `deletePublished` never removes unpublished entries.

## Edge Cases

- **save with empty array** -- `save([])` is a no-op. No entries are stored.
- **loadUnpublished with no pending entries** -- Returns `[]`.
- **loadUnpublished with batchSize 0** -- Returns `[]`.
- **markPublished with empty array** -- `markPublished([])` is a no-op.
- **markPublished with non-existent IDs** -- Silently ignored. No error thrown.
- **markPublishedByEventIds with non-existent event IDs** -- Silently ignored.
- **markPublished on already-published entry** -- No-op for that entry. `publishedAt` is not updated.
- **deletePublished with no published entries** -- No-op.
- **deletePublished without olderThan** -- Removes ALL published entries.
- **Entries with same createdAt** -- Ordering among same-timestamp entries is implementation-defined but deterministic within a single store instance.

## Integration Points

- **UnitOfWork** -- `outboxStore.save(entries)` is enlisted as a UoW operation via `uow.enlist(() => outboxStore.save(entries))`. This ensures outbox writes commit atomically with aggregate persistence.
- **CommandLifecycleExecutor** -- The Domain's `onEventsProduced` callback creates `OutboxEntry` objects from enriched events and enlists `save()` on the UoW.
- **OutboxRelay** -- Polls `loadUnpublished()`, dispatches events via `EventBus`, then calls `markPublished()`.
- **Domain post-dispatch** -- After dispatching events in the happy path, calls `markPublishedByEventIds()` (best-effort) so the relay doesn't re-dispatch them.
- **DomainWiring** -- Configured via `outbox` factory.

## Test Scenarios

### OutboxStore interface has the correct shape

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { OutboxStore, OutboxEntry, Event } from "@noddde/core";

describe("OutboxStore Interface", () => {
  it("should have save accepting OutboxEntry array", () => {
    expectTypeOf<OutboxStore["save"]>().toBeFunction();
    expectTypeOf<OutboxStore["save"]>()
      .parameter(0)
      .toMatchTypeOf<OutboxEntry[]>();
    expectTypeOf<OutboxStore["save"]>().returns.toMatchTypeOf<Promise<void>>();
  });

  it("should have loadUnpublished returning Promise of OutboxEntry array", () => {
    expectTypeOf<OutboxStore["loadUnpublished"]>().toBeFunction();
    expectTypeOf<OutboxStore["loadUnpublished"]>().returns.toMatchTypeOf<
      Promise<OutboxEntry[]>
    >();
  });

  it("should have markPublished accepting string array", () => {
    expectTypeOf<OutboxStore["markPublished"]>().toBeFunction();
    expectTypeOf<OutboxStore["markPublished"]>()
      .parameter(0)
      .toMatchTypeOf<string[]>();
    expectTypeOf<OutboxStore["markPublished"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });

  it("should have markPublishedByEventIds accepting string array", () => {
    expectTypeOf<OutboxStore["markPublishedByEventIds"]>().toBeFunction();
    expectTypeOf<OutboxStore["markPublishedByEventIds"]>()
      .parameter(0)
      .toMatchTypeOf<string[]>();
    expectTypeOf<
      OutboxStore["markPublishedByEventIds"]
    >().returns.toMatchTypeOf<Promise<void>>();
  });

  it("should have deletePublished accepting optional Date", () => {
    expectTypeOf<OutboxStore["deletePublished"]>().toBeFunction();
    expectTypeOf<OutboxStore["deletePublished"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});
```

### OutboxEntry has the correct shape

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { OutboxEntry, Event } from "@noddde/core";

describe("OutboxEntry Interface", () => {
  it("should have required fields with correct types", () => {
    expectTypeOf<OutboxEntry["id"]>().toBeString();
    expectTypeOf<OutboxEntry["event"]>().toMatchTypeOf<Event>();
    expectTypeOf<OutboxEntry["createdAt"]>().toBeString();
    expectTypeOf<OutboxEntry["publishedAt"]>().toMatchTypeOf<string | null>();
  });

  it("should have optional aggregateName and aggregateId", () => {
    expectTypeOf<OutboxEntry["aggregateName"]>().toMatchTypeOf<
      string | undefined
    >();
    expectTypeOf<OutboxEntry["aggregateId"]>().toMatchTypeOf<
      string | undefined
    >();
  });
});
```
