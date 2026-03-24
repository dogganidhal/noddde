---
editUrl: false
next: false
prev: false
title: "StateStoredAggregatePersistence"
---

Defined in: [persistence/index.ts:28](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L28)

Persistence strategy that stores the current aggregate state directly. On load, the latest snapshot and version are returned. On save, the full state is overwritten after an optimistic concurrency check.

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<\{ `state`: `any`; `version`: `number` \} \| `null`\>

Defined in: [persistence/index.ts:54](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L54)

Loads the latest state snapshot and version for an aggregate instance. Returns `null` if the aggregate does not exist.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<\{ `state`: `any`; `version`: `number` \} \| `null`\>

---

### save()

> **save**(`aggregateName`, `aggregateId`, `state`, `expectedVersion`): `Promise`\<`void`\>

Defined in: [persistence/index.ts:40](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L40)

Persists the current state snapshot for an aggregate instance. Throws `ConcurrencyError` if `expectedVersion` does not match the current stored version.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

##### state

`any`

##### expectedVersion

`number`

#### Returns

`Promise`\<`void`\>
