---
editUrl: false
next: false
prev: false
title: "QueryResult"
---

> **QueryResult**\<`TQuery`\> = `TQuery` _extends_ \{ readonly \[\_queryResult\]?: infer TResult \} ? `TResult` : `never`

Defined in: [cqrs/query/query.ts:47](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query.ts#L47)

Extracts the result type from a query type by reading the branded symbol property.

## Type Parameters

### TQuery

`TQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\>
