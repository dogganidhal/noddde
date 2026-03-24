---
editUrl: false
next: false
prev: false
title: "InferProjectionView"
---

> **InferProjectionView**\<`T`\> = `T` _extends_ `Projection`\<infer U\> ? `U`\[`"view"`\] : `never`

Defined in: [ddd/projection.ts:225](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L225)

Extracts the view type from a Projection definition.

## Type Parameters

### T

`T` _extends_ `Projection`
