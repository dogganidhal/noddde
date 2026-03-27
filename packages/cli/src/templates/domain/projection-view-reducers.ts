import type { TemplateContext } from "../../utils/context.js";

/** Template for .../view-reducers/index.ts — barrel re-exporting reducers. */
export function viewReducersIndexTemplate(ctx: TemplateContext): string {
  return `export { on${ctx.name}Created } from "./on-${ctx.kebabName}-created.js";
`;
}

/** Template for .../view-reducers/on-<name>-created.ts — standalone view reducer. */
export function viewReducerTemplate(ctx: TemplateContext): string {
  return `import type { ${ctx.name}View } from "../queries/index.js";

/** Reduces a ${ctx.name}Created event into a view. */
export function on${ctx.name}Created(
  event: { payload: { id: string } },
): ${ctx.name}View {
  return {
    id: event.payload.id,
    // TODO: populate view fields from event
  };
}
`;
}
