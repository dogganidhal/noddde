---
editUrl: false
next: false
prev: false
title: "InMemorySnapshotStore"
---

Defined in: [engine/implementations/in-memory-snapshot-store.ts:14](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-snapshot-store.ts#L14)

In-memory `SnapshotStore` implementation that stores aggregate state snapshots in a `Map`. Snapshots are lost when the process exits.

## Implements

- [`SnapshotStore`](/api/interfaces/snapshotstore/)

## Constructors

### Constructor

> **new InMemorySnapshotStore**(): `InMemorySnapshotStore`

#### Returns

`InMemorySnapshotStore`

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<[`Snapshot`](/api/interfaces/snapshot/) \| `null`\>

Defined in: [engine/implementations/in-memory-snapshot-store.ts:25](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-snapshot-store.ts#L25)

Loads the latest snapshot. Returns `null` if none exists.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<[`Snapshot`](/api/interfaces/snapshot/) \| `null`\>

#### Implementation of

[`SnapshotStore`](/api/interfaces/snapshotstore/).[`load`](/api/interfaces/snapshotstore/#load)

---

### save()

> **save**(`aggregateName`, `aggregateId`, `snapshot`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-snapshot-store.ts:41](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-snapshot-store.ts#L41)

Saves a snapshot, replacing any previously stored snapshot.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

##### snapshot

[`Snapshot`](/api/interfaces/snapshot/)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`SnapshotStore`](/api/interfaces/snapshotstore/).[`save`](/api/interfaces/snapshotstore/#save)
