---
editUrl: false
next: false
prev: false
title: "InferProjectionEvents"
---

> **InferProjectionEvents**\<`T`\> = `T` _extends_ `Projection`\<infer U\> ? `U`\[`"events"`\] : `never`

Defined in: [ddd/projection.ts:236](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L236)

Extracts the event union type from a Projection definition.

## Type Parameters

### T

`T` _extends_ `Projection`
