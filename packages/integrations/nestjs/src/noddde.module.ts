/* eslint-disable no-unused-vars */
import "reflect-metadata";
import {
  Module,
  Global,
  DynamicModule,
  OnApplicationShutdown,
  Inject,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import type { ModuleMetadata } from "@nestjs/common";
import type { Observable } from "rxjs";
import { from, switchMap } from "rxjs";
import type {
  DomainDefinition,
  DomainWiring,
  MetadataContext,
  Domain,
} from "@noddde/engine";
import { wireDomain } from "@noddde/engine";

// Re-export InferDomain so users don't need a separate @noddde/engine import
export type { InferDomain } from "@noddde/engine";
// ── Injection tokens ──────────────────────────────────────────────

/** Injection token for the running {@link Domain} instance. */
export const NODDDE_DOMAIN: unique symbol = Symbol("NODDDE_DOMAIN");

/** Injection token for the {@link CommandBus} (requires `exposeBuses: true`). */
export const NODDDE_COMMAND_BUS: unique symbol = Symbol("NODDDE_COMMAND_BUS");

/** Injection token for the {@link QueryBus} (requires `exposeBuses: true`). */
export const NODDDE_QUERY_BUS: unique symbol = Symbol("NODDDE_QUERY_BUS");

/** Injection token for the {@link EventBus} (requires `exposeBuses: true`). */
export const NODDDE_EVENT_BUS: unique symbol = Symbol("NODDDE_EVENT_BUS");

// ── Convenience decorators ────────────────────────────────────────

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_DOMAIN)`. */
export function InjectDomain(): ParameterDecorator {
  return Inject(NODDDE_DOMAIN);
}

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_COMMAND_BUS)`. */
export function InjectCommandBus(): ParameterDecorator {
  return Inject(NODDDE_COMMAND_BUS);
}

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_QUERY_BUS)`. */
export function InjectQueryBus(): ParameterDecorator {
  return Inject(NODDDE_QUERY_BUS);
}

/** Parameter decorator — typed wrapper around `@Inject(NODDDE_EVENT_BUS)`. */
export function InjectEventBus(): ParameterDecorator {
  return Inject(NODDDE_EVENT_BUS);
}

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

// ── Metadata extractor ────────────────────────────────────────────

/**
 * Extracts {@link MetadataContext} from a NestJS {@link ExecutionContext}.
 * Users provide this to customize how correlation IDs and user IDs are
 * derived from HTTP requests, RPC calls, etc.
 */
export type MetadataExtractor = (ctx: ExecutionContext) => MetadataContext;

// ── NodddeService (lifecycle) ─────────────────────────────────────

/**
 * Internal service that holds the Domain instance and handles
 * application shutdown lifecycle.
 * @internal
 */
@Injectable()
class NodddeService implements OnApplicationShutdown {
  constructor(@Inject(NODDDE_DOMAIN) private readonly domain: Domain<any>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.domain.shutdown();
  }
}

// ── Dynamic module ────────────────────────────────────────────────

/**
 * NestJS dynamic module for noddde. Registered as `@Global()` — the
 * `Domain` instance is injectable from any module without re-importing.
 */
@Global()
@Module({})
export class NodddeModule {
  /**
   * Static configuration. Calls `wireDomain(definition, wiring)` inside
   * an async provider factory. NestJS resolves the provider before
   * marking the module as initialized.
   */
  static forRoot(options: NodddeModuleOptions): DynamicModule {
    const domainProvider = {
      provide: NODDDE_DOMAIN,
      useFactory: async () => {
        return wireDomain(options.definition, options.wiring ?? {});
      },
    };

    const busProviders = options.exposeBuses
      ? [
          {
            provide: NODDDE_COMMAND_BUS,
            inject: [NODDDE_DOMAIN],
            useFactory: (domain: Domain<any>) =>
              domain.infrastructure.commandBus,
          },
          {
            provide: NODDDE_QUERY_BUS,
            inject: [NODDDE_DOMAIN],
            useFactory: (domain: Domain<any>) => domain.infrastructure.queryBus,
          },
          {
            provide: NODDDE_EVENT_BUS,
            inject: [NODDDE_DOMAIN],
            useFactory: (domain: Domain<any>) => domain.infrastructure.eventBus,
          },
        ]
      : [];

    const providers = [domainProvider, NodddeService, ...busProviders];
    const exports = [
      NODDDE_DOMAIN,
      ...(options.exposeBuses
        ? [NODDDE_COMMAND_BUS, NODDDE_QUERY_BUS, NODDDE_EVENT_BUS]
        : []),
    ];

    return {
      module: NodddeModule,
      providers,
      exports,
    };
  }

  /**
   * Factory-based async configuration. Resolves the factory (with
   * injected NestJS providers), then calls `wireDomain()`.
   */
  static forRootAsync(options: NodddeModuleAsyncOptions): DynamicModule {
    const domainProvider = {
      provide: NODDDE_DOMAIN,
      inject: options.inject ?? [],
      useFactory: async (...args: any[]) => {
        const resolved = await options.useFactory(...args);
        return wireDomain(resolved.definition, resolved.wiring ?? {});
      },
    };

    const busProviders = options.exposeBuses
      ? [
          {
            provide: NODDDE_COMMAND_BUS,
            inject: [NODDDE_DOMAIN],
            useFactory: (domain: Domain<any>) =>
              domain.infrastructure.commandBus,
          },
          {
            provide: NODDDE_QUERY_BUS,
            inject: [NODDDE_DOMAIN],
            useFactory: (domain: Domain<any>) => domain.infrastructure.queryBus,
          },
          {
            provide: NODDDE_EVENT_BUS,
            inject: [NODDDE_DOMAIN],
            useFactory: (domain: Domain<any>) => domain.infrastructure.eventBus,
          },
        ]
      : [];

    const providers = [domainProvider, NodddeService, ...busProviders];
    const exports = [
      NODDDE_DOMAIN,
      ...(options.exposeBuses
        ? [NODDDE_COMMAND_BUS, NODDDE_QUERY_BUS, NODDDE_EVENT_BUS]
        : []),
    ];

    return {
      module: NodddeModule,
      imports: options.imports ?? [],
      providers,
      exports,
    };
  }
}

// ── Metadata interceptor ──────────────────────────────────────────

/**
 * NestJS interceptor that wraps handler execution inside
 * `domain.withMetadataContext()`. Propagates correlation IDs, user IDs,
 * and causation IDs from the request context into every command
 * dispatched within the handler.
 */
@Injectable()
export class NodddeMetadataInterceptor implements NestInterceptor {
  private readonly domain: Domain<any>;

  constructor(
    private readonly extractor: MetadataExtractor,
    @Inject(NODDDE_DOMAIN) domainOrToken?: Domain<any>,
  ) {
    if (!domainOrToken) {
      throw new Error(
        "NodddeMetadataInterceptor requires a Domain instance. Make sure NodddeModule is imported.",
      );
    }
    this.domain = domainOrToken;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metadata = this.extractor(context);
    return from(
      this.domain.withMetadataContext(
        metadata,
        () =>
          new Promise<Observable<any>>((resolve) => {
            resolve(next.handle());
          }),
      ),
    ).pipe(switchMap((obs) => obs));
  }
}
