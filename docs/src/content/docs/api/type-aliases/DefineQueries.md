---
editUrl: false
next: false
prev: false
title: "DefineQueries"
---

> **DefineQueries**\<`TDefinitions`\> = `{ [K in keyof TDefinitions & string]: ... }`\[keyof `TDefinitions` & `string`\]

Defined in: [cqrs/query/query.ts:77](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/query/query.ts#L77)

Builds a discriminated union of query types from a definition map. Each key becomes a query `name`. Each value specifies a `result` type and an optional `payload` type. The result type is carried via a branded symbol.

## Type Parameters

### TDefinitions

`TDefinitions` _extends_ `Record`\<`string`, \{ `payload?`: `any`; `result`: `any` \}\>
