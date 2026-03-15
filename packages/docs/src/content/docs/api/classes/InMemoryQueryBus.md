---
editUrl: false
next: false
prev: false
title: "InMemoryQueryBus"
---

Defined in: [engine/implementations/in-memory-query-bus.ts:3](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-query-bus.ts#L3)

## Implements

- [`QueryBus`](/api/interfaces/querybus/)

## Constructors

### Constructor

> **new InMemoryQueryBus**(): `InMemoryQueryBus`

Defined in: [engine/implementations/in-memory-query-bus.ts:4](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-query-bus.ts#L4)

#### Returns

`InMemoryQueryBus`

## Methods

### dispatch()

> **dispatch**\<`TQuery`\>(`query`): `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

Defined in: [engine/implementations/in-memory-query-bus.ts:6](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/implementations/in-memory-query-bus.ts#L6)

#### Type Parameters

##### TQuery

`TQuery` *extends* [`Query`](/api/interfaces/query/)\<`any`, `string`\>

#### Parameters

##### query

`TQuery`

#### Returns

`Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

#### Implementation of

[`QueryBus`](/api/interfaces/querybus/).[`dispatch`](/api/interfaces/querybus/#dispatch)
