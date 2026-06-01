---
"@noddde/core": minor
---

Add an optional per-saga `atomicity` field and the `SagaAtomicity` type (`"atomic" | "best-effort"`) to saga definitions.

`atomicity` is a declarative field on `defineSaga` / the `Saga` interface; `defineSaga` remains a pure identity function and does not read, validate, or default it. The engine's `SagaExecutor` consumes the field, treating an absent value as `"atomic"` (today's behavior), so existing sagas are unaffected.
