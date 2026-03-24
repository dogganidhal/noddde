import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { projectionIndexTemplate } from "../../templates/projection/index.js";
import { viewTemplate } from "../../templates/projection/view.js";
import { queriesIndexTemplate } from "../../templates/projection/queries-index.js";
import { queryHandlerTemplate } from "../../templates/projection/query-handler.js";
import { projectionTemplate } from "../../templates/projection/projection.js";

const ctx = buildContext("OrderSummary");

describe("projection templates", () => {
  it("generates barrel index.ts", () => {
    const result = projectionIndexTemplate(ctx);
    expect(result).toContain(
      'export { OrderSummaryProjection } from "./projection.js"',
    );
    expect(result).toContain(
      'export type { OrderSummaryView } from "./view.js"',
    );
    expect(result).toContain(
      'export type { OrderSummaryQuery } from "./queries/index.js"',
    );
    expect(result).toContain(
      'export { getOrderSummary } from "./queries/index.js"',
    );
  });

  it("generates view.ts", () => {
    const result = viewTemplate(ctx);
    expect(result).toContain("export interface OrderSummaryView");
    expect(result).toContain("id: string");
  });

  it("generates queries/index.ts with DefineQueries", () => {
    const result = queriesIndexTemplate(ctx);
    expect(result).toContain('import { DefineQueries } from "@noddde/core"');
    expect(result).toContain("type OrderSummaryQuery = DefineQueries<{");
    expect(result).toContain("GetOrderSummary:");
    expect(result).toContain(
      'export { getOrderSummary } from "./get-order-summary.js"',
    );
  });

  it("generates individual query handler file", () => {
    const result = queryHandlerTemplate(ctx);
    expect(result).toContain("export async function getOrderSummary");
    expect(result).toContain("OrderSummaryView");
    expect(result).toContain("ViewStore");
  });

  it("generates projection.ts with defineProjection", () => {
    const result = projectionTemplate(ctx);
    expect(result).toContain('import { defineProjection } from "@noddde/core"');
    expect(result).toContain("type OrderSummaryProjectionDef = {");
    expect(result).toContain(
      "export const OrderSummaryProjection = defineProjection",
    );
    expect(result).toContain("getOrderSummary");
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [
      projectionIndexTemplate(ctx),
      queriesIndexTemplate(ctx),
      queryHandlerTemplate(ctx),
      projectionTemplate(ctx),
    ];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
