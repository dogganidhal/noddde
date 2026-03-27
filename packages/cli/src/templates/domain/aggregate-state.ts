import type { TemplateContext } from "../../utils/context.js";

/** Template for the aggregate state file. */
export function aggregateStateTemplate(ctx: TemplateContext): string {
  return `/** The state of the ${ctx.name} aggregate. */
export interface ${ctx.name}State {
  // TODO: define aggregate state
}

/** Initial state for a new ${ctx.name} aggregate instance. */
export const initial${ctx.name}State: ${ctx.name}State = {
  // TODO: set initial values
};
`;
}
