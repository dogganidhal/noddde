---
editUrl: false
next: false
prev: false
title: "AggregateTypes"
---

> **AggregateTypes** = `object`

Defined in: [ddd/aggregate-root.ts:23](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L23)

A bundle of the four type parameters that define an aggregate's type universe. Instead of threading 4+ positional generics through every type, users declare a single named `AggregateTypes`.

## Properties

### state

> **state**: `any`

The aggregate's state shape.

---

### events

> **events**: [`Event`](/api/interfaces/event/)

The discriminated union of all events this aggregate can emit.

---

### commands

> **commands**: [`AggregateCommand`](/api/interfaces/aggregatecommand/)\<[`ID`](/api/type-aliases/id/)\>

The discriminated union of all commands this aggregate can handle.

---

### infrastructure

> **infrastructure**: [`Infrastructure`](/api/type-aliases/infrastructure/)

The external dependencies available to command handlers.
