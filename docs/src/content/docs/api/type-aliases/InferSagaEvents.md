---
editUrl: false
next: false
prev: false
title: "InferSagaEvents"
---

> **InferSagaEvents**\<`T`\> = `T` _extends_ `Saga`\<infer U\> ? `U`\[`"events"`\] : `never`

Defined in: [ddd/saga.ts:233](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L233)

Extracts the event union type from a Saga definition.

## Type Parameters

### T

`T` _extends_ `Saga`
