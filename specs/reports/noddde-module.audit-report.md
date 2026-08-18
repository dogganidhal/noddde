# Audit Report: NodddeModule (issue #137 fix)

- **Spec**: `specs/integrations/nestjs/noddde-module.spec.md`
- **Source**: `packages/integrations/nestjs/src/noddde.module.ts`
- **Tests**: `packages/integrations/nestjs/src/__tests__/noddde-module.test.ts`
- **Build Report**: `specs/reports/noddde-module.build-report.md`
- **Cycle**: 1
- **Verdict**: **PASS** — with two non-blocking observations and one out-of-scope documentation gap escalated below.

## Mechanical Checks

| Check                       | Result  | Detail                                                                                               |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Export coverage             | ✅ PASS | All 15 frontmatter exports present in `noddde.module.ts`, re-exported by `src/index.ts` (`export *`) |
| Behavioral requirements     | ✅ PASS | 14/14 implemented; 12/14 directly tested (see grading below)                                         |
| Invariants                  | ✅ PASS | 7/7 enforced                                                                                         |
| Edge cases                  | ✅ PASS | 10/10 handled; 3 directly tested, 7 rely on framework/engine behavior with no spec Test Scenario     |
| Stub check                  | ✅ PASS | `grep "throw new Error"` → no matches. The pre-fix `if (!domainOrToken) throw` guard is gone         |
| `console.*` check           | ✅ PASS | No matches                                                                                           |
| `tsc --noEmit`              | ✅ PASS | Clean                                                                                                |
| `vitest run`                | ✅ PASS | 11/11 GREEN                                                                                          |
| `eslint . --max-warnings 0` | ✅ PASS | Clean                                                                                                |
| CLI templates               | N/A     | Spec does not touch aggregate/projection/saga/domain patterns                                        |
| Breaking-change propagation | N/A     | No downstream consumers — see below                                                                  |

**Downstream consumer check**: `grep -rl "@noddde/nestjs\|noddde.module" specs/ packages/samples/` → only this spec and its own reports. `packages/samples/` does not exist in this repo layout (`packages/` holds `adapters, cli, core, engine, eslint-config, integrations, testing, testing-integration, typescript-config`) — the `CLAUDE.md` reference to it is stale. Repo-wide, the only non-test consumers of `@noddde/nestjs` are documentation files. `depends_on: [engine/domain]` is upstream; `Domain.withMetadataContext`, `startOutboxRelay`, and `stopOutboxRelay` are unmodified by this change. N/A confirmed.

### Behavioral requirement grading

| #   | Requirement                                 | Grade                   | Evidence                                                                  |
| --- | ------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| 1   | forRoot registers Domain globally           | implemented + tested    | `noddde.module.ts:169-229`; tests 1 and 6                                 |
| 2   | forRootAsync resolves factory with deps     | implemented + tested    | `noddde.module.ts:235-290`; test 2 (with `imports: [ConfigModule]`)       |
| 3   | wireDomain handles init                     | implemented + tested    | Async `useFactory`, no `OnModuleInit`; e2e test dispatches immediately    |
| 4   | Automatic shutdown on app.close()           | implemented + tested    | `noddde.module.ts:157-160`; shutdown test + order test                    |
| 5   | shutdown is idempotent                      | implemented, not tested | Engine-owned: `engine/src/domain.ts:1231-1240` returns the same promise   |
| 6   | exposeBuses: true registers bus tokens      | implemented + tested    | `noddde.module.ts:185-204, 245-264`; identity assertions on all three     |
| 7   | exposeBuses default does not register       | implemented + tested    | `toThrow()` on all three tokens                                           |
| 8   | InjectDomain() wraps @Inject                | implemented + tested    | `noddde.module.ts:45-47`; used by `PingController` in the e2e test        |
| 9   | InjectCommandBus/QueryBus/EventBus          | implemented, not tested | `noddde.module.ts:50-62`; one-line `Inject()` over tokens that are tested |
| 10  | **Interceptor wraps the subscription**      | implemented + tested    | `noddde.module.ts:332-353`; independently re-verified — see below         |
| 11  | Extractor is user-provided                  | implemented + tested    | Constructor param 0; e2e test supplies a custom extractor                 |
| 12  | withExtractor returns DI-registerable       | implemented + tested    | `noddde.module.ts:323-330`, shape matches spec exactly                    |
| 13  | startOutboxRelay defaults true on bootstrap | implemented + tested    | `noddde.module.ts:151-155, 206-209, 266-269`; both branches tested        |
| 14  | stopOutboxRelay before shutdown             | implemented + tested    | `noddde.module.ts:157-160`; asserted via `invocationCallOrder`            |

Requirements 5 and 9 have no Test Scenario in the spec, so the absence of a test is not a spec violation. Both are satisfied by inspection.

## Coherence Review

### The BLOCKER fix is real — independently verified, not merely asserted

I did not take the Build Report's word for requirement 10. I reconstructed the pre-fix `intercept()` verbatim from `git show HEAD:packages/integrations/nestjs/src/noddde.module.ts` (lines 262-273 of that revision):

```ts
return from(
  this.domain.withMetadataContext(
    metadata,
    () =>
      new Promise<Observable<any>>((resolve) => {
        resolve(next.handle());
      }),
  ),
).pipe(switchMap((obs) => obs));
```

The bug is exactly as issue #137 described: the callback only _resolves_ the lazy Observable; `switchMap` performs the actual subscription after `withMetadataContext` has already returned, so the controller body runs outside the `AsyncLocalStorage` scope.

I ran that pre-fix implementation against the new end-to-end test's setup in a temporary isolated test file (since deleted), with a real wired `Domain`, the real `PingController`, and the same `defer`-based `CallHandler`. Result: the event _was_ emitted, but `metadata.correlationId` was **not** `"corr-123"` and `metadata.userId` was **not** `"user-456"`. The new test therefore fails against the old code and passes against the new code — it is a genuine regression guard, not a tautology. This directly closes the inadequacy issue #137 called out in the old test (which only asserted that `withMetadataContext` had been called).

The current implementation subscribes inside the callback (`noddde.module.ts:339`) and only settles the inner promise on `complete` or `error` (lines 341-348), so the scope stays open for the whole handler lifetime, satisfying the corresponding invariant.

### API redesign coherence

`withExtractor` solves both halves of issue #137 finding 2:

- **The inline crash**: `new NodddeMetadataInterceptor(fn)` no longer compiles — `domain` is a required second parameter, so the failure moved from a runtime throw inside a request to a compile-time type error. The custom throw guard is gone.
- **Non-DI-resolvable constructor**: `withExtractor` returns a `FactoryProvider` bound to the class token with `inject: [NODDDE_DOMAIN]`, so `@UseInterceptors(NodddeMetadataInterceptor)` resolves through the module container, and `{ provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor }` aliases the same instance globally. Both are exercised by tests.

Per the Edge Cases, direct construction still works: `new NodddeMetadataInterceptor(extractor, domain)` is what `withExtractor`'s own factory does (line 328), and my isolated repro constructed the mirror class the same way. Unit-testing the interceptor without DI is supported.

### Outbox lifecycle coherence

Verified by call order in the source, not just presence. `NodddeService.onApplicationBootstrap()` (lines 151-155) calls `domain.startOutboxRelay()` guarded by the injected boolean; `onApplicationShutdown()` (lines 157-160) calls `stopOutboxRelay()` on line 158 **before** `await shutdown()` on line 159. The option is resolved once at module-definition time via `options.startOutboxRelay ?? true` into an internal `NODDDE_START_OUTBOX_RELAY` provider — no branching on wiring shape, matching the spec invariant. Both engine methods are `this._outboxRelay?.…` (`engine/src/domain.ts:1385-1395`), so both are true no-ops without an outbox.

### The removed `moduleRef.get(APP_INTERCEPTOR)` assertion — reasoning verified, holds

I verified this rather than re-litigating it. `DependenciesScanner.insertProvider` in `@nestjs/core` rewrites providers whose token is one of the reserved multi-provider tokens (`APP_INTERCEPTOR`, `APP_GUARD`, `APP_FILTER`, `APP_PIPE`) to an internal per-provider token before container registration; the literal token is consumed to populate `ApplicationConfig`'s enhancer list and is never present in `InstanceLinksHost`. `moduleRef.get(APP_INTERCEPTOR)` therefore throws unconditionally, for any provider, in any implementation. This is a framework constraint, not an implementation defect — the orchestrator's removal was correct. The surviving assertion (class-token resolution via `withExtractor` plus successful compilation with `useExisting` registered) is the right proof of requirement 12's DI shape.

### Convention compliance

JSDoc is present on every public export, including the new `startOutboxRelay` option on both options interfaces, `withExtractor`, and the interceptor's updated constructor contract. `NodddeService` is correctly marked `@internal` and not exported. No `console.*`. Strict TypeScript passes. Per the audit brief, the NestJS module/service classes are infrastructure and exempt from the "no classes for domain concepts" rule — not flagged.

### Non-blocking observations

These are robustness notes on paths the spec does not specify. None is a spec violation; none blocks.

1. **Synchronous throw from `next.handle()` is unhandled** (`noddde.module.ts:335-351`). The promise returned by `withMetadataContext` is never awaited or caught. If `next.handle()` threw synchronously, the `Promise` executor would reject, producing an unhandled rejection while the downstream subscriber received no `next`/`error`/`complete` — a hung request. In practice this is unreachable: NestJS returns a lazy Observable from `handle()`, and RxJS routes a throwing subscribe function to the `error` notification, which _is_ handled (line 341). A one-line `.catch((err) => subscriber.error(err))` on the `withMetadataContext` call would close it if the orchestrator wants belt-and-braces.
2. **No teardown on unsubscribe** (same block). If a downstream consumer unsubscribes before completion — NestJS does this for streaming/SSE responses on client disconnect — the inner subscription is not torn down and the inner promise never settles, so the ALS scope stays open. The spec invariant only names `complete`/`error` as termination paths, so this is out of spec scope, but it is worth a spec decision before `@noddde/nestjs` is advertised for streaming transports.
3. **Cosmetic**: the `@Inject(NODDDE_DOMAIN)` decorator on constructor param 1 (line 310) is now effectively dead metadata — param 0 (`extractor`) has no injectable metadata, so Nest can never autowire the class token itself; `withExtractor`'s factory always supplies both arguments. Harmless and arguably self-documenting; no change requested.

### Observed but not audited (out of spec scope)

`packages/integrations/nestjs/package.json` was also modified on this branch (`rxjs` and `reflect-metadata` moved from `dependencies` to `peerDependencies`, `@noddde/core` moved to `devDependencies`, `@noddde/engine` relaxed to `^1.0.0-rc.1`). This is the "packaging" half of the branch name and is outside this spec. It is at least self-consistent with the source: `noddde.module.ts` imports only from `@noddde/engine`, `@nestjs/common`, and `rxjs`, and the docs install line already instructs users to add `@noddde/core` explicitly. Not audited further.

## Documentation

Edited **only** `docs/content/docs/integrations/nestjs.mdx`, confined to the four authorized ranges. Verified with `git diff -U1`: all hunks fall between lines 173 and 252 — nothing in installation, quick start, bus exposure, or the `@nestjs/cqrs` section. Ran `prettier --write` on the file afterwards (it reflowed the two API tables to the new column widths).

1. **Metadata Context Propagation inline example** — replaced `@UseInterceptors(new NodddeMetadataInterceptor((ctx) => {...}))`, which no longer compiles against the required two-arg constructor, with the supported pattern: a named `extractMetadata` extractor, `NodddeMetadataInterceptor.withExtractor(extractMetadata)` in the controller module's `providers`, and `@UseInterceptors(NodddeMetadataInterceptor)` on the controller. Added a sentence explaining _why_ DI registration is required (the interceptor needs the `Domain`).
2. **Global-registration example** — replaced the `APP_INTERCEPTOR` + `useFactory` snippet with `providers: [NodddeMetadataInterceptor.withExtractor(extractMetadata), { provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor }]`, noting that `useExisting` makes both tokens refer to one instance.
3. **Lifecycle section** — removed the false "No manual lifecycle management is needed." line and added an **Outbox relay** bullet: unless `startOutboxRelay: false`, `domain.startOutboxRelay()` runs on bootstrap and `domain.stopOutboxRelay()` runs before `domain.shutdown()`; both are no-ops without an outbox, so the default is safe. Initialization and shutdown bullets left as they were.
4. **API Reference** — added a `startOutboxRelay | boolean | No | true` row to both the `NodddeModuleOptions` and `NodddeModuleAsyncOptions` tables.

## Concerns

**The package README is stale in the same two ways the docs page was, and it is outside my authorized edit scope.** `packages/integrations/nestjs/README.md` is the npm landing page for a package heading to GA, and it currently shows:

- **Lines 165-178**: a provider that cannot work. It calls `new NodddeMetadataInterceptor(extractor /* domain injected automatically */)` with one argument — now a TypeScript error, and the exact "domain injected automatically" misconception issue #137 filed. The provider object also sets both `useFactory` and `useValue`, which is invalid NestJS regardless.
- **Line 187**: "calls `domain.shutdown()` for you. That drains in-flight commands, **flushes the outbox relay**…" — the outbox claim was false before this fix (nothing ever started the relay) and is now only partly true. It should describe the new `startOutboxRelay` option, matching the docs page.

My Phase B brief restricted me to four ranges in `nestjs.mdx` and told me not to touch other documentation, so I made no edits here. Routing to the orchestrator: this needs either an extension of the docs scope to the README, or assignment to whichever lane owns `packages/integrations/nestjs/README.md` on this branch. Shipping the fix with a README that demonstrates the crash it fixes would substantially undercut the fix.

No other concerns. The implementation matches the spec's intent, and the BLOCKER is genuinely fixed.
