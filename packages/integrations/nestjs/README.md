# @noddde/nestjs

NestJS integration for [noddde](https://noddde.dev) — bridges noddde's functional domain model to NestJS dependency injection and lifecycle.

- Calls `wireDomain()` inside a NestJS dynamic module.
- Registers the `Domain` as a `@Global()` injectable.
- Calls `domain.shutdown()` automatically on `OnApplicationShutdown`.
- Optional `NodddeMetadataInterceptor` for propagating correlation/user IDs from HTTP requests into commands.

> **Full guide:** https://noddde.dev/docs/integrations/nestjs

---

## Install

```bash
yarn add @noddde/nestjs @noddde/core @noddde/engine
# or
npm install @noddde/nestjs @noddde/core @noddde/engine
```

`@nestjs/common` and `@nestjs/core` (>= 10.0.0) are peer dependencies — they must already be installed in your application.

---

## Quick Start

### Static configuration — `forRoot`

Use when your wiring has no NestJS-injected dependencies (e.g. all in-memory):

```ts
import { Module } from "@nestjs/common";
import { NodddeModule } from "@noddde/nestjs";
import { myDomain } from "./domain";

@Module({
  imports: [NodddeModule.forRoot({ definition: myDomain })],
})
export class AppModule {}
```

### Async configuration — `forRootAsync`

Use when wiring depends on NestJS-managed providers (`ConfigService`, a `DataSource`, a `PrismaClient`, etc.):

```ts
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NodddeModule } from "@noddde/nestjs";
import { createDrizzleAdapter } from "@noddde/drizzle";
import { myDomain } from "./domain";

@Module({
  imports: [
    ConfigModule.forRoot(),
    NodddeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        definition: myDomain,
        wiring: {
          persistenceAdapter: createDrizzleAdapter({
            client: buildDrizzleClient(config.get("DATABASE_URL")!),
            dialect: "pg",
          }),
        },
      }),
    }),
  ],
})
export class AppModule {}
```

---

## Injecting the Domain

The module is registered `@Global()` — `Domain` is injectable from any module without re-importing.

```ts
import { Controller, Post, Body } from "@nestjs/common";
import { InjectDomain } from "@noddde/nestjs";
import type { InferDomain } from "@noddde/nestjs";
import type { myDomain } from "./domain";

type AppDomain = InferDomain<typeof myDomain>;

@Controller("orders")
export class OrdersController {
  constructor(@InjectDomain() private readonly domain: AppDomain) {}

  @Post()
  async place(@Body() body: { orderId: string; items: string[] }) {
    await this.domain.dispatchCommand({
      name: "PlaceOrder",
      targetAggregateId: body.orderId,
      payload: { items: body.items },
    });
    return { orderId: body.orderId };
  }
}
```

`InferDomain<typeof myDomain>` gives you fully typed `dispatchCommand` / `dispatchQuery` — command names, payloads, and query results are all narrowed at compile time.

---

## Exposing individual buses

When you only need a single bus (e.g. a controller that just dispatches commands), set `exposeBuses: true`:

```ts
NodddeModule.forRoot({
  definition: myDomain,
  exposeBuses: true,
});
```

Then inject the bus you need:

```ts
import {
  InjectCommandBus,
  InjectQueryBus,
  InjectEventBus,
} from "@noddde/nestjs";
import type { CommandBus, QueryBus, EventBus } from "@noddde/core";

@Controller()
export class FooController {
  constructor(
    @InjectCommandBus() private readonly commands: CommandBus,
    @InjectQueryBus() private readonly queries: QueryBus,
    @InjectEventBus() private readonly events: EventBus,
  ) {}
}
```

Raw injection tokens are also exported (`NODDDE_DOMAIN`, `NODDDE_COMMAND_BUS`, `NODDDE_QUERY_BUS`, `NODDDE_EVENT_BUS`) for advanced use cases.

---

## Correlation IDs — `NodddeMetadataInterceptor`

Wrap your handlers in `domain.withMetadataContext()` so every command dispatched within a request automatically inherits the request's correlation ID, user ID, and causation metadata.

Provide a `MetadataExtractor` that maps your `ExecutionContext` to a noddde `MetadataContext`:

```ts
import { APP_INTERCEPTOR } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { NodddeModule, NodddeMetadataInterceptor } from "@noddde/nestjs";
import type { MetadataExtractor } from "@noddde/nestjs";
import { randomUUID } from "node:crypto";

const extractMetadata: MetadataExtractor = (ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return {
    correlationId: req.headers["x-correlation-id"] ?? randomUUID(),
    userId: req.user?.id,
  };
};

@Module({
  imports: [NodddeModule.forRoot({ definition: myDomain })],
  providers: [
    NodddeMetadataInterceptor.withExtractor(extractMetadata),
    { provide: APP_INTERCEPTOR, useExisting: NodddeMetadataInterceptor },
  ],
})
export class AppModule {}
```

`withExtractor` returns a provider bound to `NodddeMetadataInterceptor` that resolves the `Domain` via DI — the interceptor can't be constructed with `new NodddeMetadataInterceptor(fn)` on its own, since it also requires the `Domain`. The `useExisting` line applies the same instance globally; to scope it to one controller instead, register the same `withExtractor(...)` provider in that controller's module and use `@UseInterceptors(NodddeMetadataInterceptor)` on the controller.

Every event emitted as a side-effect of a command dispatched inside an HTTP handler will carry the same `correlationId`, propagating through sagas and projections.

---

## Lifecycle

The module installs a private `OnApplicationShutdown` listener that calls `domain.shutdown()` for you. That drains in-flight commands, lets active sagas finish, and closes infrastructure implementing `Closeable` (event buses, persistence adapters, etc.). Just make sure your Nest app calls `app.enableShutdownHooks()`:

If your wiring configures an outbox, the module also starts and stops its relay for you: `domain.startOutboxRelay()` runs on bootstrap and `domain.stopOutboxRelay()` runs before shutdown, unless you pass `startOutboxRelay: false` to `forRoot`/`forRootAsync`. Both calls are safe no-ops when no outbox is configured.

```ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(3000);
}
bootstrap();
```

---

## What's exported

| Symbol                                                                        | Kind             | Purpose                                                |
| ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| `NodddeModule.forRoot`                                                        | static factory   | Synchronous module setup                               |
| `NodddeModule.forRootAsync`                                                   | static factory   | Async setup with injected dependencies                 |
| `NodddeMetadataInterceptor`                                                   | class            | Wraps handlers in `domain.withMetadataContext()`       |
| `InjectDomain`, `InjectCommandBus`, `InjectQueryBus`, `InjectEventBus`        | decorators       | Typed parameter decorators                             |
| `NODDDE_DOMAIN`, `NODDDE_COMMAND_BUS`, `NODDDE_QUERY_BUS`, `NODDDE_EVENT_BUS` | symbols          | Raw injection tokens                                   |
| `NodddeModuleOptions`, `NodddeModuleAsyncOptions`                             | interfaces       | Module configuration shapes                            |
| `MetadataExtractor`                                                           | type             | `(ctx: ExecutionContext) => MetadataContext`           |
| `InferDomain`                                                                 | type (re-export) | Derive a typed `Domain` from a `defineDomain()` result |

---

## License

MIT © [Nidhal Dogga](https://github.com/dogganidhal)
