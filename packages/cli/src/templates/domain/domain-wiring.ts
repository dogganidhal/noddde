import type { TemplateContext } from "../../utils/context.js";
import type { EventBusAdapter } from "../../utils/event-bus.js";

/** Template for domain/domain.ts — defineDomain() call. */
export function domainDefinitionTemplate(ctx: TemplateContext): string {
  return `import { defineDomain } from "@noddde/core";
import type { InferDomain } from "@noddde/engine";
import { ${ctx.name} } from "./write-model/aggregates/${ctx.kebabName}/index.js";
import { ${ctx.name}Projection } from "./read-model/projections/${ctx.kebabName}/index.js";

export const definition = defineDomain({
  writeModel: {
    aggregates: {
      ${ctx.name},
    },
  },
  readModel: {
    projections: {
      ${ctx.name}: ${ctx.name}Projection,
    },
  },
});

export type ${ctx.name}Domain = InferDomain<typeof definition>;
`;
}

/** Template for infrastructure/index.ts — domain infrastructure interface. */
export function domainInfrastructureTemplate(ctx: TemplateContext): string {
  return `import type { Infrastructure } from "@noddde/core";

/** Infrastructure dependencies shared across the ${ctx.name} domain. */
export interface ${ctx.name}Infrastructure extends Infrastructure {
  // TODO: add domain-wide dependencies (clock, logger, external services)
}
`;
}

/** Template for main.ts — wireDomain() call with the selected event bus. */
export function domainMainTemplate(
  ctx: TemplateContext,
  eventBus: EventBusAdapter = "event-emitter",
): string {
  if (eventBus === "event-emitter") {
    return `import {
  wireDomain,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import { definition } from "./domain/domain.js";

const main = async () => {
  const domain = await wireDomain(definition, {
    // persistenceAdapter: adapter,
    infrastructure: () => ({
      // TODO: provide infrastructure implementations
    }),
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    }),
  });

  // TODO: dispatch commands
  // await domain.dispatchCommand({
  //   name: "Create${ctx.name}",
  //   targetAggregateId: "some-id",
  // });
};

main();
`;
  }

  if (eventBus === "kafka") {
    return `import {
  wireDomain,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import { KafkaEventBus } from "@noddde/kafka";
import { definition } from "./domain/domain.js";

const main = async () => {
  const domain = await wireDomain(definition, {
    // persistenceAdapter: adapter,
    infrastructure: () => ({
      // TODO: provide infrastructure implementations
    }),
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new KafkaEventBus({
        brokers: ["localhost:9092"],
        clientId: "${ctx.kebabName}",
        groupId: "${ctx.kebabName}-group",
      }),
      queryBus: new InMemoryQueryBus(),
    }),
  });

  // TODO: dispatch commands
  // await domain.dispatchCommand({
  //   name: "Create${ctx.name}",
  //   targetAggregateId: "some-id",
  // });
};

main();
`;
  }

  if (eventBus === "nats") {
    return `import {
  wireDomain,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import { NatsEventBus } from "@noddde/nats";
import { definition } from "./domain/domain.js";

const main = async () => {
  const domain = await wireDomain(definition, {
    // persistenceAdapter: adapter,
    infrastructure: () => ({
      // TODO: provide infrastructure implementations
    }),
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new NatsEventBus({
        servers: "localhost:4222",
        consumerGroup: "${ctx.kebabName}-group",
        streamName: "${ctx.kebabName}-events",
      }),
      queryBus: new InMemoryQueryBus(),
    }),
  });

  // TODO: dispatch commands
  // await domain.dispatchCommand({
  //   name: "Create${ctx.name}",
  //   targetAggregateId: "some-id",
  // });
};

main();
`;
  }

  // rabbitmq
  return `import {
  wireDomain,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import { definition } from "./domain/domain.js";

const main = async () => {
  const domain = await wireDomain(definition, {
    // persistenceAdapter: adapter,
    infrastructure: () => ({
      // TODO: provide infrastructure implementations
    }),
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new RabbitMqEventBus({
        url: "amqp://localhost:5672",
      }),
      queryBus: new InMemoryQueryBus(),
    }),
  });

  // TODO: dispatch commands
  // await domain.dispatchCommand({
  //   name: "Create${ctx.name}",
  //   targetAggregateId: "some-id",
  // });
};

main();
`;
}
