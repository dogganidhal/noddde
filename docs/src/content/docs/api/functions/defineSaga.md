---
editUrl: false
next: false
prev: false
title: "defineSaga"
---

> **defineSaga**\<`T`, `TSagaId`\>(`config`): [`Saga`](/api/interfaces/saga/)\<`T`, `TSagaId`\>

Defined in: [ddd/saga.ts:206](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/saga.ts#L206)

Identity function that creates a saga definition with full type inference across the event/command/state/infrastructure boundaries. This is the recommended way to define sagas.

## Type Parameters

### T

`T` _extends_ [`SagaTypes`](/api/type-aliases/sagatypes/)

### TSagaId

`TSagaId` _extends_ [`ID`](/api/type-aliases/id/) = `string`

## Parameters

### config

[`Saga`](/api/interfaces/saga/)\<`T`, `TSagaId`\>

## Returns

[`Saga`](/api/interfaces/saga/)\<`T`, `TSagaId`\>
