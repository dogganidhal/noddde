---
editUrl: false
next: false
prev: false
title: "DomainDefinition"
---

> **DomainDefinition**\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`, `TAggregates`, `TStandaloneEvent`, `TProjections`\> = `object`

Defined in: [ddd/domain-definition.ts:63](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/domain-definition.ts#L63)

Pure structural definition of a domain. Contains aggregates, projections, sagas, and handler registrations — no runtime or infrastructure concerns.

Created via [`defineDomain`](/api/functions/definedomain/). Pass to `wireDomain` (from `@noddde/engine`) along with infrastructure wiring to create a running `Domain` instance.

For backward compatibility, `@noddde/engine` re-exports `DomainDefinition` from `@noddde/core`, so existing `import type { DomainDefinition } from "@noddde/engine"` keeps working.

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/) = [`Infrastructure`](/api/type-aliases/infrastructure/)

The custom infrastructure type referenced by handler signatures. The definition itself does not hold an infrastructure value — it is wired separately by `wireDomain`.

### TStandaloneCommand

`TStandaloneCommand` _extends_ [`Command`](/api/interfaces/command/) = [`Command`](/api/interfaces/command/)

The discriminated union of standalone command types.

### TStandaloneQuery

`TStandaloneQuery` _extends_ [`Query`](/api/interfaces/query/)\<`any`\> = [`Query`](/api/interfaces/query/)\<`any`\>

The discriminated union of standalone query types.

### TAggregates

`TAggregates` _extends_ `Record<string | symbol, Aggregate<any>>` = `Record<string | symbol, Aggregate<any>>`

The aggregate map. Inferred narrow type preserves typed dispatch downstream.

### TStandaloneEvent

`TStandaloneEvent` _extends_ [`Event`](/api/interfaces/event/) = [`Event`](/api/interfaces/event/)

The discriminated union of standalone event types.

### TProjections

`TProjections` _extends_ `Record<string | symbol, Projection<any>>` = `Record<string | symbol, Projection<any>>`

The projection map. Inferred narrow type preserves typed query dispatch downstream.

## Properties

### writeModel

> **writeModel**: `object`

The write side: aggregates and standalone command handlers.

| Property                     | Type                                                       | Description                                             |
| :--------------------------- | :--------------------------------------------------------- | :------------------------------------------------------ |
| `aggregates`                 | `TAggregates`                                              | A map of aggregate definitions keyed by aggregate name. |
| `standaloneCommandHandlers?` | _Optional_ map of `StandaloneCommandHandler` keyed by name | Standalone command handlers (file-private map type).    |

---

### readModel

> **readModel**: `object`

The read side: projections and standalone query handlers.

| Property                   | Type                                           | Description                                        |
| :------------------------- | :--------------------------------------------- | :------------------------------------------------- |
| `projections`              | `TProjections`                                 | A map of projection definitions keyed by name.     |
| `standaloneQueryHandlers?` | _Optional_ map of `QueryHandler` keyed by name | Standalone query handlers (file-private map type). |

---

### processModel?

> _Optional_ **processModel**: `object`

Process model: sagas and standalone event handlers. Optional — omit if the domain has no cross-aggregate workflows or event-driven side effects.

| Property                   | Type                                           | Description                                        |
| :------------------------- | :--------------------------------------------- | :------------------------------------------------- |
| `sagas?`                   | _Optional_ map of `Saga` keyed by name         | A map of saga definitions. Omit if no sagas.       |
| `standaloneEventHandlers?` | _Optional_ map of `EventHandler` keyed by name | Standalone event handlers (file-private map type). |
