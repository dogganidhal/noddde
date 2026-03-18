---
editUrl: false
next: false
prev: false
title: "DefineCommands"
---

> **DefineCommands**\<`TPayloads`, `TID`\> = `{ [K in keyof TPayloads & string]: TPayloads[K] extends void ? { name: K; targetAggregateId: TID } : { name: K; payload: TPayloads[K]; targetAggregateId: TID } }`\[keyof `TPayloads` & `string`\]

Defined in: [cqrs/command/command.ts:20](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/command/command.ts#L20)

## Type Parameters

### TPayloads

`TPayloads` _extends_ `Record`\<`string`, `any`\>

### TID

`TID` = `string`
