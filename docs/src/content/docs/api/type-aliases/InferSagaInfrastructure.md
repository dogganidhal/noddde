---
editUrl: false
next: false
prev: false
title: "InferSagaInfrastructure"
---

> **InferSagaInfrastructure**\<`T`\> = `T` _extends_ `Saga`\<infer U\> ? `U`\[`"infrastructure"`\] : `never`

Defined in: [ddd/saga.ts:255](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L255)

Extracts the infrastructure type from a Saga definition.

## Type Parameters

### T

`T` _extends_ `Saga`
