---
editUrl: false
next: false
prev: false
title: "DecideHandler"
---

> **DecideHandler**\<`TCommand`, `TState`, `TEvents`, `TInfrastructure`\> = (`command`, `state`, `infrastructure`) => `TEvents` \| `TEvents`[] \| `Promise`\<`TEvents` \| `TEvents`[]\>

Defined in: [ddd/aggregate-root.ts:51](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L51)

A decide handler implements the "decide" phase of the Decider pattern. It receives a command, the current aggregate state, and infrastructure, then returns the event(s) representing what happened.

## Type Parameters

### TCommand

`TCommand` _extends_ [`AggregateCommand`](/api/interfaces/aggregatecommand/)\<[`ID`](/api/type-aliases/id/)\>

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
