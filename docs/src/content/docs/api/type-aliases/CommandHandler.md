---
editUrl: false
next: false
prev: false
title: "CommandHandler"
---

> **CommandHandler**\<`TCommand`, `TState`, `TEvents`, `TInfrastructure`\> = (`command`, `state`, `infrastructure`) => `TEvents` \| `TEvents`[] \| `Promise`\<`TEvents` \| `TEvents`[]\>

Defined in: [ddd/aggregate-root.ts:22](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/ddd/aggregate-root.ts#L22)

## Type Parameters

### TCommand

`TCommand` _extends_ [`AggregateCommand`](/api/interfaces/aggregatecommand/)

### TState

`TState`

### TEvents

`TEvents` _extends_ [`Event`](/api/interfaces/event/)

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/) = [`Infrastructure`](/api/type-aliases/infrastructure/)

## Parameters

### command

`TCommand`

### state

`TState`

### infrastructure

`TInfrastructure`

## Returns

`TEvents` \| `TEvents`[] \| `Promise`\<`TEvents` \| `TEvents`[]\>
