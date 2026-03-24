---
editUrl: false
next: false
prev: false
title: "IdempotencyStore"
---

Defined in: [persistence/idempotency.ts:30](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/idempotency.ts#L30)

Storage interface for tracking processed commands. Used by the domain engine to detect and skip duplicate commands when a command carries a `commandId`.

## Methods

### exists()

> **exists**(`commandId`): `Promise`\<`boolean`\>

Defined in: [persistence/idempotency.ts:37](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/idempotency.ts#L37)

Checks whether a command with the given ID has already been processed.

#### Parameters

##### commandId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<`boolean`\>

---

### save()

> **save**(`record`): `Promise`\<`void`\>

Defined in: [persistence/idempotency.ts:46](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/idempotency.ts#L46)

Records that a command has been processed.

#### Parameters

##### record

[`IdempotencyRecord`](/api/interfaces/idempotencyrecord/)

#### Returns

`Promise`\<`void`\>

---

### remove()

> **remove**(`commandId`): `Promise`\<`void`\>

Defined in: [persistence/idempotency.ts:53](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/idempotency.ts#L53)

Removes a single idempotency record.

#### Parameters

##### commandId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<`void`\>

---

### removeExpired()

> **removeExpired**(`ttlMs`): `Promise`\<`void`\>

Defined in: [persistence/idempotency.ts:63](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/idempotency.ts#L63)

Removes all records older than `Date.now() - ttlMs`.

#### Parameters

##### ttlMs

`number`

#### Returns

`Promise`\<`void`\>
