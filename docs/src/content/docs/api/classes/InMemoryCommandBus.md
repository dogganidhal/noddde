---
editUrl: false
next: false
prev: false
title: "InMemoryCommandBus"
---

Defined in: [engine/implementations/in-memory-command-bus.ts:17](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-command-bus.ts#L17)

In-memory `CommandBus` implementation. Commands are routed by their `name` field. Only one handler per command name is allowed.

## Implements

- [`CommandBus`](/api/interfaces/commandbus/)

## Constructors

### Constructor

> **new InMemoryCommandBus**(): `InMemoryCommandBus`

#### Returns

`InMemoryCommandBus`

## Methods

### register()

> **register**(`commandName`, `handler`): `void`

Defined in: [engine/implementations/in-memory-command-bus.ts:27](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-command-bus.ts#L27)

Registers a handler for a given command name. Throws if a handler is already registered.

#### Parameters

##### commandName

`string`

##### handler

(`command`: [`Command`](/api/interfaces/command/)) => `void` \| `Promise`\<`void`\>

#### Returns

`void`

---

### dispatch()

> **dispatch**(`command`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-command-bus.ts:42](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-command-bus.ts#L42)

Dispatches a command to its registered handler. Throws if no handler is registered.

#### Parameters

##### command

[`Command`](/api/interfaces/command/)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`CommandBus`](/api/interfaces/commandbus/).[`dispatch`](/api/interfaces/commandbus/#dispatch)
