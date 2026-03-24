---
editUrl: false
next: false
prev: false
title: "StandaloneCommand"
---

> **StandaloneCommand** = [`Command`](/api/interfaces/command/)

Defined in: [cqrs/command/command.ts:43](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/cqrs/command/command.ts#L43)

A command that is not routed to an aggregate. Standalone commands are handled by standalone command handlers which receive full infrastructure (including CQRS buses) but no aggregate state.
