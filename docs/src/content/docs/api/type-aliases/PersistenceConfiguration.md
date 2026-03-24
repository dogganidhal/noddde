---
editUrl: false
next: false
prev: false
title: "PersistenceConfiguration"
---

> **PersistenceConfiguration** = [`StateStoredAggregatePersistence`](/api/interfaces/statestoredaggregatepersistence/) \| [`EventSourcedAggregatePersistence`](/api/interfaces/eventsourcedaggregatepersistence/)

Defined in: [persistence/index.ts:102](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/persistence/index.ts#L102)

Union of the two aggregate persistence strategies. Used in `DomainConfiguration` to allow either approach.
