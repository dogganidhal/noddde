import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { sagaIndexTemplate } from "../../templates/saga/index.js";
import { sagaTemplate } from "../../templates/saga/saga.js";

const ctx = buildContext("OrderFulfillment");

describe("saga templates", () => {
  it("generates barrel index.ts", () => {
    const result = sagaIndexTemplate(ctx);
    expect(result).toContain(
      'export { OrderFulfillmentSaga } from "./saga.js"',
    );
    expect(result).toContain(
      'export type { OrderFulfillmentSagaState } from "./saga.js"',
    );
  });

  it("generates saga.ts with state inline", () => {
    const result = sagaTemplate(ctx);
    expect(result).toContain("interface OrderFulfillmentSagaState");
    expect(result).toContain("status: string | null");
    expect(result).toContain("initialOrderFulfillmentSagaState");
  });

  it("generates saga.ts with on map API (not associations/handlers)", () => {
    const result = sagaTemplate(ctx);
    expect(result).toContain('import { defineSaga } from "@noddde/core"');
    expect(result).toContain("type OrderFulfillmentSagaDef = {");
    expect(result).toContain("export const OrderFulfillmentSaga = defineSaga");
    expect(result).toContain("startedBy:");
    expect(result).toContain("on:");
    expect(result).not.toContain("associations:");
    expect(result).not.toContain("handlers:");
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [sagaIndexTemplate(ctx), sagaTemplate(ctx)];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
