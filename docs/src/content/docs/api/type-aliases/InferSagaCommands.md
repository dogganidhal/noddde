---
editUrl: false
next: false
prev: false
title: "InferSagaCommands"
---

> **InferSagaCommands**\<`T`\> = `T` _extends_ `Saga`\<infer U\> ? `U`\[`"commands"`\] : `never`

Defined in: [ddd/saga.ts:244](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L244)

Extracts the command union type from a Saga definition.

## Type Parameters

### T

`T` _extends_ `Saga`
