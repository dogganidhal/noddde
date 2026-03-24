---
editUrl: false
next: false
prev: false
title: "EventMetadata"
---

Defined in: [edd/event-metadata.ts:12](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event-metadata.ts#L12)

Metadata envelope attached to domain events by the framework at dispatch time. Carries audit, tracing, and sequencing information.

## Properties

### eventId

> **eventId**: `string`

Globally unique event identifier (UUID v7, time-ordered).

---

### timestamp

> **timestamp**: `string`

ISO 8601 timestamp of when the event was produced.

---

### correlationId

> **correlationId**: `string`

Traces a user action across aggregates and sagas. All events in a causal chain share the same correlationId.

---

### causationId

> **causationId**: `string`

ID of the command or event that directly caused this event.

---

### userId?

> `optional` **userId**: [`ID`](/api/type-aliases/id/)

Who initiated the action.

---

### version?

> `optional` **version**: `number`

Event schema version for future evolution support.

---

### aggregateName?

> `optional` **aggregateName**: `string`

Which aggregate type produced this event.

---

### aggregateId?

> `optional` **aggregateId**: [`ID`](/api/type-aliases/id/)

Which aggregate instance produced this event.

---

### sequenceNumber?

> `optional` **sequenceNumber**: `number`

Position in the aggregate's event stream.
