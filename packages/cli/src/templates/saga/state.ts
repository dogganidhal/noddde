import type { TemplateContext } from "../../utils/context.js";

/** Template for the saga state file. */
export function sagaStateTemplate(ctx: TemplateContext): string {
  return `/** The internal state of the ${ctx.name} saga. */
export interface ${ctx.name}SagaState {
  status: string | null;
  // TODO: add saga state fields for tracking workflow progress
}

/** Initial state for a new ${ctx.name} saga instance. */
export const initial${ctx.name}SagaState: ${ctx.name}SagaState = {
  status: null,
};
`;
}
