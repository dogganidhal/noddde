---
editUrl: false
next: false
prev: false
title: "EventSourcedAggregatePersistence"
---

Defined in: [engine/domain.ts:20](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L20)

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<[`Event`](/api/interfaces/event/)[]\>

Defined in: [engine/domain.ts:26](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L26)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`string`

#### Returns

`Promise`\<[`Event`](/api/interfaces/event/)[]\>

***

### save()

> **save**(`aggregateName`, `aggregateId`, `events`): `Promise`\<`void`\>

Defined in: [engine/domain.ts:21](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L21)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`string`

##### events

[`Event`](/api/interfaces/event/)[]

#### Returns

`Promise`\<`void`\>
