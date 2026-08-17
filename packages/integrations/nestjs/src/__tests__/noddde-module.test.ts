import { describe, it, expect, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { Module, Injectable, Inject, Controller, Post } from "@nestjs/common";
import type { ExecutionContext, CallHandler } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { defer, firstValueFrom } from "rxjs";
import {
  NodddeModule,
  NODDDE_DOMAIN,
  NODDDE_COMMAND_BUS,
  NODDDE_QUERY_BUS,
  NODDDE_EVENT_BUS,
  NodddeMetadataInterceptor,
  InjectDomain,
} from "../noddde.module";
import type { MetadataExtractor } from "../noddde.module";
import { defineAggregate, defineDomain } from "@noddde/core";
import type { Event } from "@noddde/core";
import type { Domain } from "@noddde/engine";

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

  it("should resolve factory with injected deps and create Domain", async () => {
    const CONFIG_TOKEN = Symbol("CONFIG");
    const definition = defineDomain({
      writeModel: { aggregates: {} },
      readModel: { projections: {} },
    });

    @Module({
      providers: [
        { provide: CONFIG_TOKEN, useValue: { dbUrl: "postgres://localhost" } },
      ],
      exports: [CONFIG_TOKEN],
    })
    class ConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        NodddeModule.forRootAsync({
          imports: [ConfigModule],
          inject: [CONFIG_TOKEN],
          // eslint-disable-next-line no-unused-vars
          useFactory: (_config: { dbUrl: string }) => ({
            definition,
          }),
        }),
      ],
    }).compile();

    const domain = moduleRef.get(NODDDE_DOMAIN);
    expect(domain).toBeDefined();

    await moduleRef.close();
  });

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

  it("should allow injection from a module that does not import NodddeModule", async () => {
    @Injectable()
    class FeatureService {
      // eslint-disable-next-line no-unused-vars
      constructor(@Inject(NODDDE_DOMAIN) public readonly domain: Domain<any>) {}
    }

    @Module({
      providers: [FeatureService],
      exports: [FeatureService],
    })
    class FeatureModule {}

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
  // eslint-disable-next-line no-unused-vars
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
    eventBus.on("Pinged", (event: Event) => {
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

    // NestJS rewrites APP_INTERCEPTOR to an internal per-provider token
    // when scanning the module, so the literal token is never resolvable
    // via moduleRef.get() in a test. Successful compilation with
    // `useExisting` registered is the proof that the wiring shape is valid.

    await moduleRef.close();
  });
});

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
