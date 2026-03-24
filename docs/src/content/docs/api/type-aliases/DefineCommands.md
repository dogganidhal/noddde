---
editUrl: false
next: false
prev: false
title: "DefineCommands"
---

> **DefineCommands**\<`TPayloads`, `TID`\> = `{ [K in keyof TPayloads & string]: TPayloads[K] extends void ? { name: K; targetAggregateId: TID } : { name: K; payload: TPayloads[K]; targetAggregateId: TID } }`\[keyof `TPayloads` & `string`\]

Defined in: [cqrs/command/command.ts:65](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L65)

Builds a discriminated union of aggregate command types from a payload map. Each key becomes a command `name`, and the value becomes its `payload` type. Use `void` for commands that carry no payload.

## Type Parameters

### TPayloads

`TPayloads` _extends_ `Record`\<`string`, `any`\>

### TID

`TID` _extends_ [`ID`](/api/type-aliases/id/) = `string`
