---
editUrl: false
next: false
prev: false
title: "Command"
---

Defined in: [cqrs/command/command.ts:11](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L11)

Base interface for all commands. Commands represent an intent to perform an action in the domain.

## Extended by

- [`AggregateCommand`](/api/interfaces/aggregatecommand/)

## Properties

### name

> **name**: `string`

Defined in: [cqrs/command/command.ts:13](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L13)

Discriminant field used to identify the command type and enable type narrowing.

---

### payload?

> `optional` **payload**: `any`

Defined in: [cqrs/command/command.ts:15](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L15)

Optional data carried by the command.

---

### commandId?

> `optional` **commandId**: [`ID`](/api/type-aliases/id/)

Defined in: [cqrs/command/command.ts:21](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L21)

Optional unique identifier for idempotent command processing. When present and an `IdempotencyStore` is configured, the engine checks this value to skip duplicate commands.
