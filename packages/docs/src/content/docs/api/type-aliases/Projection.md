---
editUrl: false
next: false
prev: false
title: "Projection"
---

> **Projection**\<`TInfrastructure`, `TEventNames`, `TQueryNames`\> = `object`

Defined in: [ddd/projection.ts:19](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/ddd/projection.ts#L19)

## Type Parameters

### TInfrastructure

`TInfrastructure` *extends* [`Infrastructure`](/api/type-aliases/infrastructure/)

### TEventNames

`TEventNames` *extends* `string` \| `symbol` = `string` \| `symbol`

### TQueryNames

`TQueryNames` *extends* `string` \| `symbol` = `string` \| `symbol`

## Properties

### eventHandlers

> **eventHandlers**: `EventHandlerMap`\<`TInfrastructure`, `TEventNames`\>

Defined in: [ddd/projection.ts:24](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/ddd/projection.ts#L24)

***

### queryHandlers

> **queryHandlers**: `QueryHandlerMap`\<`TInfrastructure`, `TQueryNames`\>

Defined in: [ddd/projection.ts:25](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/ddd/projection.ts#L25)
