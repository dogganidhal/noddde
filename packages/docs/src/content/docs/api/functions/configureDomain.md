---
editUrl: false
next: false
prev: false
title: "configureDomain"
---

> **configureDomain**\<`TInfrastructure`, `TStandaloneCommandNames`\>(`configuration`): `Promise`\<[`Domain`](/api/classes/domain/)\<`TInfrastructure`\>\>

Defined in: [engine/domain.ts:103](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L103)

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

### TStandaloneCommandNames

`TStandaloneCommandNames` _extends_ `string` \| `symbol` = `string` \| `symbol`

## Parameters

### configuration

[`DomainConfiguration`](/api/type-aliases/domainconfiguration/)\<`TInfrastructure`, `TStandaloneCommandNames`\>

## Returns

`Promise`\<[`Domain`](/api/classes/domain/)\<`TInfrastructure`\>\>
