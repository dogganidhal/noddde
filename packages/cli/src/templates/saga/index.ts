import type { TemplateContext } from "../../utils/context.js";

/** Template for the saga barrel (index.ts). */
export function sagaIndexTemplate(ctx: TemplateContext): string {
  return `export { ${ctx.name}Saga } from "./saga.js";
export type { ${ctx.name}SagaState } from "./state.js";
export { initial${ctx.name}SagaState } from "./state.js";
`;
}
