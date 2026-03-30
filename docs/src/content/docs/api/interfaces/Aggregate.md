---
editUrl: false
next: false
prev: false
title: "Aggregate"
---

Defined in: [ddd/aggregate-root.ts:89](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L89)

An aggregate definition following the Decider pattern: initial state, decide handlers, and evolve handlers. No base classes, no decorators.

## Type Parameters

### T

`T` _extends_ [`AggregateTypes`](/api/type-aliases/aggregatetypes/) = [`AggregateTypes`](/api/type-aliases/aggregatetypes/)

## Properties

### initialState

> **initialState**: `T`\[`"state"`\]

Defined in: [ddd/aggregate-root.ts:91](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L91)

The zero-value state used when no events have been applied yet.

---

### decide

> **decide**: `DecideHandlerMap`\<`T`\>

Defined in: [ddd/aggregate-root.ts:96](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L96)

A map of decide handlers keyed by command name. Each handler implements the "decide" phase.

---

### evolve

> **evolve**: `EvolveHandlerMap`\<`T`\>

Defined in: [ddd/aggregate-root.ts:101](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L101)

A map of evolve handlers keyed by event name. Each handler implements the "evolve" phase. Must be pure.

---

### upcasters?

> `optional` **upcasters**: [`UpcasterMap`](/api/type-aliases/upcastermap/)\<`T`\[`"events"`\]\>

Defined in: [ddd/aggregate-root.ts:112](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L112)

Optional map of event upcaster chains for schema evolution. Each chain transforms events from older versions to the current schema. Applied during event replay before evolve handlers.
