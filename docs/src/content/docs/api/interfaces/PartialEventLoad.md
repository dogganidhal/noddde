---
editUrl: false
next: false
prev: false
title: "PartialEventLoad"
---

Defined in: [persistence/snapshot.ts:81](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L81)

Optional interface that event-sourced persistence implementations can adopt to efficiently load only events after a given version. Used by the domain engine when a snapshot exists to avoid loading the full event stream.

## Methods

### loadAfterVersion()

> **loadAfterVersion**(`aggregateName`, `aggregateId`, `afterVersion`): `Promise`\<[`Event`](/api/interfaces/event/)[]\>

Defined in: [persistence/snapshot.ts:94](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/snapshot.ts#L94)

Loads events that occurred after the given version.

#### Parameters

##### aggregateName

`string`

##### aggregateId

[`ID`](/api/type-aliases/id/)

##### afterVersion

`number`

#### Returns

`Promise`\<[`Event`](/api/interfaces/event/)[]\>
