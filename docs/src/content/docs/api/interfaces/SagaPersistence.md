---
editUrl: false
next: false
prev: false
title: "SagaPersistence"
---

Defined in: [persistence/index.ts:116](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L116)

Persistence strategy for saga instance state. Each saga instance is identified by a (sagaName, sagaId) pair.

## Methods

### save()

> **save**(`sagaName`, `sagaId`, `state`): `Promise`\<`void`\>

Defined in: [persistence/index.ts:124](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L124)

Persists the current state of a saga instance.

#### Parameters

##### sagaName

`string`

##### sagaId

[`ID`](/api/type-aliases/id/)

##### state

`any`

#### Returns

`Promise`\<`void`\>

---

### load()

> **load**(`sagaName`, `sagaId`): `Promise`\<`any` \| `undefined` \| `null`\>

Defined in: [persistence/index.ts:133](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L133)

Loads the current state of a saga instance. Returns `undefined` or `null` if no saga instance exists.

#### Parameters

##### sagaName

`string`

##### sagaId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<`any` \| `undefined` \| `null`\>
