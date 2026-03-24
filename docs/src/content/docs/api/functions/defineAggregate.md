---
editUrl: false
next: false
prev: false
title: "defineAggregate"
---

> **defineAggregate**\<`T`\>(`config`): [`Aggregate`](/api/interfaces/aggregate/)\<`T`\>

Defined in: [ddd/aggregate-root.ts:128](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/ddd/aggregate-root.ts#L128)

Identity function that creates an aggregate definition with full type inference across the command/event/state/infrastructure boundaries. This is the recommended way to define aggregates.

## Type Parameters

### T

`T` _extends_ [`AggregateTypes`](/api/type-aliases/aggregatetypes/)

## Parameters

### config

[`Aggregate`](/api/interfaces/aggregate/)\<`T`\>

## Returns

[`Aggregate`](/api/interfaces/aggregate/)\<`T`\>
