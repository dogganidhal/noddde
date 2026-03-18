---
editUrl: false
next: false
prev: false
title: "InMemoryCommandBus"
---

Defined in: [engine/implementations/in-memory-command-bus.ts:3](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-command-bus.ts#L3)

## Implements

- [`CommandBus`](/api/interfaces/commandbus/)

## Constructors

### Constructor

> **new InMemoryCommandBus**(): `InMemoryCommandBus`

#### Returns

`InMemoryCommandBus`

## Methods

### dispatch()

> **dispatch**(`command`): `Promise`\<`void`\>

Defined in: [engine/implementations/in-memory-command-bus.ts:4](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-command-bus.ts#L4)

#### Parameters

##### command

[`Command`](/api/interfaces/command/)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`CommandBus`](/api/interfaces/commandbus/).[`dispatch`](/api/interfaces/commandbus/#dispatch)
