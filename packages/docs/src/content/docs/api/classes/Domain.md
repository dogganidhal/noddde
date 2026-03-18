---
editUrl: false
next: false
prev: false
title: "Domain"
---

Defined in: [engine/domain.ts:80](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L80)

## Type Parameters

### TInfrastructure

`TInfrastructure` _extends_ [`Infrastructure`](/api/type-aliases/infrastructure/)

## Constructors

### Constructor

> **new Domain**\<`TInfrastructure`\>(`configuration`): `Domain`\<`TInfrastructure`\>

Defined in: [engine/domain.ts:88](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L88)

#### Parameters

##### configuration

[`DomainConfiguration`](/api/type-aliases/domainconfiguration/)\<`TInfrastructure`\>

#### Returns

`Domain`\<`TInfrastructure`\>

## Accessors

### infrastructure

#### Get Signature

> **get** **infrastructure**(): `TInfrastructure` & [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)

Defined in: [engine/domain.ts:84](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L84)

##### Returns

`TInfrastructure` & [`CQRSInfrastructure`](/api/interfaces/cqrsinfrastructure/)

## Methods

### dispatchCommand()

> **dispatchCommand**\<`TCommand`\>(`command`): `Promise`\<`TCommand`\[`"targetAggregateId"`\]\>

Defined in: [engine/domain.ts:96](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L96)

#### Type Parameters

##### TCommand

`TCommand` _extends_ [`AggregateCommand`](/api/interfaces/aggregatecommand/)\<`any`\>

#### Parameters

##### command

`TCommand`

#### Returns

`Promise`\<`TCommand`\[`"targetAggregateId"`\]\>

---

### init()

> **init**(): `Promise`\<`void`\>

Defined in: [engine/domain.ts:92](https://github.com/dogganidhal/noddde/blob/7fcd7bfd4ed5309e2c0f01d9a6cc64eda9457151/packages/core/src/engine/domain.ts#L92)

#### Returns

`Promise`\<`void`\>
