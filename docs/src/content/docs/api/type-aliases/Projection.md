---
editUrl: false
next: false
prev: false
title: "Projection"
---

> **Projection**\<`T`\> = `object`

Defined in: [ddd/projection.ts:132](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L132)

A projection that transforms domain events into a read-optimized view and co-locates query handlers for serving that view. Projections are the read side of CQRS.

Note: `Projection` is declared as an `interface` in source but documented here as a type alias for consistency with the API reference format.

## Type Parameters

### T

`T` _extends_ [`ProjectionTypes`](/api/type-aliases/projectiontypes/) = [`ProjectionTypes`](/api/type-aliases/projectiontypes/)

## Properties

### reducers

> **reducers**: `ReducerMap`\<`T`\>

Defined in: [ddd/projection.ts:137](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L137)

A map of reducer functions keyed by event name. Each reducer receives the narrowed event type and current view, returning the updated view.

---

### queryHandlers

> **queryHandlers**: `QueryHandlerMap`\<`T`\>

Defined in: [ddd/projection.ts:146](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L146)

A map of query handlers keyed by query name. Handlers serve the view built by the reducers. All handlers are optional. When `T` has a `viewStore` field, handlers receive `{ views }` merged into their infrastructure parameter.

---

### initialView?

> `optional` **initialView**: `T`\[`"view"`\]

Defined in: [ddd/projection.ts:153](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L153)

Optional default view state for new view instances. When `viewStore.load()` returns `undefined`/`null` for a new entity, `initialView` is used as the starting state for the reducer.

---

### identity?

> `optional` **identity**: `IdentityMap`\<`T`\>

Defined in: [ddd/projection.ts:162](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L162)

Maps each event name to a function that extracts the view instance ID. Enables per-entity auto-persistence. Must be exhaustive when provided.

---

### viewStore?

> `optional` **viewStore**: `ViewStoreFactory`\<`T`\>

Defined in: [ddd/projection.ts:174](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L174)

Factory that resolves the view store from infrastructure. Synchronous only. Called during `Domain.init()` with the resolved infrastructure.

---

### consistency?

> `optional` **consistency**: `"eventual"` \| `"strong"`

Defined in: [ddd/projection.ts:184](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L184)

Consistency mode for view persistence. `"eventual"` (default): views updated asynchronously via event bus. `"strong"`: views updated within the same UoW as the originating command.
