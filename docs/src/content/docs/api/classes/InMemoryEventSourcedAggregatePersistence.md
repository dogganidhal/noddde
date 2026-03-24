---
editUrl: false
next: false
prev: false
title: "InMemoryEventSourcedAggregatePersistence"
---

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:22](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-aggregate-persistence.ts#L22)

In-memory `EventSourcedAggregatePersistence` implementation that stores event streams in a `Map`. Also implements `PartialEventLoad` for snapshot-based partial replay.

## Implements

- [`EventSourcedAggregatePersistence`](/api/interfaces/eventsourcedaggregatepersistence/)
- [`PartialEventLoad`](/api/interfaces/partialeventload/)

## Constructors

### Constructor

> **new InMemoryEventSourcedAggregatePersistence**(): `InMemoryEventSourcedAggregatePersistence`

#### Returns

`InMemoryEventSourcedAggregatePersistence`

## Methods

### load()

> **load**(`aggregateName`, `aggregateId`): `Promise`\<[`Event`](/api/interfaces/event/)[]\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:36](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-aggregate-persistence.ts#L36)

Loads the full event stream for an aggregate instance. Returns an empty array if no events exist.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<[`Event`](/api/interfaces/event/)[]\>

#### Implementation of

[`EventSourcedAggregatePersistence`](/api/interfaces/eventsourcedaggregatepersistence/).[`load`](/api/interfaces/eventsourcedaggregatepersistence/#load)

---

### loadAfterVersion()

> **loadAfterVersion**(`aggregateName`, `aggregateId`, `afterVersion`): `Promise`\<[`Event`](/api/interfaces/event/)[]\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:60](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-aggregate-persistence.ts#L60)

Loads events that occurred after the given version. Returns events at positions `afterVersion, afterVersion+1, ...`.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

##### afterVersion

`number`

#### Returns

`Promise`\<[`Event`](/api/interfaces/event/)[]\>

#### Implementation of

[`PartialEventLoad`](/api/interfaces/partialeventload/).[`loadAfterVersion`](/api/interfaces/partialeventload/#loadafterversion)

---

### save()

> **save**(`aggregateName`, `aggregateId`, `events`, `expectedVersion`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-aggregate-persistence.ts:70](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-aggregate-persistence.ts#L70)

Appends new events to the event stream. Throws `ConcurrencyError` if `expectedVersion` does not match the current stream length.

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

#### Implementation of

[`EventSourcedAggregatePersistence`](/api/interfaces/eventsourcedaggregatepersistence/).[`save`](/api/interfaces/eventsourcedaggregatepersistence/#save)
