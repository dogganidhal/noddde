---
editUrl: false
next: false
prev: false
title: "CommandBus"
---

Defined in: [cqrs/command/command-bus.ts:11](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command-bus.ts#L11)

Dispatches commands to their registered handlers. Routes aggregate commands to the appropriate aggregate and standalone commands to standalone command handlers.

## Methods

### dispatch()

> **dispatch**(`command`): `Promise`\<`void`\>

Defined in: [cqrs/command/command-bus.ts:13](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command-bus.ts#L13)

Dispatches a command for processing.

#### Parameters

##### command

[`Command`](/api/interfaces/command/)

#### Returns

`Promise`\<`void`\>
