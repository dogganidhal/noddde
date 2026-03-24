---
editUrl: false
next: false
prev: false
title: "SnapshotStore"
---

Defined in: [persistence/snapshot.ts:31](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L31)

Storage interface for aggregate state snapshots. Only the latest snapshot per aggregate instance is retained.

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<[`Snapshot`](/api/interfaces/snapshot/) \| `null`\>

Defined in: [persistence/snapshot.ts:39](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L39)

Loads the latest snapshot for an aggregate instance. Returns `null` if no snapshot exists.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<[`Snapshot`](/api/interfaces/snapshot/) \| `null`\>

---

### save()

> **save**(`aggregateName`, `aggregateId`, `snapshot`): `Promise`\<`void`\>

Defined in: [persistence/snapshot.ts:49](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L49)

Saves a snapshot, overwriting any previously stored snapshot for the same instance.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

##### snapshot

[`Snapshot`](/api/interfaces/snapshot/)

#### Returns

`Promise`\<`void`\>
