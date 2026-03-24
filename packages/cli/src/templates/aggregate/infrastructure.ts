import type { TemplateContext } from "../../utils/context.js";

/** Template for the infrastructure interface file. */
export function infrastructureTemplate(ctx: TemplateContext): string {
  return `import type { Infrastructure } from "@noddde/core";

/** Infrastructure dependencies for the ${ctx.name} aggregate. */
export interface ${ctx.name}Infrastructure extends Infrastructure {
  // TODO: add domain-specific dependencies (e.g., clock, logger, external services)
}
`;
}
