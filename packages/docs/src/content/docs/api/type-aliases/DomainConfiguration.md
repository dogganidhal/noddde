---
editUrl: false
next: false
prev: false
title: "DomainConfiguration"
---

> **DomainConfiguration**\<`TInfrastructure`, `TStandaloneCommandNames`, `TStandaloneQueryNames`\> = `object`

Defined in: [engine/domain.ts:50](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L50)

## Type Parameters

### TInfrastructure

`TInfrastructure` *extends* [`Infrastructure`](/api/type-aliases/infrastructure/)

### TStandaloneCommandNames

`TStandaloneCommandNames` *extends* `string` \| `symbol` = `string` \| `symbol`

### TStandaloneQueryNames

`TStandaloneQueryNames` *extends* `string` \| `symbol` = `string` \| `symbol`

## Properties

### infrastructure

> **infrastructure**: `object`

Defined in: [engine/domain.ts:69](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L69)

#### aggregatePersistence()?

> `optional` **aggregatePersistence**: () => `PersistenceConfiguration` \| `Promise`\<`PersistenceConfiguration`\>

##### Returns

`PersistenceConfiguration` \| `Promise`\<`PersistenceConfiguration`\>

#### cqrsInfrastructure()?

> `optional` **cqrsInfrastructure**: (`infrastructure`) => [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/) \| `Promise`\<[`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)\>

##### Parameters

###### infrastructure

`TInfrastructure`

##### Returns

[`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/) \| `Promise`\<[`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)\>

#### provideInfrastructure()?

> `optional` **provideInfrastructure**: () => `Promise`\<`TInfrastructure`\> \| `TInfrastructure`

##### Returns

`Promise`\<`TInfrastructure`\> \| `TInfrastructure`

***

### readModel

> **readModel**: `object`

Defined in: [engine/domain.ts:62](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L62)

#### projections

> **projections**: `ProjectionMap`\<`TInfrastructure`\>

#### standaloneQueryHandlers?

> `optional` **standaloneQueryHandlers**: `StandaloneQueryHandlerMap`\<`TInfrastructure`, `TStandaloneQueryNames`\>

***

### writeModel

> **writeModel**: `object`

Defined in: [engine/domain.ts:55](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L55)

#### aggregates

> **aggregates**: `AggregateMap`

#### standaloneCommandHandlers?

> `optional` **standaloneCommandHandlers**: `StandaloneCommandHandlerMap`\<`TInfrastructure`, `TStandaloneCommandNames`\>
