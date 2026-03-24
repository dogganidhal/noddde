---
editUrl: false
next: false
prev: false
title: "UnitOfWorkFactory"
---

> **UnitOfWorkFactory** = () => [`UnitOfWork`](/api/interfaces/unitofwork/)

Defined in: [persistence/unit-of-work.ts:73](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/unit-of-work.ts#L73)

Factory function that creates a new `UnitOfWork` instance. Called once per unit of work boundary (per command dispatch, saga reaction, or explicit `domain.withUnitOfWork()` call).
