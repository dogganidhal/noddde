---
editUrl: false
next: false
prev: false
title: "IdempotencyRecord"
---

Defined in: [persistence/idempotency.ts:9](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/idempotency.ts#L9)

A record of a processed command, stored by the `IdempotencyStore`.

## Properties

### commandId

> **commandId**: [`ID`](/api/type-aliases/id/)

The unique command identifier that was processed.

---

### aggregateName

> **aggregateName**: `string`

The aggregate type that processed the command.

---

### aggregateId

> **aggregateId**: [`ID`](/api/type-aliases/id/)

The aggregate instance that processed the command.

---

### processedAt

> **processedAt**: `string`

ISO 8601 timestamp of when the command was processed.
