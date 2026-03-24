---
editUrl: false
next: false
prev: false
title: "InMemoryViewStore"
---

Defined in: [engine/implementations/in-memory-view-store.ts:18](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-view-store.ts#L18)

In-memory `ViewStore` implementation that stores projection views in a `Map`. State is lost when the process exits. Includes convenience methods `findAll()` and `find(predicate)` for development and testing.

## Type Parameters

### TView

`TView`

## Implements

- [`ViewStore`](/api/interfaces/viewstore/)\<`TView`\>

## Constructors

### Constructor

> **new InMemoryViewStore**\<`TView`\>(): `InMemoryViewStore`\<`TView`\>

#### Returns

`InMemoryViewStore`\<`TView`\>

## Methods

### save()

> **save**(`viewId`, `view`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-view-store.ts:28](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-view-store.ts#L28)

Persists a view instance.

#### Parameters

##### viewId

[`ID`](/api/type-aliases/id/)

##### view

`TView`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`ViewStore`](/api/interfaces/viewstore/).[`save`](/api/interfaces/viewstore/#save)

---

### load()

> **load**(`viewId`): `Promise`\<`TView` \| `undefined`\>

Defined in: [engine/implementations/in-memory-view-store.ts:39](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-view-store.ts#L39)

Loads a view instance by ID. Returns `undefined` if not found.

#### Parameters

##### viewId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<`TView` \| `undefined`\>

#### Implementation of

[`ViewStore`](/api/interfaces/viewstore/).[`load`](/api/interfaces/viewstore/#load)

---

### findAll()

> **findAll**(): `Promise`\<`TView`[]\>

Defined in: [engine/implementations/in-memory-view-store.ts:50](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-view-store.ts#L50)

Returns all stored views. Convenience method not part of the base `ViewStore` interface.

#### Returns

`Promise`\<`TView`[]\>

---

### find()

> **find**(`predicate`): `Promise`\<`TView`[]\>

Defined in: [engine/implementations/in-memory-view-store.ts:62](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-view-store.ts#L62)

Returns all stored views matching the given predicate. Convenience method not part of the base `ViewStore` interface.

#### Parameters

##### predicate

(`view`: `TView`) => `boolean`

#### Returns

`Promise`\<`TView`[]\>
