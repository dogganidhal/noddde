---
editUrl: false
next: false
prev: false
title: "ProjectionTypes"
---

> **ProjectionTypes** = `object`

Defined in: [ddd/projection.ts:28](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L28)

A bundle of the type parameters that define a projection's type universe. Mirrors the `AggregateTypes` pattern used for aggregates.

## Properties

### events

> **events**: [`Event`](/api/interfaces/event/)

The discriminated union of events this projection handles.

---

### queries

> **queries**: [`Query`](/api/interfaces/query/)\<`any`\>

The discriminated union of queries this projection can answer.

---

### view

> **view**: `any`

The read-optimized view model this projection builds.

---

### infrastructure

> **infrastructure**: [`Infrastructure`](/api/type-aliases/infrastructure/)

The external dependencies available to query handlers.

---

### viewStore?

> `optional` **viewStore**: [`ViewStore`](/api/interfaces/viewstore/)

Optional typed view store for this projection.
