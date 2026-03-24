---
editUrl: false
next: false
prev: false
title: "ViewStore"
---

Defined in: [persistence/view-store.ts:26](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/view-store.ts#L26)

Base persistence and query interface for projection views. Each projection can extend this with custom query methods.

## Type Parameters

### TView

`TView` = `any`

## Methods

### save()

> **save**(`viewId`, `view`): `Promise`\<`void`\>

Defined in: [persistence/view-store.ts:34](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/view-store.ts#L34)

Persists a view instance, replacing any previously stored view for the given viewId.

#### Parameters

##### viewId

[`ID`](/api/type-aliases/id/)

##### view

`TView`

#### Returns

`Promise`\<`void`\>

---

### load()

> **load**(`viewId`): `Promise`\<`TView` \| `undefined` \| `null`\>

Defined in: [persistence/view-store.ts:43](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/view-store.ts#L43)

Loads a view instance by ID. Returns `undefined` or `null` if not found.

#### Parameters

##### viewId

[`ID`](/api/type-aliases/id/)

#### Returns

`Promise`\<`TView` \| `undefined` \| `null`\>
