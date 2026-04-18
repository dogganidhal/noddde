import type { TemplateContext } from "../../utils/context.js";

/** Context for adding an event handler to an existing projection. */
export interface AddEventHandlerContext {
  /** The projection context (PascalCase name, kebab, camel). */
  projection: TemplateContext;
  /** The event name in PascalCase, e.g. "BidPlaced". */
  eventName: string;
  /** kebab-case event name, e.g. "bid-placed". */
  eventKebabName: string;
}

/** Template for a new projection on-entry (view reducer) file. */
export function addEventHandlerTemplate(ctx: AddEventHandlerContext): string {
  return `import type { ${ctx.projection.name}View } from "../queries/index.js";

// TODO: once event types are wired in the projection def, replace with:
// import type { InferProjectionEventHandler } from "@noddde/core";
// import type { ${ctx.projection.name}ProjectionDef } from "../${ctx.projection.kebabName}.js";
// export const on${ctx.eventName}: InferProjectionEventHandler<${ctx.projection.name}ProjectionDef, "${ctx.eventName}"> = { ... };

/** Reduces a ${ctx.eventName} event into a view. */
export function on${ctx.eventName}(
  event: { name: "${ctx.eventName}"; payload: Record<string, unknown> },
  view: ${ctx.projection.name}View,
): ${ctx.projection.name}View {
  return {
    ...view,
    // TODO: update view fields from event payload
  };
}
`;
}
