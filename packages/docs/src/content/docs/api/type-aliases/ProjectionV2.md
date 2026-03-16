---
editUrl: false
next: false
prev: false
title: "ProjectionV2"
---

> **ProjectionV2**\<`TEvent`, `TView`\> = `object`

Defined in: [ddd/projection.ts:28](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/ddd/projection.ts#L28)

## Type Parameters

### TEvent

`TEvent` *extends* [`Event`](/api/interfaces/event/)

### TView

`TView` = `any`

## Properties

### reducer()

> **reducer**: (`view`, `event`) => `TView`

Defined in: [ddd/projection.ts:29](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/ddd/projection.ts#L29)

#### Parameters

##### view

`TView`

##### event

`TEvent`

#### Returns

`TView`
