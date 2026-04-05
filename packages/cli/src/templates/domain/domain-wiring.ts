import type { TemplateContext } from "../../utils/context.js";

/** Template for domain/domain.ts — defineDomain() call. */
export function domainDefinitionTemplate(ctx: TemplateContext): string {
  return `import { defineDomain } from "@noddde/engine";
import { ${ctx.name} } from "./write-model/aggregates/${ctx.kebabName}/index.js";
import { ${ctx.name}Projection } from "./read-model/projections/${ctx.kebabName}/index.js";
import type { ${ctx.name}Ports } from "../ports/index.js";

export const ${ctx.camelName}Domain = defineDomain<${ctx.name}Ports>({
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
`;
}

/** Template for ports/index.ts — domain ports interface. */
export function domainInfrastructureTemplate(ctx: TemplateContext): string {
  return `import type { Ports } from "@noddde/core";

/** Port dependencies shared across the ${ctx.name} domain. */
export interface ${ctx.name}Ports extends Ports {
  // TODO: add domain-wide dependencies (clock, logger, external services)
}
`;
}

/** Template for main.ts — wireDomain() call with in-memory defaults. */
export function domainMainTemplate(ctx: TemplateContext): string {
  return `import {
  wireDomain,
  InMemoryCommandBus,
  EventEmitterEventBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import { ${ctx.camelName}Domain } from "./domain/domain.js";

const main = async () => {
  const domain = await wireDomain(${ctx.camelName}Domain, {
    adapters: () => ({
      // TODO: provide adapter implementations
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
