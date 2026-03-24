---
editUrl: false
next: false
prev: false
title: "Saga"
---

Defined in: [ddd/saga.ts:138](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L138)

A saga definition following the process manager pattern: initial state, event handlers (react), association logic (identity), and lifecycle declaration (startedBy).

## Type Parameters

### T

`T` _extends_ [`SagaTypes`](/api/type-aliases/sagatypes/) = [`SagaTypes`](/api/type-aliases/sagatypes/)

### TSagaId

`TSagaId` _extends_ [`ID`](/api/type-aliases/id/) = `string`

## Properties

### initialState

> **initialState**: `T`\[`"state"`\]

Defined in: [ddd/saga.ts:146](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L146)

The zero-value state used when a saga instance is first created.

---

### startedBy

> **startedBy**: \[`T`\[`"events"`\]\[`"name"`\], ...`T`\[`"events"`\]\[`"name"`\]\[\]\]

Defined in: [ddd/saga.ts:155](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L155)

One or more event names that start a new saga instance. Must be a non-empty subset of the saga's event names.

---

### associations

> **associations**: `SagaAssociationMap`\<`T`, `TSagaId`\>

Defined in: [ddd/saga.ts:162](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L162)

Maps each event to a function that extracts the saga instance ID. Every event the saga handles must have an association entry.

---

### handlers

> **handlers**: `SagaEventHandlerMap`\<`T`\>

Defined in: [ddd/saga.ts:168](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L168)

A map of event handlers keyed by event name. Each handler implements the "react" phase.
