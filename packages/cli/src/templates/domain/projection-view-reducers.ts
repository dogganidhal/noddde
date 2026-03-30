import type { TemplateContext } from "../../utils/context.js";

/** Template for .../on-entries/index.ts — barrel re-exporting on-entries. */
export function viewReducersIndexTemplate(ctx: TemplateContext): string {
  return `export { on${ctx.name}Created } from "./on-${ctx.kebabName}-created.js";
`;
}

/** Template for .../on-entries/on-<name>-created.ts — standalone projection on-entry. */
export function viewReducerTemplate(ctx: TemplateContext): string {
  return `import type { ${ctx.name}View } from "../queries/index.js";

// TODO: once event types are wired in the projection def, replace with:
// import type { InferProjectionEventHandler } from "@noddde/core";
// import type { ${ctx.name}ProjectionDef } from "../${ctx.kebabName}.js";
// export const on${ctx.name}Created: InferProjectionEventHandler<${ctx.name}ProjectionDef, "${ctx.name}Created"> = { ... };

/** Reduces a ${ctx.name}Created event into a view. */
export function on${ctx.name}Created(
  event: { name: "${ctx.name}Created"; payload: { id: string } },
): ${ctx.name}View {
  return {
    id: event.payload.id,
    // TODO: populate view fields from event
  };
}
`;
}
