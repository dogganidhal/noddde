---
editUrl: false
next: false
prev: false
title: "OutboxStore"
---

Defined in: [persistence/outbox.ts:31](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/outbox.ts#L31)

Storage interface for the transactional outbox. Implementations must support atomic writes within a UnitOfWork and polling reads for the OutboxRelay.

## Methods

### save()

> **save**(`entries`): `Promise`\<`void`\>

Defined in: [persistence/outbox.ts:38](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/outbox.ts#L38)

Persists one or more outbox entries. Designed to be called within a UoW's enlisted operation to ensure atomicity with aggregate persistence.

#### Parameters

##### entries

[`OutboxEntry`](/api/interfaces/outboxentry/)\[\]

#### Returns

`Promise`\<`void`\>

---

### loadUnpublished()

> **loadUnpublished**(`batchSize`?): `Promise`\<[`OutboxEntry`](/api/interfaces/outboxentry/)\[\]\>

Defined in: [persistence/outbox.ts:46](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/outbox.ts#L46)

Loads unpublished entries ordered by createdAt (oldest first). Used by the OutboxRelay to poll for pending events.

#### Parameters

##### batchSize?

`number`

Maximum number of entries to return. Defaults to 100.

#### Returns

`Promise`\<[`OutboxEntry`](/api/interfaces/outboxentry/)\[\]\>

---

### markPublished()

> **markPublished**(`ids`): `Promise`\<`void`\>

Defined in: [persistence/outbox.ts:54](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/outbox.ts#L54)

Marks entries as published by setting their publishedAt timestamp. Called after the relay successfully dispatches the events.

#### Parameters

##### ids

`string`\[\]

#### Returns

`Promise`\<`void`\>

---

### markPublishedByEventIds()

> **markPublishedByEventIds**(`eventIds`): `Promise`\<`void`\>

Defined in: [persistence/outbox.ts:63](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/outbox.ts#L63)

Marks entries as published by matching on their event's `metadata.eventId`. Used for happy-path post-dispatch marking where only the dispatched `Event[]` is available.

#### Parameters

##### eventIds

`string`\[\]

#### Returns

`Promise`\<`void`\>

---

### deletePublished()

> **deletePublished**(`olderThan`?): `Promise`\<`void`\>

Defined in: [persistence/outbox.ts:72](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/outbox.ts#L72)

Removes published entries older than the given date. Used for periodic cleanup to prevent unbounded growth.

#### Parameters

##### olderThan?

`Date`

Cutoff date. Published entries created before this date are removed. If omitted, all published entries are removed.

#### Returns

`Promise`\<`void`\>
