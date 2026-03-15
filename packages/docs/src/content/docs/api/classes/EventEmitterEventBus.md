---
editUrl: false
next: false
prev: false
title: "EventEmitterEventBus"
---

Defined in: [engine/implementations/ee-event-bus.ts:4](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/ee-event-bus.ts#L4)

## Implements

- [`EventBus`](/api/interfaces/eventbus/)

## Constructors

### Constructor

> **new EventEmitterEventBus**(): `EventEmitterEventBus`

#### Returns

`EventEmitterEventBus`

## Methods

### dispatch()

> **dispatch**\<`TEvent`\>(`event`): `Promise`\<`void`\>

Defined in: [engine/implementations/ee-event-bus.ts:7](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/ee-event-bus.ts#L7)

#### Type Parameters

##### TEvent

`TEvent` *extends* [`Event`](/api/interfaces/event/)

#### Parameters

##### event

`TEvent`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`EventBus`](/api/interfaces/eventbus/).[`dispatch`](/api/interfaces/eventbus/#dispatch)
