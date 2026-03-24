---
editUrl: false
next: false
prev: false
title: "AggregateCommand"
---

Defined in: [cqrs/command/command.ts:31](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L31)

A command targeting a specific aggregate instance. Extends `Command` with a `targetAggregateId` that the framework uses to route the command to the correct aggregate.

## Extends

- [`Command`](/api/interfaces/command/)

## Type Parameters

### TID

`TID` _extends_ [`ID`](/api/type-aliases/id/) = `string`

## Properties

### name

> **name**: `string`

Defined in: [cqrs/command/command.ts:13](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L13)

#### Inherited from

[`Command`](/api/interfaces/command/).[`name`](/api/interfaces/command/#name)

---

### payload?

> `optional` **payload**: `any`

Defined in: [cqrs/command/command.ts:15](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L15)

#### Inherited from

[`Command`](/api/interfaces/command/).[`payload`](/api/interfaces/command/#payload)

---

### commandId?

> `optional` **commandId**: [`ID`](/api/type-aliases/id/)

Defined in: [cqrs/command/command.ts:21](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L21)

#### Inherited from

[`Command`](/api/interfaces/command/).[`commandId`](/api/interfaces/command/#commandid)

---

### targetAggregateId

> **targetAggregateId**: `TID`

Defined in: [cqrs/command/command.ts:33](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L33)

Identifies which aggregate instance should handle this command.
