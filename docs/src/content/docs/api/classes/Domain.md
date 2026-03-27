---
editUrl: false
next: false
prev: false
title: "Domain"
---

Defined in: [engine/domain.ts:302](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L302)

The running domain instance. Created via `wireDomain`, it is the primary entry point for dispatching commands, queries, and accessing infrastructure.

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

### TStandaloneCommand

`TStandaloneCommand` _extends_ [`Command`](/api/interfaces/command/) = [`Command`](/api/interfaces/command/)

### TStandaloneQuery

`TStandaloneQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\> = [`Query`](/api/interfaces/query/)\<`any`\>

## Constructors

### Constructor

> **new Domain**\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`\>(`configuration`): `Domain`\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`\>

Defined in: [engine/domain.ts:318](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L318)

#### Parameters

##### definition

`DomainDefinition`\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`\>

##### wiring

`DomainWiring`\<`TInfrastructure`\>

#### Returns

`Domain`\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`\>

## Accessors

### infrastructure

#### Get Signature

> **get** **infrastructure**(): `TInfrastructure` & [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)

Defined in: [engine/domain.ts:314](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L314)

The fully resolved infrastructure (custom + CQRS buses).

##### Returns

`TInfrastructure` & [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)

## Methods

### init()

> **init**(): `Promise`\<`void`\>

Defined in: [engine/domain.ts:332](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L332)

Initializes the domain by calling all infrastructure factories in order: custom infrastructure, CQRS buses, persistence. Then registers command handlers, query handlers, projection event listeners, and saga event listeners.

#### Returns

`Promise`\<`void`\>

---

### dispatchCommand()

> **dispatchCommand**\<`TCommand`\>(`command`): `Promise`\<`TCommand`\[`"targetAggregateId"`\]\>

Defined in: [engine/domain.ts:737](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L737)

Dispatches a command to the appropriate aggregate. The full lifecycle: route by name, load state, execute handler, apply events, persist, publish.

#### Type Parameters

##### TCommand

`TCommand` _extends_ [`AggregateCommand`](/api/interfaces/aggregatecommand/)\<`any`\>

#### Parameters

##### command

`TCommand`

#### Returns

`Promise`\<`TCommand`\[`"targetAggregateId"`\]\>

---

### dispatchQuery()

> **dispatchQuery**\<`TQuery`\>(`query`): `Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

Defined in: [engine/domain.ts:763](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L763)

Dispatches a query to the registered query handler via the query bus.

#### Type Parameters

##### TQuery

`TQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\>

#### Parameters

##### query

`TQuery`

#### Returns

`Promise`\<[`QueryResult`](/api/type-aliases/queryresult/)\<`TQuery`\>\>

---

### withUnitOfWork()

> **withUnitOfWork**\<`T`\>(`fn`): `Promise`\<`T`\>

Defined in: [engine/domain.ts:675](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L675)

Executes a function within an explicit unit of work boundary. All commands dispatched inside `fn` share a single UnitOfWork. Persistence is deferred until the function completes, then committed atomically.

#### Type Parameters

##### T

`T`

#### Parameters

##### fn

() => `Promise`\<`T`\>

#### Returns

`Promise`\<`T`\>

---

### withMetadataContext()

> **withMetadataContext**\<`T`\>(`context`, `fn`): `Promise`\<`T`\>

Defined in: [engine/domain.ts:722](https://github.com/dogganidhal/noddde/blob/main/packages/engine/src/domain.ts#L722)

Executes a function within a metadata context that overrides the configured MetadataProvider. Values provided here take precedence over the domain's `metadataProvider`.

#### Type Parameters

##### T

`T`

#### Parameters

##### context

[`MetadataContext`](/api/interfaces/metadatacontext/)

##### fn

() => `Promise`\<`T`\>

#### Returns

`Promise`\<`T`\>

---

### startOutboxRelay()

> **startOutboxRelay**(): `void`

Starts the outbox relay background polling loop. No-op if no outbox is configured or if already started.

#### Returns

`void`

---

### stopOutboxRelay()

> **stopOutboxRelay**(): `void`

Stops the outbox relay background polling loop. No-op if no outbox is configured or if not running.

#### Returns

`void`

---

### processOutboxOnce()

> **processOutboxOnce**(): `Promise`\<`number`\>

Processes a single batch of unpublished outbox entries. Useful for testing — call this instead of starting the relay.

#### Returns

`Promise`\<`number`\>

The number of entries dispatched, or 0 if no outbox is configured.
