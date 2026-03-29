---
editUrl: false
next: false
prev: false
title: "Projection"
---

> **Projection**\<`T`\> = `object`

Defined in: [ddd/projection.ts:161](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L161)

A projection that transforms domain events into a read-optimized view and co-locates query handlers for serving that view. Projections are the read side of CQRS.

Note: `Projection` is declared as an `interface` in source but documented here as a type alias for consistency with the API reference format.

## Type Parameters

### T

`T` _extends_ [`ProjectionTypes`](/api/type-aliases/projectiontypes/) = [`ProjectionTypes`](/api/type-aliases/projectiontypes/)

## Properties

### on

> **on**: `ProjectionOnMap`\<`T`\>

Defined in: [ddd/projection.ts:168](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L168)

A partial map of event handlers keyed by event name. Each entry bundles an `id` function (extracts the view instance ID from the event) and a `reduce` function (transforms the current view based on the event). Only events the projection cares about need entries — unhandled events are silently ignored.

---

### queryHandlers

> **queryHandlers**: `QueryHandlerMap`\<`T`\>

Defined in: [ddd/projection.ts:178](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L178)

A map of query handlers keyed by query name. Handlers serve the view built by the reducers. All handlers are optional. When `T` has a `viewStore` field, handlers receive `{ views }` merged into their infrastructure parameter.

---

### initialView?

> `optional` **initialView**: `T`\[`"view"`\]

Defined in: [ddd/projection.ts:185](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L185)

Optional default view state for new view instances. When `viewStore.load()` returns `undefined`/`null` for a new entity, `initialView` is used as the starting state for the reducer.

---

### viewStore?

> `optional` **viewStore**: `ViewStoreFactory`\<`T`\>

Defined in: [ddd/projection.ts:192](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L192)

Factory that resolves the view store from infrastructure. Synchronous only. Called during `Domain.init()` with the resolved infrastructure.

---

### consistency?

> `optional` **consistency**: `"eventual"` \| `"strong"`

Defined in: [ddd/projection.ts:202](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L202)

Consistency mode for view persistence. `"eventual"` (default): views updated asynchronously via event bus. `"strong"`: views updated within the same UoW as the originating command.
