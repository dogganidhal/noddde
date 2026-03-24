---
editUrl: false
next: false
prev: false
title: "SagaEventHandler"
---

> **SagaEventHandler**\<`TEvent`, `TState`, `TCommands`, `TInfrastructure`\> = (`event`, `state`, `infrastructure`) => [`SagaReaction`](/api/type-aliases/sagareaction/)\<`TState`, `TCommands`\> \| `Promise`\<[`SagaReaction`](/api/type-aliases/sagareaction/)\<`TState`, `TCommands`\>\>

Defined in: [ddd/saga.ts:84](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L84)

A saga event handler implements the "react" phase of the process manager pattern. Receives a domain event, the current saga state, and infrastructure, then returns the new state plus commands to dispatch.

## Type Parameters

### TEvent

`TEvent` _extends_ [`Event`](/api/interfaces/event/)

### TState

`TState`

### TCommands

`TCommands` _extends_ [`Command`](/api/interfaces/command/)

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/) = [`Infrastructure`](/api/type-aliases/infrastructure/)

## Parameters

### event

`TEvent`

### state

`TState`

### infrastructure

`TInfrastructure` & [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)

## Returns

[`SagaReaction`](/api/type-aliases/sagareaction/)\<`TState`, `TCommands`\> \| `Promise`\<[`SagaReaction`](/api/type-aliases/sagareaction/)\<`TState`, `TCommands`\>\>
