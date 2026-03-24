---
editUrl: false
next: false
prev: false
title: "InferAggregateState"
---

> **InferAggregateState**\<`T`\> = `T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)\<infer U\> ? `U`\[`"state"`\] : `never`

Defined in: [ddd/aggregate-root.ts:152](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L152)

Extracts the state type from an Aggregate definition.

## Type Parameters

### T

`T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)
