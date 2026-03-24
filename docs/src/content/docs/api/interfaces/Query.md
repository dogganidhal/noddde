---
editUrl: false
next: false
prev: false
title: "Query"
---

Defined in: [cqrs/query/query.ts:24](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query.ts#L24)

Base interface for all queries. Queries represent questions asked to the read model and carry a phantom `TResult` type via a branded symbol property.

## Type Parameters

### TResult

`TResult`

### TQueryNames

`TQueryNames` _extends_ `string` \| `symbol` = `string`

## Properties

### name

> **name**: `TQueryNames`

Defined in: [cqrs/query/query.ts:26](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query.ts#L26)

Discriminant field used to identify the query type.

---

### payload?

> `optional` **payload**: `any`

Defined in: [cqrs/query/query.ts:28](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query.ts#L28)

Optional data carried by the query (filters, IDs, etc.).
