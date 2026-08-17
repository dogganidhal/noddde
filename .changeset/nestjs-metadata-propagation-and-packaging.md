---
"@noddde/nestjs": minor
---

Fix `NodddeMetadataInterceptor` metadata propagation and harden the package's public API and dependency shape ahead of GA:

- **Fix (blocker)**: `intercept()` was resolving `next.handle()`'s Observable inside `domain.withMetadataContext()`, but subscribing to it afterward via `switchMap` — outside the `AsyncLocalStorage` scope. Commands dispatched from a controller behind the interceptor never actually saw the extracted correlation/user ID. The subscription now happens inside the `withMetadataContext` callback, so metadata reaches the handler for the whole request lifecycle.
- **API change**: `NodddeMetadataInterceptor`'s constructor now requires both the extractor and the `Domain` — the previous optional second parameter threw at class-decoration time when omitted (the documented inline usage never worked). Added `NodddeMetadataInterceptor.withExtractor(extractor)`, a `FactoryProvider` for registering the interceptor per-controller (`@UseInterceptors(NodddeMetadataInterceptor)`) or globally (`{ provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor }`).
- **Lifecycle**: added `startOutboxRelay` option (default `true`) to `NodddeModuleOptions`/`NodddeModuleAsyncOptions` — the module now starts the outbox relay on bootstrap and stops it before shutdown, matching the docs' claim of no manual lifecycle management.
- **Packaging**: `rxjs` and `reflect-metadata` are now `peerDependencies` instead of regular dependencies (every NestJS app already provides them, and a duplicate `rxjs` install risks `Observable` identity mismatches). Dropped the unused `@noddde/core` runtime dependency (moved to `devDependencies` — it's only used by tests). `@noddde/engine` now uses a caret range instead of an exact pin.
