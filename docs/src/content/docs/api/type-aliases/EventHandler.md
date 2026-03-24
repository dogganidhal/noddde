---
editUrl: false
next: false
prev: false
title: "EventHandler"
---

> **EventHandler**\<`TEvent`, `TInfrastructure`\> = (`event`, `infrastructure`) => `void` \| `Promise`\<`void`\>

Defined in: [edd/event-handler.ts:21](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event-handler.ts#L21)

An impure, async-capable handler that reacts to domain events. Receives the full event object (including optional metadata).

## Type Parameters

### TEvent

`TEvent` _extends_ [`Event`](/api/interfaces/event/)

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

## Parameters

### event

`TEvent`

### infrastructure

`TInfrastructure`

## Returns

`void` \| `Promise`\<`void`\>
