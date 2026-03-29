---
editUrl: false
next: false
prev: false
title: "FrameworkInfrastructure"
---

Defined in: [infrastructure/index.ts:32](https://github.com/dogganidhal/noddde/blob/main/packages/core/src/infrastructure/index.ts#L32)

Framework-provided infrastructure automatically available to all handlers. Merged into every handler's `infrastructure` parameter by the engine via intersection (`&`). Handlers can use `infrastructure.logger` without declaring it in their custom infrastructure type.

## Properties

### logger

> **logger**: [`Logger`](/api/interfaces/logger/)

Framework logger instance. Use `child()` to create scoped loggers.
