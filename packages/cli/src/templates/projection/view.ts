import type { TemplateContext } from "../../utils/context.js";

/** Template for the projection view interface file. */
export function viewTemplate(ctx: TemplateContext): string {
  return `/** Read model for ${ctx.name}. */
export interface ${ctx.name}View {
  // TODO: define read model fields
  id: string;
}
`;
}
