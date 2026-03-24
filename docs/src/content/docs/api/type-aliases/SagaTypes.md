---
editUrl: false
next: false
prev: false
title: "SagaTypes"
---

> **SagaTypes** = `object`

Defined in: [ddd/saga.ts:31](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L31)

A bundle of the four type parameters that define a saga's type universe. Mirrors the `AggregateTypes` pattern for aggregates.

## Properties

### state

> **state**: `any`

The saga's internal state tracking workflow progress.

---

### events

> **events**: [`Event`](/api/interfaces/event/)

The discriminated union of all events this saga reacts to.

---

### commands

> **commands**: [`Command`](/api/interfaces/command/)

The discriminated union of all commands this saga may dispatch.

---

### infrastructure

> **infrastructure**: [`Infrastructure`](/api/type-aliases/infrastructure/)

The external dependencies available to event handlers.
