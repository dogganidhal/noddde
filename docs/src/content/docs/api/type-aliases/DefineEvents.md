---
editUrl: false
next: false
prev: false
title: "DefineEvents"
---

> **DefineEvents**\<`TPayloads`\> = `{ [K in keyof TPayloads & string]: { name: K; payload: TPayloads[K] } }`\[keyof `TPayloads` & `string`\]

Defined in: [edd/event.ts:43](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event.ts#L43)

Builds a discriminated union of event types from a payload map. Each key becomes an event `name`, and the value becomes its `payload` type.

## Type Parameters

### TPayloads

`TPayloads` _extends_ `Record`\<`string`, `any`\>
