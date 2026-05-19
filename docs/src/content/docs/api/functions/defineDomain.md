---
editUrl: false
next: false
prev: false
title: "defineDomain"
---

> **defineDomain**\<`T`\>(`definition`): `T`

Defined in: [ddd/domain-definition.ts:131](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/domain-definition.ts#L131)

Pure, sync identity function that creates a domain definition with full type inference. Captures the structural shape of a domain — aggregates, projections, sagas, and handler registrations — without any runtime or infrastructure concerns. Pass the result to `wireDomain` (from `@noddde/engine`) to obtain a running `Domain`.

Consistent with [`defineAggregate`](/api/functions/defineaggregate/), [`defineProjection`](/api/functions/defineprojection/), and [`defineSaga`](/api/functions/definesaga/).

For backward compatibility, `@noddde/engine` re-exports `defineDomain` from `@noddde/core`, so existing `import { defineDomain } from "@noddde/engine"` keeps working.

## Type Parameters

### T

`T` _extends_ [`DomainDefinition`](/api/type-aliases/domaindefinition/)\<`any`, `any`, `any`, `any`, `any`, `any`\>

## Parameters

### definition

`T`

## Returns

`T`

The same definition object, unchanged (reference equality with the input).

## Legacy Overload

> **defineDomain**\<`TInfrastructure`, `TStandaloneCommand`, `TStandaloneQuery`, `TAggregates`, `TStandaloneEvent`, `TProjections`\>(`definition`): [`DomainDefinition`](/api/type-aliases/domaindefinition/)\<...\>

A legacy overload accepting explicit type parameters is available but `@deprecated`. Prefer calling `defineDomain({...})` without explicit generics — typed dispatch downstream is only available with the inferred form.
