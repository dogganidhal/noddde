---
editUrl: false
next: false
prev: false
title: "Saga"
---

Defined in: [ddd/saga.ts:162](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L162)

A saga definition following the process manager pattern: initial state, lifecycle declaration (startedBy), and a unified `on` map that bundles identity extraction and event handling per event type.

## Type Parameters

### T

`T` _extends_ [`SagaTypes`](/api/type-aliases/sagatypes/) = [`SagaTypes`](/api/type-aliases/sagatypes/)

### TSagaId

`TSagaId` _extends_ [`ID`](/api/type-aliases/id/) = `string`

## Properties

### initialState

> **initialState**: `T`\[`"state"`\]

Defined in: [ddd/saga.ts:170](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L170)

The zero-value state used when a saga instance is first created.

---

### startedBy

> **startedBy**: \[`T`\[`"events"`\]\[`"name"`\], ...`T`\[`"events"`\]\[`"name"`\]\[\]\]

Defined in: [ddd/saga.ts:179](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L179)

One or more event names that start a new saga instance. Must be a non-empty subset of the saga's event names.

---

### on

> **on**: `SagaOnMap`\<`T`, `TSagaId`\>

Defined in: [ddd/saga.ts:187](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L187)

A partial map of event handlers keyed by event name. Each entry bundles an `id` function (extracts saga instance ID) and a `handle` function (processes the event). Only events the saga handles need entries.
