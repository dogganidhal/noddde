---
editUrl: false
next: false
prev: false
title: "InferProjectionInfrastructure"
---

> **InferProjectionInfrastructure**\<`T`\> = `T` _extends_ `Projection`\<infer U\> ? `U`\[`"infrastructure"`\] : `never`

Defined in: [ddd/projection.ts:258](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/projection.ts#L258)

Extracts the infrastructure type from a Projection definition.

## Type Parameters

### T

`T` _extends_ `Projection`
