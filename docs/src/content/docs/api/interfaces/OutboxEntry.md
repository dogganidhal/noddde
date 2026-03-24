---
editUrl: false
next: false
prev: false
title: "OutboxEntry"
---

Defined in: [persistence/outbox.ts:9](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/outbox.ts#L9)

A single outbox entry representing a domain event pending publication. Written atomically with aggregate persistence within a UnitOfWork. Read by the OutboxRelay for guaranteed delivery.

## Properties

### id

> **id**: `string`

Unique entry identifier (UUID v7, time-ordered).

---

### event

> **event**: [`Event`](/api/interfaces/event/)

The fully enriched domain event to publish.

---

### aggregateName?

> `optional` **aggregateName**: `string`

Which aggregate type produced this event (for debugging/filtering).

---

### aggregateId?

> `optional` **aggregateId**: `string`

Which aggregate instance produced this event (for debugging/filtering).

---

### createdAt

> **createdAt**: `string`

ISO 8601 timestamp of when the entry was created.

---

### publishedAt

> **publishedAt**: `string` \| `null`

ISO 8601 timestamp of when the entry was published, or `null` if pending.
