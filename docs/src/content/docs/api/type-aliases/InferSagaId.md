---
editUrl: false
next: false
prev: false
title: "InferSagaId"
---

> **InferSagaId**\<`T`\> = `T` _extends_ `Saga`\<`any`, infer TId\> ? `TId` : `never`

Defined in: [ddd/saga.ts:266](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L266)

Extracts the saga instance ID type from a Saga definition.

## Type Parameters

### T

`T` _extends_ `Saga`
