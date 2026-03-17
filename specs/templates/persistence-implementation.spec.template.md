---
title: "[PersistenceName] Persistence Implementation"
module: engine/implementations/[persistence-name]
source_file: packages/[package]/src/[path]/[persistence-name].ts
status: draft
exports: [[PersistenceName]]
depends_on: []
  # Choose the relevant dependency:
  # - core/engine/domain  (for StateStoredAggregatePersistence or EventSourcedAggregatePersistence)
  # - core/engine/domain  (for SagaPersistence)
---

# [PersistenceName] Persistence Implementation

> [1-2 sentence summary of this persistence implementation: what storage backend it uses (PostgreSQL, EventStoreDB, MongoDB, DynamoDB, etc.), what persistence strategy it implements, and when to use it.]

## Type Contract

<!--
  Identify which persistence interface this class implements.
  Choose ONE (or more) of the following:
-->

### For EventSourcedAggregatePersistence:

```ts
import type { EventSourcedAggregatePersistence } from "@noddde/core";

// interface EventSourcedAggregatePersistence {
//   save(aggregateName: string, aggregateId: string, events: Event[]): Promise<void>;
//   load(aggregateName: string, aggregateId: string): Promise<Event[]>;
// }
```

### For StateStoredAggregatePersistence:

```ts
import type { StateStoredAggregatePersistence } from "@noddde/core";

// interface StateStoredAggregatePersistence {
//   save(aggregateName: string, aggregateId: string, state: any): Promise<void>;
//   load(aggregateName: string, aggregateId: string): Promise<any>;
// }
```

### For SagaPersistence:

```ts
import type { SagaPersistence } from "@noddde/core";

// interface SagaPersistence {
//   save(sagaName: string, sagaId: string, state: any): Promise<void>;
//   load(sagaName: string, sagaId: string): Promise<any | undefined | null>;
// }
```

### Implementation Class

```ts
// TODO: Define your implementation class
export class [PersistenceName] implements [PersistenceInterface] {
  constructor(
    // TODO: Define constructor parameters
    // Example for PostgreSQL: config: { connectionString: string; schema?: string }
    // Example for EventStoreDB: config: { endpoint: string }
    // Example for MongoDB: config: { uri: string; database: string }
  ) {}

  // TODO: Implement the interface methods
}
```

## Behavioral Requirements

### Save

<!--
  Describe how data is persisted:
  - EventSourced: How are events appended to the stream? What is the storage schema?
  - StateStored: How is the state snapshot saved? Upsert or insert-then-update?
  - SagaPersistence: How is saga state saved? Upsert semantics?
-->

- [Describe save behavior]
- **Serialization**: [How are events/state serialized? JSON? Binary? Custom?]
- **Namespacing**: [How is (aggregateName/sagaName, id) mapped to storage keys/tables/streams?]
- **Concurrency**: [Optimistic concurrency via version numbers? Last-write-wins?]

### Load

<!--
  Describe how data is loaded:
  - EventSourced: How is the full event stream retrieved? Ordering guarantees?
  - StateStored: How is the latest snapshot retrieved?
  - SagaPersistence: How is saga state retrieved? What is returned for nonexistent instances?
-->

- [Describe load behavior]
- **Nonexistent aggregate/saga**: [What is returned? Empty array for event-sourced, undefined/null for state-stored/saga.]
- **Ordering (event-sourced)**: [Events must be returned in append order.]

### Connection Management

<!--
  Describe how connections to the storage backend are managed:
  - Connection pooling strategy.
  - Initialization (lazy connect, explicit init, constructor).
  - Cleanup (close/dispose).
-->

- [Describe connection management]

### Error Handling

<!--
  Describe error scenarios:
  - Connection failures (network, auth).
  - Serialization/deserialization errors.
  - Concurrency conflicts (optimistic locking failures).
  - Storage full / quota exceeded.
-->

- [Describe error handling strategy]

## Invariants

- [ ] [Invariant 1: e.g., "Events are never lost once save() resolves."]
- [ ] [Invariant 2: e.g., "load() after save() returns the saved data."]
- [ ] [Invariant 3: e.g., "Event ordering is preserved across save/load cycles."]
- [ ] [Invariant 4: e.g., "Different aggregate names are fully isolated (no cross-contamination)."]
- [ ] [Invariant 5: e.g., "Concurrent saves to different aggregate IDs do not interfere."]

## Edge Cases

- **First save for a new aggregate/saga**: [Creates the stream/record. No prior data exists.]
- **Load for nonexistent aggregate**: [EventSourced returns `[]`. StateStored/Saga returns `undefined` or `null`.]
- **Empty event array on save (event-sourced)**: [No-op? Throw? Append nothing?]
- **Large event streams**: [Performance characteristics. Pagination? Snapshotting?]
- **Concurrent writes to same aggregate ID**: [Optimistic concurrency check? Last-write-wins?]
- **Special characters in names/IDs**: [Escaping? Validation? Length limits?]
- **Null or undefined state on save (state-stored)**: [Allowed? Treated as delete?]

## Integration Points

- This persistence is provided via `DomainConfiguration.infrastructure.aggregatePersistence()` or `sagaPersistence()`.
- Used by `Domain.dispatchCommand()` to load/save aggregate state.
- Used by saga wiring to load/save saga instance state.

## Storage Schema

<!--
  Describe the storage schema used by this implementation.
  Include table definitions, stream naming conventions, key formats, etc.
-->

```sql
-- TODO: For SQL-based implementations
-- Example:
-- CREATE TABLE events (
--   id BIGSERIAL PRIMARY KEY,
--   aggregate_name VARCHAR(255) NOT NULL,
--   aggregate_id VARCHAR(255) NOT NULL,
--   event_name VARCHAR(255) NOT NULL,
--   payload JSONB NOT NULL,
--   created_at TIMESTAMPTZ DEFAULT NOW(),
--   version INT NOT NULL
-- );
-- CREATE UNIQUE INDEX idx_events_version ON events(aggregate_name, aggregate_id, version);
```

```
// TODO: For NoSQL implementations, describe the key/document structure
// Example for DynamoDB:
// Partition Key: "{aggregateName}#{aggregateId}"
// Sort Key: version (number)
// Attributes: eventName, payload, createdAt
```

## Test Scenarios

### Save and load roundtrip

```ts
import { describe, it, expect } from "vitest";

describe("[PersistenceName]", () => {
  it("should save and load data successfully", async () => {
    const persistence = new [PersistenceName](/* constructor args */);

    // TODO: For EventSourcedAggregatePersistence:
    // await persistence.save("TestAggregate", "id-1", [
    //   { name: "Created", payload: { value: 1 } },
    //   { name: "Updated", payload: { value: 2 } },
    // ]);
    // const events = await persistence.load("TestAggregate", "id-1");
    // expect(events).toHaveLength(2);
    // expect(events[0]).toEqual({ name: "Created", payload: { value: 1 } });
    // expect(events[1]).toEqual({ name: "Updated", payload: { value: 2 } });

    // TODO: For StateStoredAggregatePersistence:
    // await persistence.save("TestAggregate", "id-1", { count: 42 });
    // const state = await persistence.load("TestAggregate", "id-1");
    // expect(state).toEqual({ count: 42 });

    // TODO: For SagaPersistence:
    // await persistence.save("TestSaga", "saga-1", { status: "active" });
    // const state = await persistence.load("TestSaga", "saga-1");
    // expect(state).toEqual({ status: "active" });
  });
});
```

### Load returns empty/undefined for nonexistent entity

```ts
import { describe, it, expect } from "vitest";

describe("[PersistenceName] - nonexistent entity", () => {
  it("should return [empty array / undefined] for a nonexistent entity", async () => {
    const persistence = new [PersistenceName](/* constructor args */);

    // TODO: For EventSourcedAggregatePersistence:
    // const events = await persistence.load("TestAggregate", "nonexistent");
    // expect(events).toEqual([]);

    // TODO: For StateStoredAggregatePersistence or SagaPersistence:
    // const state = await persistence.load("TestAggregate", "nonexistent");
    // expect(state).toBeUndefined(); // or toBeNull()
  });
});
```

### Multiple saves append events (event-sourced)

```ts
import { describe, it, expect } from "vitest";

// Only applicable to EventSourcedAggregatePersistence implementations
describe("[PersistenceName] - event append", () => {
  it("should append events across multiple saves", async () => {
    const persistence = new [PersistenceName](/* constructor args */);

    // await persistence.save("Agg", "id-1", [
    //   { name: "First", payload: {} },
    // ]);
    // await persistence.save("Agg", "id-1", [
    //   { name: "Second", payload: {} },
    // ]);

    // const events = await persistence.load("Agg", "id-1");
    // expect(events).toHaveLength(2);
    // expect(events[0].name).toBe("First");
    // expect(events[1].name).toBe("Second");
  });
});
```

### Overwrite on save (state-stored)

```ts
import { describe, it, expect } from "vitest";

// Only applicable to StateStoredAggregatePersistence / SagaPersistence
describe("[PersistenceName] - state overwrite", () => {
  it("should overwrite prior state on subsequent saves", async () => {
    const persistence = new [PersistenceName](/* constructor args */);

    // await persistence.save("Agg", "id-1", { version: 1 });
    // await persistence.save("Agg", "id-1", { version: 2 });

    // const state = await persistence.load("Agg", "id-1");
    // expect(state).toEqual({ version: 2 });
  });
});
```

### Namespace isolation

```ts
import { describe, it, expect } from "vitest";

describe("[PersistenceName] - namespace isolation", () => {
  it("should isolate data between different aggregate/saga names", async () => {
    const persistence = new [PersistenceName](/* constructor args */);

    // Save data for two different aggregate names with the same ID
    // await persistence.save("AggregateA", "id-1", /* data A */);
    // await persistence.save("AggregateB", "id-1", /* data B */);

    // Verify they are isolated
    // const dataA = await persistence.load("AggregateA", "id-1");
    // const dataB = await persistence.load("AggregateB", "id-1");
    // expect(dataA).not.toEqual(dataB);
  });
});
```

### Instance isolation

```ts
import { describe, it, expect } from "vitest";

describe("[PersistenceName] - instance isolation", () => {
  it("should isolate data between different IDs of the same name", async () => {
    const persistence = new [PersistenceName](/* constructor args */);

    // Save data for two different IDs of the same aggregate/saga
    // await persistence.save("Agg", "id-1", /* data 1 */);
    // await persistence.save("Agg", "id-2", /* data 2 */);

    // Verify they are isolated
    // const data1 = await persistence.load("Agg", "id-1");
    // const data2 = await persistence.load("Agg", "id-2");
    // expect(data1).not.toEqual(data2);
  });
});
```

### Connection error handling

```ts
import { describe, it, expect } from "vitest";

describe("[PersistenceName] - connection errors", () => {
  it("should [throw/retry/queue] when the storage backend is unavailable", async () => {
    // TODO: Configure persistence with an invalid connection
    // const persistence = new [PersistenceName]({ connectionString: "invalid://..." });

    // TODO: Verify error behavior
    // await expect(persistence.load("Agg", "id-1")).rejects.toThrow();
  });
});
```
