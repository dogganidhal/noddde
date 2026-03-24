---
editUrl: false
next: false
prev: false
title: "StandaloneCommandHandler"
---

> **StandaloneCommandHandler**\<`TInfrastructure`, `TCommand`\> = (`command`, `infrastructure`) => `void` \| `Promise`\<`void`\>

Defined in: [cqrs/command/command-handler.ts:18](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command-handler.ts#L18)

A handler for standalone commands (commands not routed to an aggregate). Receives the full infrastructure merged with CQRS buses.

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

### TCommand

`TCommand` _extends_ [`StandaloneCommand`](/api/type-aliases/standalonecommand/)

## Parameters

### command

`TCommand`

### infrastructure

`TInfrastructure` & [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)

## Returns

`void` \| `Promise`\<`void`\>
