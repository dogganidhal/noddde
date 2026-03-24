---
editUrl: false
next: false
prev: false
title: "InMemorySagaPersistence"
---

Defined in: [engine/implementations/in-memory-saga-persistence.ts:14](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-saga-persistence.ts#L14)

In-memory `SagaPersistence` implementation that stores saga state snapshots in a `Map`. State is lost when the process exits.

## Implements

- [`SagaPersistence`](/api/interfaces/sagapersistence/)

## Constructors

### Constructor

> **new InMemorySagaPersistence**(): `InMemorySagaPersistence`

#### Returns

`InMemorySagaPersistence`

## Methods

### load()

> **load**(`sagaName`, `sagaId`): `Promise`\<`any` \| `undefined`\>

Defined in: [engine/implementations/in-memory-saga-persistence.ts:25](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-saga-persistence.ts#L25)

Loads the current state of a saga instance. Returns `undefined` if not found.

#### Parameters

##### sagaName

`string`

##### sagaId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<`any` \| `undefined`\>

#### Implementation of

[`SagaPersistence`](/api/interfaces/sagapersistence/).[`load`](/api/interfaces/sagapersistence/#load)

---

### save()

> **save**(`sagaName`, `sagaId`, `state`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-saga-persistence.ts:38](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-saga-persistence.ts#L38)

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

#### Implementation of

[`SagaPersistence`](/api/interfaces/sagapersistence/).[`save`](/api/interfaces/sagapersistence/#save)
