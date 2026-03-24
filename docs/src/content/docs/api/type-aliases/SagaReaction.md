---
editUrl: false
next: false
prev: false
title: "SagaReaction"
---

> **SagaReaction**\<`TState`, `TCommands`\> = `object`

Defined in: [ddd/saga.ts:52](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L52)

The return type of a saga event handler. Contains the new saga state and zero or more commands to dispatch.

## Type Parameters

### TState

`TState`

### TCommands

`TCommands` _extends_ [`Command`](/api/interfaces/command/)

## Properties

### state

> **state**: `TState`

The updated saga state after processing this event.

---

### commands?

> `optional` **commands**: `TCommands` \| `TCommands`[]

Commands to dispatch as a result of this event.
