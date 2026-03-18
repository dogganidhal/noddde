---
editUrl: false
next: false
prev: false
title: "InMemoryEventSourcedAggregatePersistence"
---

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:7](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts#L7)

## Implements

- [`EventSourcedAggregatePersistence`](/api/interfaces/eventsourcedaggregatepersistence/)

## Constructors

### Constructor

> **new InMemoryEventSourcedAggregatePersistence**(): `InMemoryEventSourcedAggregatePersistence`

#### Returns

`InMemoryEventSourcedAggregatePersistence`

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<[`Event`](/api/interfaces/event/)[]\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:10](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts#L10)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`any`

#### Returns

`Promise`\<[`Event`](/api/interfaces/event/)[]\>

#### Implementation of

[`EventSourcedAggregatePersistence`](/api/interfaces/eventsourcedaggregatepersistence/).[`load`](/api/interfaces/eventsourcedaggregatepersistence/#load)

---

### save()

> **save**(`aggregateName`, `aggregateId`, `events`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:13](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-aggregate-persistence.ts#L13)

#### Parameters

##### aggregateName

`string`

##### aggregateId

`string`

##### events

[`Event`](/api/interfaces/event/)[]

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`EventSourcedAggregatePersistence`](/api/interfaces/eventsourcedaggregatepersistence/).[`save`](/api/interfaces/eventsourcedaggregatepersistence/#save)
