---
editUrl: false
next: false
prev: false
title: "AggregateCommand"
---

Defined in: [cqrs/command/command.ts:6](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/command/command.ts#L6)

## Extends

- [`Command`](/api/interfaces/command/)

## Type Parameters

### TID

`TID` = `string`

## Properties

### name

> **name**: `string`

Defined in: [cqrs/command/command.ts:2](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/command/command.ts#L2)

#### Inherited from

[`Command`](/api/interfaces/command/).[`name`](/api/interfaces/command/#name)

***

### payload?

> `optional` **payload**: `any`

Defined in: [cqrs/command/command.ts:3](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/command/command.ts#L3)

#### Inherited from

[`Command`](/api/interfaces/command/).[`payload`](/api/interfaces/command/#payload)

***

### targetAggregateId

> **targetAggregateId**: `TID`

Defined in: [cqrs/command/command.ts:7](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/command/command.ts#L7)
