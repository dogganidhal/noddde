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
import type { DynamicModule, ExecutionContext } from "@nestjs/common";
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
 */
export class NodddeMetadataInterceptor implements NestInterceptor {
  constructor(extractor: MetadataExtractor);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
}
```

## Behavioral Requirements

### Module Registration

1. **forRoot registers Domain globally** — `NodddeModule.forRoot(options)` returns a `DynamicModule` that calls `wireDomain(options.definition, options.wiring)` via an async `useFactory` provider. The resulting `Domain` instance is registered under `NODDDE_DOMAIN`. The module is decorated with `@Global()`, making `NODDDE_DOMAIN` injectable from any module without importing `NodddeModule`.

2. **forRootAsync resolves factory with injected deps** — `NodddeModule.forRootAsync(options)` first resolves `options.useFactory` with `options.inject` tokens, producing a `NodddeModuleOptions`. It then calls `wireDomain(resolved.definition, resolved.wiring)` to create the `Domain`. Supports `options.imports` for modules that provide the injected tokens (e.g., `ConfigModule`).

3. **wireDomain handles init** — Since `wireDomain()` calls `domain.init()` internally, the module does NOT implement `OnModuleInit`. By the time any service or controller injects the `Domain`, it is fully initialized.

### Lifecycle

4. **Automatic shutdown on app.close()** — The module implements `OnApplicationShutdown`. When `app.close()` is called (or on SIGTERM/SIGINT with `enableShutdownHooks()`), `domain.shutdown()` is invoked to drain in-flight operations and close infrastructure. This ensures clean disconnection of buses, persistence, and other `Closeable`/`Connectable` resources.

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

10. **Interceptor wraps handler in metadata context** — `NodddeMetadataInterceptor` injects the `Domain` via `NODDDE_DOMAIN`. On each request, it calls `this.extractor(context)` to produce a `MetadataContext`, then wraps the handler execution inside `domain.withMetadataContext(metadata, ...)`. All commands dispatched within the handler inherit the metadata.

11. **Extractor is user-provided** — The interceptor accepts a `MetadataExtractor` function in its constructor. This function receives the NestJS `ExecutionContext` and returns a `MetadataContext`. The framework does not prescribe how metadata is extracted — different transports (HTTP, gRPC, WebSocket) extract it differently.

## Invariants

- The `Domain` instance is always fully initialized (`.init()` completed) before it becomes injectable.
- `NODDDE_DOMAIN` always resolves to the same `Domain` instance across all modules (singleton, global scope).
- Bus tokens (when exposed) resolve to the exact same bus instances used by the `Domain`.
- `domain.shutdown()` is always called when the NestJS application shuts down — no resource leaks.
- The module never calls `console.log`, `console.warn`, or `console.error`.

## Edge Cases

- **wireDomain throws during initialization**: The NestJS provider factory rejects, which causes module initialization to fail with the original error. The application does not start.
- **forRootAsync factory throws**: Same behavior — the async provider rejects, module init fails.
- **Multiple NodddeModule.forRoot() calls**: NestJS deduplicates global modules. Only the first registration takes effect.
- **InjectDomain() used without NodddeModule imported**: NestJS throws its standard "Nest could not resolve dependencies" error at module compilation time.
- **InjectCommandBus() used without exposeBuses: true**: NestJS throws "Nest could not resolve dependencies" error.
- **Interceptor used without NodddeModule**: The interceptor's `NODDDE_DOMAIN` injection fails at module compilation.
- **MetadataExtractor returns partial context**: `withMetadataContext` accepts partial `MetadataContext` — undefined fields are simply not propagated.

## Integration Points

- **With `@noddde/engine`**: Wraps `wireDomain()` and `Domain` class. No modification to engine internals.
- **With NestJS lifecycle**: Hooks into `OnApplicationShutdown` for clean domain teardown.
- **With NestJS DI**: Uses `useFactory` async providers and `@Global()` scope.
- **With NestJS interceptors**: `NodddeMetadataInterceptor` can be registered per-controller (`@UseInterceptors()`), per-route, or globally (`APP_INTERCEPTOR`).
- **With `@nestjs/cqrs`**: No bridge or conflict. Both can coexist — different injection tokens, different handler models.

## Test Scenarios

### forRoot creates injectable Domain

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { NodddeModule, NODDDE_DOMAIN } from "@noddde/nestjs";
import { defineDomain, wireDomain } from "@noddde/engine";
import { defineAggregate, defineProjection } from "@noddde/core";

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
import { defineDomain } from "@noddde/engine";

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
import { defineDomain } from "@noddde/engine";
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
import { defineDomain } from "@noddde/engine";
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
import { defineDomain } from "@noddde/engine";

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
import { defineDomain } from "@noddde/engine";
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

### Metadata interceptor propagates context

```ts
import { describe, it, expect, vi } from "vitest";
import { Test } from "@nestjs/testing";
import {
  NodddeModule,
  NODDDE_DOMAIN,
  NodddeMetadataInterceptor,
} from "@noddde/nestjs";
import type { MetadataExtractor } from "@noddde/nestjs";
import { defineDomain } from "@noddde/engine";
import type { Domain } from "@noddde/engine";
import type { ExecutionContext, CallHandler } from "@nestjs/common";
import { of } from "rxjs";

describe("NodddeMetadataInterceptor", () => {
  it("should call domain.withMetadataContext with extracted metadata", async () => {
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [NodddeModule.forRoot({ definition })],
    }).compile();

    const domain = moduleRef.get<Domain<any>>(NODDDE_DOMAIN);
    const withMetadataSpy = vi
      .spyOn(domain, "withMetadataContext")
      .mockImplementation(async (_meta, fn) => fn());

    const extractor: MetadataExtractor = () => ({
      correlationId: "corr-123",
      userId: "user-456",
    });

    const interceptor = new NodddeMetadataInterceptor(extractor, domain);

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    const mockNext: CallHandler = {
      handle: () => of("result"),
    };

    await new Promise<void>((resolve) => {
      interceptor.intercept(mockContext, mockNext).subscribe({
        complete: resolve,
      });
    });

    expect(withMetadataSpy).toHaveBeenCalledWith(
      { correlationId: "corr-123", userId: "user-456" },
      expect.any(Function),
    );

    await moduleRef.close();
  });
});
```
