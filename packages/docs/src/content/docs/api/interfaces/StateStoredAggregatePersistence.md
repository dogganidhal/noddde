---
editUrl: false
next: false
prev: false
title: "StateStoredAggregatePersistence"
---

Defined in: [engine/domain.ts:15](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L15)

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<`any`\>

Defined in: [engine/domain.ts:17](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L17)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`string`

#### Returns

`Promise`\<`any`\>

***

### save()

> **save**(`aggregateName`, `aggregateId`, `state`): `Promise`\<`void`\>

Defined in: [engine/domain.ts:16](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L16)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`string`

##### state

`any`

#### Returns

`Promise`\<`void`\>
