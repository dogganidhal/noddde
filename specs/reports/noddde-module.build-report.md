## Build Report: NodddeModule (issue #137 fix)

- **Spec**: specs/integrations/nestjs/noddde-module.spec.md
- **Source**: packages/integrations/nestjs/src/noddde.module.ts
- **Tests**: packages/integrations/nestjs/src/**tests**/noddde-module.test.ts
- **Result**: GREEN
- **Tests passing**: 11/11
- **Loop count**: 2 (orchestrator relaxed one unresolvable assertion after cycle 1 — see Concerns)

### Test Results

| Test                                                                                                                 | Status                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| NodddeModule > should create a Domain via forRoot and make it injectable                                             | ✅                                             |
| NodddeModule > should resolve factory with injected deps and create Domain                                           | ✅                                             |
| NodddeModule > should call domain.shutdown() when the application closes                                             | ✅                                             |
| NodddeModule > should expose bus tokens when exposeBuses is true                                                     | ✅                                             |
| NodddeModule > should not register bus tokens when exposeBuses is false                                              | ✅                                             |
| NodddeModule > should allow injection from a module that does not import NodddeModule                                | ✅                                             |
| NodddeMetadataInterceptor (end-to-end) > propagates extracted metadata into the event produced by the handler        | ✅                                             |
| NodddeMetadataInterceptor.withExtractor > resolves as a class token and supports global registration via useExisting | ✅ (after spec/test adjustment — see Concerns) |
| NodddeModule outbox lifecycle > calls domain.startOutboxRelay() when the app bootstraps                              | ✅                                             |
| NodddeModule outbox lifecycle > does not call domain.startOutboxRelay() when startOutboxRelay: false                 | ✅                                             |
| NodddeModule outbox lifecycle > calls domain.stopOutboxRelay() before domain.shutdown() on app.close()               | ✅                                             |

`tsc --noEmit`: clean. `eslint`: clean. `prettier --check`: clean (after `--write`).

### What changed

- **ALS-scope bug fixed** (requirement 10): `NodddeMetadataInterceptor.intercept()` now returns `new Observable(subscriber => domain.withMetadataContext(metadata, () => new Promise(done => next.handle().subscribe({...}))))`, so the actual `.subscribe()` on `next.handle()` happens inside the `withMetadataContext` callback. This is what the new end-to-end test (previously the main bug repro) verifies — it now passes.
- **Constructor + `withExtractor`** (requirements 11-12): constructor is now `(extractor: MetadataExtractor, @Inject(NODDDE_DOMAIN) domain: Domain<any>)`, both required, no throw guard. Added `static withExtractor(extractor): FactoryProvider`.
- **Outbox lifecycle** (requirements 13-14): added `startOutboxRelay?: boolean` (default `true`) to both options interfaces. `NodddeService` now also implements `OnApplicationBootstrap` and calls `domain.startOutboxRelay()` unless the option is explicitly `false`. Wired the resolved boolean through a small internal `NODDDE_START_OUTBOX_RELAY` token (one extra provider, injected into `NodddeService` alongside `NODDDE_DOMAIN` — no wiring-shape detection, per spec invariant). `onApplicationShutdown()` now calls `domain.stopOutboxRelay()` before `domain.shutdown()`.

### Concerns

**1 test cannot pass as written, regardless of source implementation** — `withExtractor produces a DI-resolvable provider`, specifically the second assertion:

```ts
const globalInterceptor = moduleRef.get(APP_INTERCEPTOR);
expect(globalInterceptor).toBe(interceptor);
```

Root cause (verified in isolation, twice, with a trivial unrelated `@Injectable` class — not specific to `NodddeMetadataInterceptor`): NestJS's `DependenciesScanner.insertProvider` rewrites any provider whose `provide` token is one of the reserved multi-tokens (`APP_INTERCEPTOR`, `APP_GUARD`, `APP_FILTER`, `APP_PIPE`) to an internal `${token} (UUID: ...)` token before registering it in the container (`@nestjs/core/scanner.js`). The literal `APP_INTERCEPTOR` string token is never present in `InstanceLinksHost`'s map — `moduleRef.get(APP_INTERCEPTOR)` (or `app.get(APP_INTERCEPTOR)` after `app.init()`) throws "Nest could not find APP_INTERCEPTOR element" unconditionally, in every NestJS version behaving this way (confirmed on the installed `@nestjs/core@10.4.22`). This is how global-enhancer registration has always worked — the token is consumed by the scanner to populate `ApplicationConfig`'s internal enhancer list, not to be fetched back out by the same token.

This means the Test Scenario as written in the spec cannot pass against real NestJS, independent of anything in `noddde.module.ts`. The first assertion in the same test (`interceptor` resolves as a class token, `toBeInstanceOf`) does pass and correctly proves `withExtractor`'s DI shape. The "global registration via `useExisting`" behavior itself is real and works in a running app (it's the standard NestJS pattern) — it's only the _direct token fetch in a test_ that's unsupported by the framework.

**Resolution (orchestrator, post-build)**: confirmed this is real, longstanding NestJS behavior (multi-provider tokens `APP_INTERCEPTOR`/`APP_GUARD`/`APP_FILTER`/`APP_PIPE` are rewritten internally by the scanner and are never retrievable by their literal token via `moduleRef.get()`/`app.get()`). Removed the `moduleRef.get(APP_INTERCEPTOR)` identity assertion from both the spec's Test Scenario and the test file, replacing it with a comment explaining why — the remaining assertion (`NodddeMetadataInterceptor` resolves as a class token via `withExtractor`, `toBeInstanceOf` check) is what actually proves requirement 12's DI shape; successful module compilation with the `useExisting` provider registered is the proof the global-registration wiring is valid. Re-ran the suite after the change: 11/11 GREEN, `tsc --noEmit` clean.
