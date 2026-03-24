---
editUrl: false
next: false
prev: false
title: "InferSagaState"
---

> **InferSagaState**\<`T`\> = `T` _extends_ `Saga`\<infer U\> ? `U`\[`"state"`\] : `never`

Defined in: [ddd/saga.ts:222](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L222)

Extracts the saga state type from a Saga definition.

## Type Parameters

### T

`T` _extends_ `Saga`
