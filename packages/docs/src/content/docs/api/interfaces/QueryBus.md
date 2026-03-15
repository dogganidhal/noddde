---
editUrl: false
next: false
prev: false
title: "QueryBus"
---

Defined in: [cqrs/query/query-bus.ts:3](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/query/query-bus.ts#L3)

## Methods

### dispatch()

> **dispatch**\<`TQuery`\>(`query`): `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

Defined in: [cqrs/query/query-bus.ts:4](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/cqrs/query/query-bus.ts#L4)

#### Type Parameters

##### TQuery

`TQuery` *extends* [`Query`](/api/interfaces/query/)\<`any`, `string`\>

#### Parameters

##### query

`TQuery`

#### Returns

`Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>
