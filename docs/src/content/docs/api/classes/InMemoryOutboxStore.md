---
editUrl: false
next: false
prev: false
title: "InMemoryOutboxStore"
---

Defined in: [implementations/in-memory-outbox-store.ts:10](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-outbox-store.ts#L10)

In-memory implementation of [`OutboxStore`](/api/interfaces/outboxstore/) backed by a `Map<string, OutboxEntry>`. Suitable for testing and single-process development. Not durable across restarts.

## Implements

- [`OutboxStore`](/api/interfaces/outboxstore/)

## Methods

### save()

> **save**(`entries`): `Promise`\<`void`\>

Defined in: [implementations/in-memory-outbox-store.ts:13](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-outbox-store.ts#L13)

Persists outbox entries in memory.

#### Parameters

##### entries

[`OutboxEntry`](/api/interfaces/outboxentry/)\[\]

#### Returns

`Promise`\<`void`\>

---

### loadUnpublished()

> **loadUnpublished**(`batchSize`): `Promise`\<[`OutboxEntry`](/api/interfaces/outboxentry/)\[\]\>

Loads unpublished entries sorted by createdAt, limited by batchSize.

#### Parameters

##### batchSize

`number` = `100`

#### Returns

`Promise`\<[`OutboxEntry`](/api/interfaces/outboxentry/)\[\]\>

---

### markPublished()

> **markPublished**(`ids`): `Promise`\<`void`\>

Marks entries as published by entry ID.

#### Parameters

##### ids

`string`\[\]

#### Returns

`Promise`\<`void`\>

---

### markPublishedByEventIds()

> **markPublishedByEventIds**(`eventIds`): `Promise`\<`void`\>

Marks entries as published by matching `event.metadata.eventId`.

#### Parameters

##### eventIds

`string`\[\]

#### Returns

`Promise`\<`void`\>

---

### deletePublished()

> **deletePublished**(`olderThan`?): `Promise`\<`void`\>

Removes published entries, optionally filtered by age.

#### Parameters

##### olderThan?

`Date`

#### Returns

`Promise`\<`void`\>

---

### findAll()

> **findAll**(): [`OutboxEntry`](/api/interfaces/outboxentry/)\[\]

Returns all entries (published and unpublished). Convenience method for test inspection.

#### Returns

[`OutboxEntry`](/api/interfaces/outboxentry/)\[\]
