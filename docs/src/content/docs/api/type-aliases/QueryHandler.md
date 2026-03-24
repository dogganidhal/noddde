---
editUrl: false
next: false
prev: false
title: "QueryHandler"
---

> **QueryHandler**\<`TInfrastructure`, `TQuery`\> = (`query`, `infrastructure`) => [`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\> \| `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

Defined in: [cqrs/query/query-handler.ts:19](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query-handler.ts#L19)

A function that handles a query by reading from infrastructure and returning the expected result. Receives the query payload (not the full query object).

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
