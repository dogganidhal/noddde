---
editUrl: false
next: false
prev: false
title: "InMemoryStateStoredAggregatePersistence"
---

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:22](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts#L22)

## Implements

- [`StateStoredAggregatePersistence`](/api/interfaces/statestoredaggregatepersistence/)

## Constructors

### Constructor

> **new InMemoryStateStoredAggregatePersistence**(): `InMemoryStateStoredAggregatePersistence`

#### Returns

`InMemoryStateStoredAggregatePersistence`

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<`any`\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:25](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts#L25)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`any`

#### Returns

`Promise`\<`any`\>

#### Implementation of

[`StateStoredAggregatePersistence`](/api/interfaces/statestoredaggregatepersistence/).[`load`](/api/interfaces/statestoredaggregatepersistence/#load)

---

### save()

> **save**(`aggregateName`, `aggregateId`, `state`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:28](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts#L28)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`string`

##### state

`any`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`StateStoredAggregatePersistence`](/api/interfaces/statestoredaggregatepersistence/).[`save`](/api/interfaces/statestoredaggregatepersistence/#save)
