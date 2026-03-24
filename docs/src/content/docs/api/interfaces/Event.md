---
editUrl: false
next: false
prev: false
title: "Event"
---

Defined in: [edd/event.ts:14](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event.ts#L14)

Base interface for all domain events. Events represent facts that have already happened within the domain. They are immutable and named in the past tense.

## Properties

### name

> **name**: `string`

Defined in: [edd/event.ts:16](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event.ts#L16)

Discriminant field used to identify the event type and enable type narrowing.

---

### payload

> **payload**: `any`

Defined in: [edd/event.ts:18](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event.ts#L18)

The event's data describing what happened.

---

### metadata?

> `optional` **metadata**: [`EventMetadata`](/api/interfaces/eventmetadata/)

Defined in: [edd/event.ts:23](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event.ts#L23)

Optional metadata envelope populated by the framework at dispatch time. Contains audit, tracing, and sequencing information.
