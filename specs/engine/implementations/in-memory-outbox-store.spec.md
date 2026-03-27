---
title: "InMemoryOutboxStore"
module: engine/implementations/in-memory-outbox-store
source_file: packages/engine/src/implementations/in-memory-outbox-store.ts
status: implemented
exports:
  - InMemoryOutboxStore
depends_on:
  - persistence/outbox
docs: []
---

# InMemoryOutboxStore

> In-memory implementation of `OutboxStore` for development, testing, and single-process applications. Uses a `Map<string, OutboxEntry>` keyed by entry ID. Suitable for verifying outbox pattern wiring without a database. Not crash-recoverable (state is lost on process exit).

## Type Contract

```ts
import type { OutboxStore, OutboxEntry } from "@noddde/core";

class InMemoryOutboxStore implements OutboxStore {
  save(entries: OutboxEntry[]): Promise<void>;
  loadUnpublished(batchSize?: number): Promise<OutboxEntry[]>;
  markPublished(ids: string[]): Promise<void>;
  markPublishedByEventIds(eventIds: string[]): Promise<void>;
  deletePublished(olderThan?: Date): Promise<void>;

  /** Convenience method for test inspection. Returns all entries. */
  findAll(): OutboxEntry[];
}
```

- Implements the full `OutboxStore` interface.
- Adds `findAll()` for test inspection (same pattern as `InMemoryViewStore.findAll()`).

## Behavioral Requirements

1. **save stores entries by ID** -- Each entry is stored in the internal `Map` keyed by `entry.id`. Existing entries with the same ID are overwritten.
2. **loadUnpublished filters and sorts** -- Iterates the map, selects entries where `publishedAt === null`, sorts by `createdAt` ascending, and returns up to `batchSize` entries (default 100).
3. **markPublished sets publishedAt** -- For each ID, looks up the entry in the map and sets `publishedAt` to the current ISO 8601 timestamp. Missing IDs are ignored.
4. **markPublishedByEventIds matches on event metadata** -- Iterates all entries, finds those whose `entry.event.metadata?.eventId` matches any of the provided event IDs, and sets their `publishedAt`.
5. **deletePublished removes matching entries** -- Iterates the map, removes entries where `publishedAt !== null` and `createdAt < olderThan` (or all published entries if `olderThan` is omitted).
6. **findAll returns all entries** -- Returns all entries from the map as an array, regardless of published status.

## Invariants

- The internal map is keyed by `entry.id`. Each ID maps to exactly one entry.
- `loadUnpublished` always returns entries sorted by `createdAt` ascending.
- `markPublished` and `markPublishedByEventIds` never create new entries.
- `deletePublished` never removes unpublished entries.

## Edge Cases

- **save with duplicate IDs in single call** -- Later entries in the array overwrite earlier ones with the same ID.
- **loadUnpublished with batchSize larger than unpublished count** -- Returns all unpublished entries.
- **markPublished with unknown ID** -- Silently ignored.
- **findAll on empty store** -- Returns `[]`.
- **deletePublished with future olderThan** -- Removes all published entries created before that date.

## Integration Points

- Used as the default `OutboxStore` in `DomainWiring.outbox` for testing.
- The `OutboxRelay` reads from it via `loadUnpublished` and marks entries via `markPublished`.

## Test Scenarios

### save and loadUnpublished roundtrip

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should save entries and load them as unpublished", async () => {
    const store = new InMemoryOutboxStore();
    const entries: OutboxEntry[] = [
      {
        id: "entry-1",
        event: { name: "OrderCreated", payload: { orderId: "o1" } },
        aggregateName: "Order",
        aggregateId: "o1",
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "entry-2",
        event: { name: "OrderShipped", payload: { orderId: "o1" } },
        aggregateName: "Order",
        aggregateId: "o1",
        createdAt: "2025-01-01T00:00:01.000Z",
        publishedAt: null,
      },
    ];

    await store.save(entries);
    const unpublished = await store.loadUnpublished();

    expect(unpublished).toHaveLength(2);
    expect(unpublished[0]!.id).toBe("entry-1");
    expect(unpublished[1]!.id).toBe("entry-2");
  });
});
```

### loadUnpublished respects batchSize

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should limit results to batchSize", async () => {
    const store = new InMemoryOutboxStore();
    const entries: OutboxEntry[] = Array.from({ length: 5 }, (_, i) => ({
      id: `entry-${i}`,
      event: { name: "Evt", payload: {} },
      createdAt: `2025-01-01T00:00:0${i}.000Z`,
      publishedAt: null,
    }));

    await store.save(entries);
    const batch = await store.loadUnpublished(3);

    expect(batch).toHaveLength(3);
    expect(batch[0]!.id).toBe("entry-0");
    expect(batch[2]!.id).toBe("entry-2");
  });
});
```

### loadUnpublished returns entries sorted by createdAt ascending

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should return entries sorted by createdAt ascending", async () => {
    const store = new InMemoryOutboxStore();
    // Insert in reverse order
    await store.save([
      {
        id: "late",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:02.000Z",
        publishedAt: null,
      },
      {
        id: "early",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
    ]);

    const unpublished = await store.loadUnpublished();
    expect(unpublished[0]!.id).toBe("early");
    expect(unpublished[1]!.id).toBe("late");
  });
});
```

### markPublished sets publishedAt on matching entries

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should mark entries as published by ID", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "e1",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "e2",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:01.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublished(["e1"]);

    const unpublished = await store.loadUnpublished();
    expect(unpublished).toHaveLength(1);
    expect(unpublished[0]!.id).toBe("e2");

    const all = store.findAll();
    const e1 = all.find((e) => e.id === "e1")!;
    expect(e1.publishedAt).not.toBeNull();
  });
});
```

### markPublishedByEventIds matches on event metadata

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should mark entries as published by event metadata eventId", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "e1",
        event: {
          name: "Evt",
          payload: {},
          metadata: {
            eventId: "evt-aaa",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "e2",
        event: {
          name: "Evt",
          payload: {},
          metadata: {
            eventId: "evt-bbb",
            timestamp: "2025-01-01T00:00:01.000Z",
          },
        },
        createdAt: "2025-01-01T00:00:01.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublishedByEventIds(["evt-aaa"]);

    const unpublished = await store.loadUnpublished();
    expect(unpublished).toHaveLength(1);
    expect(unpublished[0]!.id).toBe("e2");
  });
});
```

### deletePublished removes old published entries

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should delete published entries older than cutoff", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "old",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "recent",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-06-01T00:00:00.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublished(["old", "recent"]);
    await store.deletePublished(new Date("2025-03-01T00:00:00.000Z"));

    const all = store.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe("recent");
  });
});
```

### deletePublished without olderThan removes all published entries

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";
import type { OutboxEntry } from "@noddde/core";

describe("InMemoryOutboxStore", () => {
  it("should delete all published entries when olderThan is omitted", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([
      {
        id: "e1",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-01-01T00:00:00.000Z",
        publishedAt: null,
      },
      {
        id: "e2",
        event: { name: "Evt", payload: {} },
        createdAt: "2025-06-01T00:00:00.000Z",
        publishedAt: null,
      },
    ]);

    await store.markPublished(["e1", "e2"]);
    await store.deletePublished();

    const all = store.findAll();
    expect(all).toHaveLength(0);
  });
});
```

### loadUnpublished returns empty array when no pending entries

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";

describe("InMemoryOutboxStore", () => {
  it("should return empty array when no unpublished entries exist", async () => {
    const store = new InMemoryOutboxStore();
    const result = await store.loadUnpublished();
    expect(result).toEqual([]);
  });
});
```

### save with empty array is a no-op

```ts
import { describe, it, expect } from "vitest";
import { InMemoryOutboxStore } from "@noddde/engine";

describe("InMemoryOutboxStore", () => {
  it("should handle save with empty array", async () => {
    const store = new InMemoryOutboxStore();
    await store.save([]);
    expect(store.findAll()).toHaveLength(0);
  });
});
```
