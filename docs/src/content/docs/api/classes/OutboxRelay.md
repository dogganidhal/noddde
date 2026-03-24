---
editUrl: false
next: false
prev: false
title: "OutboxRelay"
---

Defined in: [outbox-relay.ts:24](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/outbox-relay.ts#L24)

Background process that polls the [`OutboxStore`](/api/interfaces/outboxstore/) for unpublished entries and dispatches them via the [`EventBus`](/api/interfaces/eventbus/). Provides at-least-once delivery guarantees for domain events.

Created and managed by the Domain. Exported from `@noddde/engine` for testing.

## Constructors

### Constructor

> **new OutboxRelay**(`outboxStore`, `eventBus`, `options`?): `OutboxRelay`

#### Parameters

##### outboxStore

[`OutboxStore`](/api/interfaces/outboxstore/)

##### eventBus

[`EventBus`](/api/interfaces/eventbus/)

##### options?

[`OutboxRelayOptions`](/api/interfaces/outboxrelayoptions/)

#### Returns

`OutboxRelay`

## Methods

### start()

> **start**(): `void`

Start polling for unpublished entries. Idempotent: calling `start()` when already running is a no-op.

#### Returns

`void`

---

### stop()

> **stop**(): `void`

Stop polling. Idempotent: calling `stop()` when not running is a no-op.

#### Returns

`void`

---

### processOnce()

> **processOnce**(): `Promise`\<`number`\>

Process one batch of unpublished entries. Loads entries, dispatches each via EventBus, marks each published. Returns the number of entries successfully dispatched.

#### Returns

`Promise`\<`number`\>
