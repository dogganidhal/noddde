---
editUrl: false
next: false
prev: false
title: "QueryHandler"
---

> **QueryHandler**\<`TInfrastructure`, `TQuery`\> = (`query`, `infrastructure`) => [`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\> \| `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

Defined in: [cqrs/query/query-handler.ts:4](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/query/query-handler.ts#L4)

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

### TQuery

`TQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\>

## Parameters

### query

`TQuery`\[`"payload"`\]

### infrastructure

`TInfrastructure`

## Returns

[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\> \| `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>
