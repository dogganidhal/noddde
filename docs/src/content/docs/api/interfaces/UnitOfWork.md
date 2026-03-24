---
editUrl: false
next: false
prev: false
title: "UnitOfWork"
---

Defined in: [persistence/unit-of-work.ts:19](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/unit-of-work.ts#L19)

Coordinates atomic persistence and deferred event publishing within a write model unit of work. Single-use: after `commit` or `rollback`, further calls throw.

## Methods

### enlist()

> **enlist**(`operation`): `void`

Defined in: [persistence/unit-of-work.ts:28](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/unit-of-work.ts#L28)

Buffers a write operation for deferred execution. Operations are executed in enlistment order when `commit()` is called.

#### Parameters

##### operation

() => `Promise`\<`void`\>

#### Returns

`void`

---

### deferPublish()

> **deferPublish**(...`events`): `void`

Defined in: [persistence/unit-of-work.ts:37](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/unit-of-work.ts#L37)

Schedules events for deferred publishing after successful commit.

#### Parameters

##### events

...[`Event`](/api/interfaces/event/)[]

#### Returns

`void`

---

### commit()

> **commit**(): `Promise`\<[`Event`](/api/interfaces/event/)[]\>

Defined in: [persistence/unit-of-work.ts:53](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/unit-of-work.ts#L53)

Executes all enlisted operations, then returns all deferred events. The caller is responsible for publishing the returned events.

#### Returns

`Promise`\<[`Event`](/api/interfaces/event/)[]\>

---

### rollback()

> **rollback**(): `Promise`\<`void`\>

Defined in: [persistence/unit-of-work.ts:63](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/unit-of-work.ts#L63)

Discards all enlisted operations and deferred events without executing.

#### Returns

`Promise`\<`void`\>
