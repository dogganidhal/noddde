---
editUrl: false
next: false
prev: false
title: "configureDomain"
---

> **configureDomain**\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`, `TAggregates`\>(`configuration`): `Promise`\<[`Domain`](/api/classes/domain/)\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`\>\>

Defined in: [engine/domain.ts:796](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L796)

Creates and initializes a Domain instance from a configuration. This is the main entry point for bootstrapping a noddde application.

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

### TStandaloneCommand

`TStandaloneCommand` _extends_ [`Command`](/api/interfaces/command/) = [`Command`](/api/interfaces/command/)

### TStandaloneQuery

`TStandaloneQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\> = [`Query`](/api/interfaces/query/)\<`any`\>

### TAggregates

`TAggregates` _extends_ `AggregateMap` = `AggregateMap`

## Parameters

### configuration

[`DomainConfiguration`](/api/type-aliases/domainconfiguration/)\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`, `TAggregates`\>

## Returns

`Promise`\<[`Domain`](/api/classes/domain/)\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`\>\>
