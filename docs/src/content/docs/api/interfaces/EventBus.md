---
editUrl: false
next: false
prev: false
title: "EventBus"
---

Defined in: [edd/event-bus.ts:10](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event-bus.ts#L10)

Publishes domain events to all registered listeners (projections, event handlers). The event bus is the backbone of the read-side update mechanism in CQRS.

## Methods

### dispatch()

> **dispatch**\<`TEvent`\>(`event`): `Promise`\<`void`\>

Defined in: [edd/event-bus.ts:12](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/edd/event-bus.ts#L12)

Publishes a single domain event to all subscribers.

#### Type Parameters

##### TEvent

`TEvent` _extends_ [`Event`](/api/interfaces/event/)

#### Parameters

##### event

`TEvent`

#### Returns

`Promise`\<`void`\>
