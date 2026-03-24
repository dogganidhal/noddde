---
editUrl: false
next: false
prev: false
title: "InMemoryStateStoredAggregatePersistence"
---

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:109](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-aggregate-persistence.ts#L109)

In-memory `StateStoredAggregatePersistence` implementation that stores state snapshots in a `Map`.

## Implements

- [`StateStoredAggregatePersistence`](/api/interfaces/statestoredaggregatepersistence/)

## Constructors

### Constructor

> **new InMemoryStateStoredAggregatePersistence**(): `InMemoryStateStoredAggregatePersistence`

#### Returns

`InMemoryStateStoredAggregatePersistence`

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<\{ `state`: `any`; `version`: `number` \} \| `null`\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:122](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-aggregate-persistence.ts#L122)

Loads the latest state snapshot and version. Returns `null` if no state exists.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<\{ `state`: `any`; `version`: `number` \} \| `null`\>

#### Implementation of

[`StateStoredAggregatePersistence`](/api/interfaces/statestoredaggregatepersistence/).[`load`](/api/interfaces/statestoredaggregatepersistence/#load)

---

### save()

> **save**(`aggregateName`, `aggregateId`, `state`, `expectedVersion`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:140](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-aggregate-persistence.ts#L140)

Persists the current state snapshot. Throws `ConcurrencyError` if `expectedVersion` does not match.

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

#### Implementation of

[`StateStoredAggregatePersistence`](/api/interfaces/statestoredaggregatepersistence/).[`save`](/api/interfaces/statestoredaggregatepersistence/#save)
