---
editUrl: false
next: false
prev: false
title: "InferAggregateCommands"
---

> **InferAggregateCommands**\<`T`\> = `T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)\<infer U\> ? `U`\[`"commands"`\] : `never`

Defined in: [ddd/aggregate-root.ts:174](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L174)

Extracts the command union type from an Aggregate definition.

## Type Parameters

### T

`T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)
