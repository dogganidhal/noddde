---
editUrl: false
next: false
prev: false
title: "EvolveHandler"
---

> **EvolveHandler**\<`TEvent`, `TState`\> = (`event`, `state`) => `TState`

Defined in: [edd/event-sourcing-handler.ts:21](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event-sourcing-handler.ts#L21)

A pure, synchronous function that evolves aggregate state in response to an event. Must be deterministic and free of side effects.

## Type Parameters

### TEvent

`TEvent` _extends_ [`Event`](/api/interfaces/event/)

### TState

`TState`

## Parameters

### event

`TEvent`\[`"payload"`\]

### state

`TState`

## Returns

`TState`
