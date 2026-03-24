---
editUrl: false
next: false
prev: false
title: "CQRSInfrastructure"
---

Defined in: [infrastructure/index.ts:22](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/infrastructure/index.ts#L22)

Infrastructure provided by the framework containing the three CQRS buses. Automatically merged into the infrastructure available to standalone command handlers and saga event handlers.

## Properties

### commandBus

> **commandBus**: [`CommandBus`](/api/interfaces/commandbus/)

Bus for dispatching commands to aggregates or standalone command handlers.

---

### eventBus

> **eventBus**: [`EventBus`](/api/interfaces/eventbus/)

Bus for publishing domain events to projections and event handlers.

---

### queryBus

> **queryBus**: [`QueryBus`](/api/interfaces/querybus/)

Bus for dispatching queries to query handlers.
