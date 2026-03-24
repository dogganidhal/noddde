---
editUrl: false
next: false
prev: false
title: "QueryBus"
---

Defined in: [cqrs/query/query-bus.ts:11](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query-bus.ts#L11)

Dispatches queries to their registered handlers and returns typed results. The query bus is the primary interface for reading data from projections and read models.

## Methods

### dispatch()

> **dispatch**\<`TQuery`\>(`query`): `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

Defined in: [cqrs/query/query-bus.ts:16](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query-bus.ts#L16)

Dispatches a query and returns its result. Return type is inferred from the query's phantom `TResult` type.

#### Type Parameters

##### TQuery

`TQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\>

#### Parameters

##### query

`TQuery`

#### Returns

`Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>
