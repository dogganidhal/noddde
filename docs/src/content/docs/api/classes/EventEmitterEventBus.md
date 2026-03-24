---
editUrl: false
next: false
prev: false
title: "EventEmitterEventBus"
---

Defined in: [engine/implementations/ee-event-bus.ts:20](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/ee-event-bus.ts#L20)

In-memory `EventBus` implementation backed by Node.js `EventEmitter`. Handlers registered via `on` are awaited during `dispatch`, ensuring async projection reducers and saga handlers complete before dispatch resolves.

## Implements

- [`EventBus`](/api/interfaces/eventbus/)

## Constructors

### Constructor

> **new EventEmitterEventBus**(): `EventEmitterEventBus`

#### Returns

`EventEmitterEventBus`

## Methods

### on()

> **on**(`eventName`, `handler`): `void`

Defined in: [engine/implementations/ee-event-bus.ts:37](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/ee-event-bus.ts#L37)

Registers an async-capable event handler for a given event name.

#### Parameters

##### eventName

`string`

##### handler

(`event`: [`Event`](/api/interfaces/event/)) => `void` \| `Promise`\<`void`\>

#### Returns

`void`

---

### dispatch()

> **dispatch**\<`TEvent`\>(`event`): `Promise`\<`void`\>

Defined in: [engine/implementations/ee-event-bus.ts:51](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/ee-event-bus.ts#L51)

Dispatches an event to all registered handlers and awaits their completion.

#### Type Parameters

##### TEvent

`TEvent` _extends_ [`Event`](/api/interfaces/event/)

#### Parameters

##### event

`TEvent`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`EventBus`](/api/interfaces/eventbus/).[`dispatch`](/api/interfaces/eventbus/#dispatch)
