---
editUrl: false
next: false
prev: false
title: "InMemoryQueryBus"
---

Defined in: [engine/implementations/in-memory-query-bus.ts:17](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-query-bus.ts#L17)

In-memory `QueryBus` implementation. Queries are routed by their `name` field. Only one handler per query name is allowed.

## Implements

- [`QueryBus`](/api/interfaces/querybus/)

## Constructors

### Constructor

> **new InMemoryQueryBus**(): `InMemoryQueryBus`

#### Returns

`InMemoryQueryBus`

## Methods

### register()

> **register**(`queryName`, `handler`): `void`

Defined in: [engine/implementations/in-memory-query-bus.ts:28](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-query-bus.ts#L28)

Registers a handler for a given query name. Throws if a handler is already registered.

#### Parameters

##### queryName

`string`

##### handler

(`payload`: `any`) => `any` \| `Promise`\<`any`\>

#### Returns

`void`

---

### dispatch()

> **dispatch**\<`TQuery`\>(`query`): `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

Defined in: [engine/implementations/in-memory-query-bus.ts:43](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/implementations/in-memory-query-bus.ts#L43)

Dispatches a query to its registered handler. Throws if no handler is registered.

#### Type Parameters

##### TQuery

`TQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\>

#### Parameters

##### query

`TQuery`

#### Returns

`Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

#### Implementation of

[`QueryBus`](/api/interfaces/querybus/).[`dispatch`](/api/interfaces/querybus/#dispatch)
