---
editUrl: false
next: false
prev: false
title: "EventSourcedAggregatePersistence"
---

Defined in: [persistence/index.ts:69](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L69)

Persistence strategy that stores domain events as the source of truth. On load, the full event stream is returned. On save, new events are appended after an optimistic concurrency check.

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<[`Event`](/api/interfaces/event/)[]\>

Defined in: [persistence/index.ts:95](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L95)

Loads the full event stream for an aggregate instance. Returns an empty array if the aggregate does not exist.

#### Parameters

##### aggregateName

`string`

##### aggregateId

`string`

#### Returns

`Promise`\<[`Event`](/api/interfaces/event/)[]\>

---

### save()

> **save**(`aggregateName`, `aggregateId`, `events`, `expectedVersion`): `Promise`\<`void`\>

Defined in: [persistence/index.ts:80](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L80)

Appends new events to the event stream of an aggregate instance. Throws `ConcurrencyError` if `expectedVersion` does not match the current stream length.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

##### events

[`Event`](/api/interfaces/event/)[]

##### expectedVersion

`number`

#### Returns

`Promise`\<`void`\>
