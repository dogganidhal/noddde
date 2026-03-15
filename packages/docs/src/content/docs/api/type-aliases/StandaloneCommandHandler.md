---
editUrl: false
next: false
prev: false
title: "StandaloneCommandHandler"
---

> **StandaloneCommandHandler**\<`TInfrastructure`, `TCommand`\> = (`command`, `infrastructure`) => `void` \| `Promise`\<`void`\>

Defined in: [cqrs/command/command-handler.ts:4](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/command/command-handler.ts#L4)

## Type Parameters

### TInfrastructure

`TInfrastructure` *extends* [`Infrastructure`](/api/type-aliases/infrastructure/)

### TCommand

`TCommand` *extends* [`StandaloneCommand`](/api/type-aliases/standalonecommand/)

## Parameters

### command

`TCommand`

### infrastructure

`TInfrastructure` & [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)

## Returns

`void` \| `Promise`\<`void`\>
