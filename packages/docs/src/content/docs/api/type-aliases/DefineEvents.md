---
editUrl: false
next: false
prev: false
title: "DefineEvents"
---

> **DefineEvents**\<`TPayloads`\> = `{ [K in keyof TPayloads & string]: { name: K; payload: TPayloads[K] } }`\[keyof `TPayloads` & `string`\]

Defined in: [edd/event.ts:13](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/edd/event.ts#L13)

## Type Parameters

### TPayloads

`TPayloads` _extends_ `Record`\<`string`, `any`\>
