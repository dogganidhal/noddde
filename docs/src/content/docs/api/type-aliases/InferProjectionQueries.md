---
editUrl: false
next: false
prev: false
title: "InferProjectionQueries"
---

> **InferProjectionQueries**\<`T`\> = `T` _extends_ `Projection`\<infer U\> ? `U`\[`"queries"`\] : `never`

Defined in: [ddd/projection.ts:247](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L247)

Extracts the query union type from a Projection definition.

## Type Parameters

### T

`T` _extends_ `Projection`
