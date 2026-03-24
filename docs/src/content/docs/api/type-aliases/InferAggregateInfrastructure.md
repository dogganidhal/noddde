---
editUrl: false
next: false
prev: false
title: "InferAggregateInfrastructure"
---

> **InferAggregateInfrastructure**\<`T`\> = `T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)\<infer U\> ? `U`\[`"infrastructure"`\] : `never`

Defined in: [ddd/aggregate-root.ts:185](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L185)

Extracts the infrastructure type from an Aggregate definition.

## Type Parameters

### T

`T` _extends_ [`Aggregate`](/api/interfaces/aggregate/)
