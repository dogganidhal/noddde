---
editUrl: false
next: false
prev: false
title: "DomainConfiguration"
---

> **DomainConfiguration**\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`, `TAggregates`\> = `object`

Defined in: [engine/domain.ts:115](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L115)

The full configuration object for a domain, wiring together the write model (aggregates + standalone command handlers), the read model (projections + standalone query handlers), process model (sagas), and infrastructure factories.

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

### TStandaloneCommand

`TStandaloneCommand` _extends_ [`Command`](/api/interfaces/command/) = [`Command`](/api/interfaces/command/)

### TStandaloneQuery

`TStandaloneQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\> = [`Query`](/api/interfaces/query/)\<`any`\>

### TAggregates

`TAggregates` _extends_ `AggregateMap` = `AggregateMap`

## Properties

### writeModel

> **writeModel**: `object`

The write side: aggregates and standalone command handlers.

#### aggregates

> **aggregates**: `TAggregates`

#### standaloneCommandHandlers?

> `optional` **standaloneCommandHandlers**: `StandaloneCommandHandlerMap`\<`TInfrastructure`, `TStandaloneCommand`\>

---

### readModel

> **readModel**: `object`

The read side: projections and standalone query handlers.

#### projections

> **projections**: `ProjectionMap`

#### standaloneQueryHandlers?

> `optional` **standaloneQueryHandlers**: `StandaloneQueryHandlerMap`\<`TInfrastructure`, `TStandaloneQuery`\>

---

### processModel?

> `optional` **processModel**: `object`

Process managers (sagas) that orchestrate workflows across aggregates.

#### sagas

> **sagas**: `SagaMap`

---

### infrastructure

> **infrastructure**: `object`

Factory functions for providing infrastructure at startup.

#### aggregatePersistence?

> `optional` **aggregatePersistence**: `PersistenceFactory` \| `Record`\<keyof `TAggregates` & `string`, `PersistenceFactory`\>

Aggregate persistence strategy. Either a single factory function (domain-wide) or a per-aggregate record.

#### aggregateConcurrency?

> `optional` **aggregateConcurrency**: `{ strategy?: "optimistic"; maxRetries?: number }` \| `{ strategy: "pessimistic"; locker: AggregateLocker; lockTimeoutMs?: number }`

Concurrency control strategy for aggregate persistence.

#### sagaPersistence()?

> `optional` **sagaPersistence**: () => [`SagaPersistence`](/api/interfaces/sagapersistence/) \| `Promise`\<[`SagaPersistence`](/api/interfaces/sagapersistence/)\>

Factory for saga persistence. Required if `processModel` is configured.

#### snapshotStore()?

> `optional` **snapshotStore**: () => [`SnapshotStore`](/api/interfaces/snapshotstore/) \| `Promise`\<[`SnapshotStore`](/api/interfaces/snapshotstore/)\>

Factory for the snapshot store.

#### snapshotStrategy?

> `optional` **snapshotStrategy**: [`SnapshotStrategy`](/api/type-aliases/snapshotstrategy/)

Strategy that decides when to take a snapshot.

#### idempotencyStore()?

> `optional` **idempotencyStore**: () => [`IdempotencyStore`](/api/interfaces/idempotencystore/) \| `Promise`\<[`IdempotencyStore`](/api/interfaces/idempotencystore/)\>

Factory for the idempotency store.

#### provideInfrastructure()?

> `optional` **provideInfrastructure**: () => `Promise`\<`TInfrastructure`\> \| `TInfrastructure`

##### Returns

`Promise`\<`TInfrastructure`\> \| `TInfrastructure`

#### cqrsInfrastructure()?

> `optional` **cqrsInfrastructure**: (`infrastructure`) => [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/) \| `Promise`\<[`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)\>

##### Parameters

###### infrastructure

`TInfrastructure`

##### Returns

[`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/) \| `Promise`\<[`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)\>

#### unitOfWorkFactory()?

> `optional` **unitOfWorkFactory**: () => [`UnitOfWorkFactory`](/api/type-aliases/unitofworkfactory/) \| `Promise`\<[`UnitOfWorkFactory`](/api/type-aliases/unitofworkfactory/)\>

Factory for the UnitOfWorkFactory.

---

### metadataProvider?

> `optional` **metadataProvider**: [`MetadataProvider`](/api/type-aliases/metadataprovider/)

Optional metadata provider called on every command dispatch.
