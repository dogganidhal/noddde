---
title: "NodddeModule"
module: integrations/nestjs/noddde-module
source_file: packages/integrations/nestjs/src/noddde.module.ts
status: implemented
exports:
  - NodddeModule
  - NodddeModuleOptions
  - NodddeModuleAsyncOptions
  - NODDDE_DOMAIN
  - NODDDE_COMMAND_BUS
  - NODDDE_QUERY_BUS
  - NODDDE_EVENT_BUS
  - InjectDomain
  - InjectCommandBus
  - InjectQueryBus
  - InjectEventBus
  - InferDomain
  - NodddeMetadataInterceptor
  - MetadataExtractor
depends_on:
  - engine/domain
docs: []
---

# NodddeModule

> NestJS dynamic module that bridges noddde's functional domain model to NestJS's dependency injection and lifecycle system. Eliminates boilerplate by handling `wireDomain()` invocation, `Domain` registration as a global provider, and automatic `shutdown()` on application close. Supports both static (`forRoot`) and factory-based (`forRootAsync`) configuration for when wiring depends on NestJS-managed services.

## Type Contract

```ts
import type {
  DynamicModule,
  ExecutionContext,
  FactoryProvider,
} from "@nestjs/common";
import type { NestInterceptor, CallHandler } from "@nestjs/common";
import type { ModuleMetadata } from "@nestjs/common";
import type { Observable } from "rxjs";
import type {
  DomainDefinition,
  DomainWiring,
  MetadataContext,
  Domain,
} from "@noddde/engine";
import type { CommandBus, QueryBus, EventBus } from "@noddde/core";

// ── Injection tokens ──────────────────────────────────────────────

/** Injection token for the running {@link Domain} instance. */
export const NODDDE_DOMAIN: unique symbol;

/** Injection token for the {@link CommandBus} (requires `exposeBuses: true`). */
export const NODDDE_COMMAND_BUS: unique symbol;

/** Injection token for the {@link QueryBus} (requires `exposeBuses: true`). */
export const NODDDE_QUERY_BUS: unique symbol;

/** Injection token for the {@link EventBus} (requires `exposeBuses: true`). */
export const NODDDE_EVENT_BUS: unique symbol;

// ── Convenience decorators ────────────────────────────────────────

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_DOMAIN)`. */
export function InjectDomain(): ParameterDecorator;

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_COMMAND_BUS)`. */
export function InjectCommandBus(): ParameterDecorator;

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_QUERY_BUS)`. */
export function InjectQueryBus(): ParameterDecorator;

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_EVENT_BUS)`. */
export function InjectEventBus(): ParameterDecorator;

// ── Configuration interfaces ──────────────────────────────────────

/**
 * Synchronous configuration for {@link NodddeModule.forRoot}.
 * Use when wiring has no NestJS-injected dependencies (e.g., all in-memory).
 */
export interface NodddeModuleOptions {
  /** The domain definition from `defineDomain()`. */
  definition: DomainDefinition<any, any, any, any, any, any>;
  /** Infrastructure wiring for `wireDomain()`. Plain object — no injected deps. */
  wiring?: DomainWiring<any, any>;
  /**
   * When `true`, exposes `CommandBus`, `QueryBus`, and `EventBus` as
   * individual injectable providers via their respective tokens.
   * @default false
   */
  exposeBuses?: boolean;
  /**
   * When `true`, calls `domain.startOutboxRelay()` from an
   * `OnApplicationBootstrap` hook, and `domain.stopOutboxRelay()` before
   * `domain.shutdown()` on application shutdown. Both calls are no-ops when
   * no outbox is configured, so this is safe to leave at its default
   * regardless of whether `wiring` configures an outbox.
   * @default true
   */
  startOutboxRelay?: boolean;
}

/**
 * Factory-based async configuration for {@link NodddeModule.forRootAsync}.
 * Use when wiring depends on NestJS-managed services (DB connections,
 * ConfigService, external clients, etc.).
 */
export interface NodddeModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  /** Injection tokens that the factory depends on (e.g., `ConfigService`, `DataSource`). */
  inject?: any[];
  /** Async factory returning the module options. Resolved during module initialization. */
  useFactory: (
    ...args: any[]
  ) => Promise<NodddeModuleOptions> | NodddeModuleOptions;
  /**
   * When `true`, exposes `CommandBus`, `QueryBus`, and `EventBus` as
   * individual injectable providers via their respective tokens.
   * @default false
   */
  exposeBuses?: boolean;
  /**
   * When `true`, calls `domain.startOutboxRelay()` from an
   * `OnApplicationBootstrap` hook, and `domain.stopOutboxRelay()` before
   * `domain.shutdown()` on application shutdown. Both calls are no-ops when
   * no outbox is configured, so this is safe to leave at its default
   * regardless of whether the resolved wiring configures an outbox.
   * @default true
   */
  startOutboxRelay?: boolean;
}

// ── Dynamic module ────────────────────────────────────────────────

/**
 * NestJS dynamic module for noddde. Registered as `@Global()` — the
 * `Domain` instance is injectable from any module without re-importing.
 */
export class NodddeModule {
  /**
   * Static configuration. Calls `wireDomain(definition, wiring)` inside
   * an async provider factory. NestJS resolves the provider before
   * marking the module as initialized.
   */
  static forRoot(options: NodddeModuleOptions): DynamicModule;

  /**
   * Factory-based async configuration. Resolves the factory (with
   * injected NestJS providers), then calls `wireDomain()`.
   */
  static forRootAsync(options: NodddeModuleAsyncOptions): DynamicModule;
}

// ── Metadata interceptor ──────────────────────────────────────────

/**
 * Extracts {@link MetadataContext} from a NestJS {@link ExecutionContext}.
 * Users provide this to customize how correlation IDs and user IDs are
 * derived from HTTP requests, RPC calls, etc.
 */
export type MetadataExtractor = (ctx: ExecutionContext) => MetadataContext;

/**
 * NestJS interceptor that wraps handler execution inside
 * `domain.withMetadataContext()`. Propagates correlation IDs, user IDs,
 * and causation IDs from the request context into every command
 * dispatched within the handler.
 *
 * Requires the `Domain` instance to construct — cannot be instantiated
 * inline as `new NodddeMetadataInterceptor(fn)` without also supplying a
 * `Domain`. Use {@link NodddeMetadataInterceptor.withExtractor} to obtain
 * a DI-registerable provider instead.
 */
export class NodddeMetadataInterceptor implements NestInterceptor {
  constructor(extractor: MetadataExtractor, domain: Domain<any>);

  /**
   * Returns a `FactoryProvider` bound to `NodddeMetadataInterceptor` that
   * resolves `Domain` via `NODDDE_DOMAIN` and constructs the interceptor
   * with the given extractor. Register it in a module's `providers`:
   *
   * - Per-controller/module: `@UseInterceptors(NodddeMetadataInterceptor)`
   *   resolves the class token through that module's DI container.
   * - Global: additionally register
   *   `{ provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor }`.
   */
  static withExtractor(extractor: MetadataExtractor): FactoryProvider;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
}
```

## Behavioral Requirements

### Module Registration

1. **forRoot registers Domain globally** — `NodddeModule.forRoot(options)` returns a `DynamicModule` that calls `wireDomain(options.definition, options.wiring)` via an async `useFactory` provider. The resulting `Domain` instance is registered under `NODDDE_DOMAIN`. The module is decorated with `@Global()`, making `NODDDE_DOMAIN` injectable from any module without importing `NodddeModule`.

2. **forRootAsync resolves factory with injected deps** — `NodddeModule.forRootAsync(options)` first resolves `options.useFactory` with `options.inject` tokens, producing a `NodddeModuleOptions`. It then calls `wireDomain(resolved.definition, resolved.wiring)` to create the `Domain`. Supports `options.imports` for modules that provide the injected tokens (e.g., `ConfigModule`).

3. **wireDomain handles init** — Since `wireDomain()` calls `domain.init()` internally, the module does NOT implement `OnModuleInit`. By the time any service or controller injects the `Domain`, it is fully initialized.

### Lifecycle

4. **Automatic shutdown on app.close()** — The module implements `OnApplicationShutdown`. When `app.close()` is called (or on SIGTERM/SIGINT with `enableShutdownHooks()`), `domain.stopOutboxRelay()` is called (see requirement 13), then `domain.shutdown()` is invoked to drain in-flight operations and close infrastructure. This ensures clean disconnection of buses, persistence, and other `Closeable`/`Connectable` resources.

5. **shutdown is idempotent** — Calling `app.close()` multiple times does not cause `domain.shutdown()` to throw or double-close.

### Bus Exposure

6. **exposeBuses: true registers bus tokens** — When `exposeBuses` is `true` (on either `forRoot` or `forRootAsync`), three additional providers are registered:

   - `NODDDE_COMMAND_BUS` → `domain.infrastructure.commandBus`
   - `NODDDE_QUERY_BUS` → `domain.infrastructure.queryBus`
   - `NODDDE_EVENT_BUS` → `domain.infrastructure.eventBus`
     These are the exact same instances used by the `Domain` internally.

7. **exposeBuses: false (default) does not register bus tokens** — When `exposeBuses` is omitted or `false`, the bus tokens are not registered. Attempting to inject them throws NestJS's standard "could not resolve" error.

### Convenience Decorators

8. **InjectDomain() wraps @Inject(NODDDE_DOMAIN)** — `InjectDomain()` returns a parameter decorator equivalent to `@Inject(NODDDE_DOMAIN)`. This avoids importing the symbol in every controller/service.

9. **InjectCommandBus/QueryBus/EventBus wrap their tokens** — `InjectCommandBus()`, `InjectQueryBus()`, `InjectEventBus()` return parameter decorators equivalent to `@Inject(NODDDE_COMMAND_BUS)`, `@Inject(NODDDE_QUERY_BUS)`, `@Inject(NODDDE_EVENT_BUS)` respectively.

### Metadata Interceptor

10. **Interceptor wraps the downstream subscription in metadata context, not just Observable creation** — `NodddeMetadataInterceptor` injects the `Domain` via `NODDDE_DOMAIN`. On each request, it calls `this.extractor(context)` to produce a `MetadataContext`, then calls `next.handle().subscribe(...)` _inside_ the callback passed to `domain.withMetadataContext(metadata, ...)`. Because `next.handle()` returns a lazy `Observable`, merely resolving it inside `withMetadataContext` (without also subscribing there) does not propagate the `AsyncLocalStorage` scope to the controller handler — the handler only executes on subscription, which must therefore happen inside the same callback. All commands dispatched by the handler while it executes are within the ALS scope and inherit the metadata; the resulting events carry the extracted `correlationId`/`userId` in `event.metadata`.

11. **Extractor is user-provided** — The interceptor accepts a `MetadataExtractor` function in its constructor. This function receives the NestJS `ExecutionContext` and returns a `MetadataContext`. The framework does not prescribe how metadata is extracted — different transports (HTTP, gRPC, WebSocket) extract it differently.

12. **withExtractor returns a DI-registerable provider** — `NodddeMetadataInterceptor.withExtractor(extractor)` returns a `FactoryProvider` shaped `{ provide: NodddeMetadataInterceptor, inject: [NODDDE_DOMAIN], useFactory: (domain) => new NodddeMetadataInterceptor(extractor, domain) }`. Registering it in a module's `providers` makes `NodddeMetadataInterceptor` resolvable as a class token in that module, so `@UseInterceptors(NodddeMetadataInterceptor)` works without constructing the interceptor manually. Adding `{ provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor }` alongside it registers the same instance globally.

### Outbox Lifecycle

13. **startOutboxRelay defaults to true and runs on bootstrap** — When `options.startOutboxRelay` is not explicitly `false`, `NodddeService` (which additionally implements `OnApplicationBootstrap`) calls `domain.startOutboxRelay()` once the module has bootstrapped. This call is a no-op when no outbox is configured in `wiring`, so leaving the default in place is always safe.

14. **stopOutboxRelay runs before shutdown** — Regardless of the `startOutboxRelay` option, `NodddeService.onApplicationShutdown()` calls `domain.stopOutboxRelay()` before `domain.shutdown()`. This is also a no-op when no outbox relay was ever started, so the outbox lifecycle never causes a shutdown failure.

## Invariants

- The `Domain` instance is always fully initialized (`.init()` completed) before it becomes injectable.
- `NODDDE_DOMAIN` always resolves to the same `Domain` instance across all modules (singleton, global scope).
- Bus tokens (when exposed) resolve to the exact same bus instances used by the `Domain`.
- `domain.shutdown()` is always called when the NestJS application shuts down — no resource leaks.
- The module never calls `console.log`, `console.warn`, or `console.error`.
- The metadata `AsyncLocalStorage` scope opened by `NodddeMetadataInterceptor` remains active for the entire lifetime of the handler's subscription — from `next.handle().subscribe()` through `complete`/`error` — not merely while `next.handle()` is being called to obtain the `Observable`.
- `domain.startOutboxRelay()` / `domain.stopOutboxRelay()` are safe to call regardless of whether an outbox is configured (both are no-ops without one), so the `NodddeService` lifecycle hooks never need to branch on wiring shape.

## Edge Cases

- **wireDomain throws during initialization**: The NestJS provider factory rejects, which causes module initialization to fail with the original error. The application does not start.
- **forRootAsync factory throws**: Same behavior — the async provider rejects, module init fails.
- **Multiple NodddeModule.forRoot() calls**: NestJS deduplicates global modules. Only the first registration takes effect.
- **InjectDomain() used without NodddeModule imported**: NestJS throws its standard "Nest could not resolve dependencies" error at module compilation time.
- **InjectCommandBus() used without exposeBuses: true**: NestJS throws "Nest could not resolve dependencies" error.
- **NodddeMetadataInterceptor constructed manually without `withExtractor`**: `new NodddeMetadataInterceptor(extractor, domain)` works directly (e.g. in unit tests) as long as both arguments are supplied — the constructor no longer has an optional second parameter or a custom throw. Omitting `domain` is a TypeScript type error, not a runtime throw.
- **withExtractor used without NodddeModule imported in the same module graph**: NestJS throws its standard "Nest could not resolve dependencies" error for `NODDDE_DOMAIN` at module compilation time — same failure mode as any other `NODDDE_DOMAIN` consumer.
- **MetadataExtractor returns partial context**: `withMetadataContext` accepts partial `MetadataContext` — undefined fields are simply not propagated.
- **startOutboxRelay: true with no outbox configured in wiring**: `domain.startOutboxRelay()` is a no-op; no error, no relay runs.
- **Handler observable errors**: The interceptor's `Observable` subscription forwards `error` notifications to the downstream subscriber and still resolves the inner `withMetadataContext` promise so the ALS scope is released — an erroring handler cannot leak the metadata context.

## Integration Points

- **With `@noddde/engine`**: Wraps `wireDomain()` and `Domain` class. No modification to engine internals.
- **With NestJS lifecycle**: Hooks into `OnApplicationShutdown` for clean domain teardown.
- **With NestJS DI**: Uses `useFactory` async providers and `@Global()` scope.
- **With NestJS interceptors**: `NodddeMetadataInterceptor.withExtractor(extractor)` is registered as a provider, then applied per-controller/module via `@UseInterceptors(NodddeMetadataInterceptor)` (class-token DI resolution) or globally via `{ provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor }` alongside the same provider.
- **With `@nestjs/cqrs`**: No bridge or conflict. Both can coexist — different injection tokens, different handler models.
- **With the outbox relay**: `NodddeService` calls `domain.startOutboxRelay()` / `domain.stopOutboxRelay()` around the application's bootstrap/shutdown lifecycle — no separate manual wiring needed, matching whatever `wiring.outbox` (or an adapter-provided outbox store) was configured on `Domain`.
- **Packaging**: `rxjs` and `reflect-metadata` are `peerDependencies` (every NestJS app already provides them as peers of `@nestjs/common`) — this package never bundles a second copy that could produce a duplicate `Observable` identity. `@noddde/engine` is a caret range, not an exact pin, so patch/minor engine releases don't force a lockstep `@noddde/nestjs` release. `@noddde/core` is a dev-only dependency (used by tests to build a domain definition), not a runtime dependency — nothing in `src/` imports it.

## Test Scenarios

### forRoot creates injectable Domain

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { NodddeModule, NODDDE_DOMAIN } from "@noddde/nestjs";
import { wireDomain } from "@noddde/engine";
import { defineAggregate, defineDomain, defineProjection } from "@noddde/core";

describe("NodddeModule", () => {
  it("should create a Domain via forRoot and make it injectable", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition })],
    }).compile();

    const domain = moduleRef.get(NODDDE_DOMAIN);
    expect(domain).toBeDefined();
    expect(domain.dispatchCommand).toBeTypeOf("function");
    expect(domain.dispatchQuery).toBeTypeOf("function");

    await moduleRef.close();
  });
});
```

### forRootAsync with useFactory and inject

```ts
import { describe, it, expect, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { NodddeModule, NODDDE_DOMAIN } from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";

describe("NodddeModule", () => {
  it("should resolve factory with injected deps and create Domain", async () => {
    const CONFIG_TOKEN = Symbol("CONFIG");
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        NodddeModule.forRootAsync({
          inject: [CONFIG_TOKEN],
          useFactory: (config: { dbUrl: string }) => ({
            definition,
          }),
        }),
      ],
      providers: [
        { provide: CONFIG_TOKEN, useValue: { dbUrl: "postgres://localhost" } },
      ],
    }).compile();

    const domain = moduleRef.get(NODDDE_DOMAIN);
    expect(domain).toBeDefined();

    await moduleRef.close();
  });
});
```

### Lifecycle: domain.shutdown() on app.close()

```ts
import { describe, it, expect, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { NodddeModule, NODDDE_DOMAIN } from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";
import type { Domain } from "@noddde/engine";

describe("NodddeModule", () => {
  it("should call domain.shutdown() when the application closes", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition })],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const domain = app.get<Domain<any>>(NODDDE_DOMAIN);
    const shutdownSpy = vi.spyOn(domain, "shutdown");

    await app.close();

    expect(shutdownSpy).toHaveBeenCalledOnce();
  });
});
```

### exposeBuses: true exposes bus tokens

```ts
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import {
  NodddeModule,
  NODDDE_DOMAIN,
  NODDDE_COMMAND_BUS,
  NODDDE_QUERY_BUS,
  NODDDE_EVENT_BUS,
} from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";
import type { Domain } from "@noddde/engine";

describe("NodddeModule", () => {
  it("should expose bus tokens when exposeBuses is true", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition, exposeBuses: true })],
    }).compile();

    const domain = moduleRef.get<Domain<any>>(NODDDE_DOMAIN);
    const commandBus = moduleRef.get(NODDDE_COMMAND_BUS);
    const queryBus = moduleRef.get(NODDDE_QUERY_BUS);
    const eventBus = moduleRef.get(NODDDE_EVENT_BUS);

    expect(commandBus).toBe(domain.infrastructure.commandBus);
    expect(queryBus).toBe(domain.infrastructure.queryBus);
    expect(eventBus).toBe(domain.infrastructure.eventBus);

    await moduleRef.close();
  });
});
```

### exposeBuses: false does not expose bus tokens

```ts
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import {
  NodddeModule,
  NODDDE_COMMAND_BUS,
  NODDDE_QUERY_BUS,
  NODDDE_EVENT_BUS,
} from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";

describe("NodddeModule", () => {
  it("should not register bus tokens when exposeBuses is false", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition })],
    }).compile();

    expect(() => moduleRef.get(NODDDE_COMMAND_BUS)).toThrow();
    expect(() => moduleRef.get(NODDDE_QUERY_BUS)).toThrow();
    expect(() => moduleRef.get(NODDDE_EVENT_BUS)).toThrow();

    await moduleRef.close();
  });
});
```

### Global scope — feature module injects without importing

```ts
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { Module, Injectable, Inject } from "@nestjs/common";
import { NodddeModule, NODDDE_DOMAIN } from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";
import type { Domain } from "@noddde/engine";

@Injectable()
class FeatureService {
  constructor(@Inject(NODDDE_DOMAIN) public readonly domain: Domain<any>) {}
}

@Module({
  providers: [FeatureService],
  exports: [FeatureService],
})
class FeatureModule {}

describe("NodddeModule", () => {
  it("should allow injection from a module that does not import NodddeModule", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition }), FeatureModule],
    }).compile();

    const service = moduleRef.get(FeatureService);
    expect(service.domain).toBeDefined();
    expect(service.domain.dispatchCommand).toBeTypeOf("function");

    await moduleRef.close();
  });
});
```

### Metadata interceptor propagates context into the handler (end-to-end)

This is the test that proves the fix for the ALS-scope bug: it dispatches a
command from a real controller, through the real (unmocked) `Domain`, behind
the real interceptor, using a `defer`-based `CallHandler` that faithfully
reproduces NestJS's actual lazy-subscription timing — then asserts the
_emitted event's_ metadata, not just that `withMetadataContext` was called.

```ts
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { Controller, Post } from "@nestjs/common";
import type { ExecutionContext, CallHandler } from "@nestjs/common";
import { defer, firstValueFrom } from "rxjs";
import {
  NodddeModule,
  NODDDE_DOMAIN,
  NODDDE_EVENT_BUS,
  NodddeMetadataInterceptor,
  InjectDomain,
} from "@noddde/nestjs";
import type { MetadataExtractor } from "@noddde/nestjs";
import { defineAggregate, defineDomain } from "@noddde/core";
import type { Domain } from "@noddde/engine";
import type { Event } from "@noddde/core";

type PingCommand = { name: "Ping"; targetAggregateId: string };
type PingedEvent = { name: "Pinged"; payload: Record<string, never> };

const Pingable = defineAggregate<{
  state: Record<string, never>;
  events: PingedEvent;
  commands: PingCommand;
  infrastructure: Record<string, never>;
}>({
  initialState: {},
  decide: {
    Ping: () => ({ name: "Pinged", payload: {} }),
  },
  evolve: {
    Pinged: (_payload, state) => state,
  },
});

@Controller("ping")
class PingController {
  constructor(@InjectDomain() private readonly domain: Domain<any>) {}

  @Post()
  ping() {
    return this.domain.dispatchCommand({
      name: "Ping",
      targetAggregateId: "aggregate-1",
    });
  }
}

describe("NodddeMetadataInterceptor (end-to-end)", () => {
  it("propagates extracted metadata into the event produced by the handler", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: { Pingable } },
      readModel: { projections: {} },
    });

    const extractor: MetadataExtractor = () => ({
      correlationId: "corr-123",
      userId: "user-456",
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [PingController],
      providers: [NodddeMetadataInterceptor.withExtractor(extractor)],
      imports: [NodddeModule.forRoot({ definition, exposeBuses: true })],
    }).compile();

    const eventBus = moduleRef.get(NODDDE_EVENT_BUS);
    const controller = moduleRef.get(PingController);
    const interceptor = moduleRef.get(NodddeMetadataInterceptor);

    const captured: Event[] = [];
    eventBus.on("Pinged", (event) => {
      captured.push(event);
    });

    const mockContext = {} as ExecutionContext;
    const mockNext: CallHandler = {
      // `defer` mirrors NestJS: the controller method runs only when this
      // Observable is subscribed, not when `next.handle()` is called.
      handle: () => defer(() => controller.ping()),
    };

    await firstValueFrom(interceptor.intercept(mockContext, mockNext));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.metadata?.correlationId).toBe("corr-123");
    expect(captured[0]?.metadata?.userId).toBe("user-456");

    await moduleRef.close();
  });
});
```

### withExtractor produces a DI-resolvable provider

```ts
import { describe, it, expect } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { NodddeModule, NodddeMetadataInterceptor } from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";

describe("NodddeMetadataInterceptor.withExtractor", () => {
  it("resolves as a class token and supports global registration via useExisting", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition })],
      providers: [
        NodddeMetadataInterceptor.withExtractor(() => ({})),
        { provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor },
      ],
    }).compile();

    const interceptor = moduleRef.get(NodddeMetadataInterceptor);
    expect(interceptor).toBeInstanceOf(NodddeMetadataInterceptor);

    // NestJS rewrites APP_INTERCEPTOR (and APP_GUARD/APP_FILTER/APP_PIPE) to
    // an internal per-provider token when scanning the module, so the
    // literal APP_INTERCEPTOR token is never resolvable via moduleRef.get()
    // in a test — this is a framework-level constraint, not something this
    // module controls. Successful compilation with `useExisting` registered
    // is the proof that the wiring shape is valid; the global-scope
    // behavior itself is exercised at the framework level, not re-tested
    // here.

    await moduleRef.close();
  });
});
```

### startOutboxRelay defaults to true and runs on bootstrap

```ts
import { describe, it, expect, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { NodddeModule, NODDDE_DOMAIN } from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";
import type { Domain } from "@noddde/engine";

describe("NodddeModule outbox lifecycle", () => {
  it("calls domain.startOutboxRelay() when the app bootstraps", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition })],
    }).compile();

    const domain = moduleRef.get<Domain<any>>(NODDDE_DOMAIN);
    const startSpy = vi.spyOn(domain, "startOutboxRelay");

    const app = moduleRef.createNestApplication();
    await app.init();

    expect(startSpy).toHaveBeenCalledOnce();

    await app.close();
  });

  it("does not call domain.startOutboxRelay() when startOutboxRelay: false", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition, startOutboxRelay: false })],
    }).compile();

    const domain = moduleRef.get<Domain<any>>(NODDDE_DOMAIN);
    const startSpy = vi.spyOn(domain, "startOutboxRelay");

    const app = moduleRef.createNestApplication();
    await app.init();

    expect(startSpy).not.toHaveBeenCalled();

    await app.close();
  });
});
```

### stopOutboxRelay runs before shutdown

```ts
import { describe, it, expect, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { NodddeModule, NODDDE_DOMAIN } from "@noddde/nestjs";
import { defineDomain } from "@noddde/core";
import type { Domain } from "@noddde/engine";

describe("NodddeModule outbox lifecycle", () => {
  it("calls domain.stopOutboxRelay() before domain.shutdown() on app.close()", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition })],
    }).compile();

    const domain = moduleRef.get<Domain<any>>(NODDDE_DOMAIN);
    const stopSpy = vi.spyOn(domain, "stopOutboxRelay");
    const shutdownSpy = vi.spyOn(domain, "shutdown");

    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(shutdownSpy).toHaveBeenCalledOnce();
    expect(stopSpy.mock.invocationCallOrder[0]).toBeLessThan(
      shutdownSpy.mock.invocationCallOrder[0],
    );
  });
});
```
