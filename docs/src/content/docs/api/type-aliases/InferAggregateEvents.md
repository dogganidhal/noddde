---
editUrl: false
next: false
prev: false
title: "InferAggregateEvents"
---

> **InferAggregateEvents**\<`T`\> = `T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)\<infer U\> ? `U`\[`"events"`\] : `never`

Defined in: [ddd/aggregate-root.ts:163](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L163)

Extracts the event union type from an Aggregate definition.

## Type Parameters

### T

`T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)
