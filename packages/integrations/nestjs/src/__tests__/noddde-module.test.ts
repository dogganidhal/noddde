import { describe, it, expect, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { Module, Injectable, Inject } from "@nestjs/common";
import type { ExecutionContext, CallHandler } from "@nestjs/common";
import { of } from "rxjs";
import { NodddeModule, NODDDE_DOMAIN } from "../noddde.module";
import {
  NODDDE_COMMAND_BUS,
  NODDDE_QUERY_BUS,
  NODDDE_EVENT_BUS,
  NodddeMetadataInterceptor,
} from "../noddde.module";
import type { MetadataExtractor } from "../noddde.module";
import { defineDomain } from "@noddde/engine";
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

    const moduleRef = await Test.createTestingModule({
      imports: [
        NodddeModule.forRootAsync({
          inject: [CONFIG_TOKEN],
          // eslint-disable-next-line no-unused-vars
          useFactory: (_config: { dbUrl: string }) => ({
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
