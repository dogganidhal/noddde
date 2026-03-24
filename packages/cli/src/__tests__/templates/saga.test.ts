import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { sagaIndexTemplate } from "../../templates/saga/index.js";
import { sagaStateTemplate } from "../../templates/saga/state.js";
import { sagaTemplate } from "../../templates/saga/saga.js";
import { sagaHandlersIndexTemplate } from "../../templates/saga/handlers-index.js";
import { sagaHandlerTemplate } from "../../templates/saga/handler.js";

const ctx = buildContext("OrderFulfillment");

describe("saga templates", () => {
  it("generates barrel index.ts", () => {
    const result = sagaIndexTemplate(ctx);
    expect(result).toContain(
      'export { OrderFulfillmentSaga } from "./saga.js"',
    );
    expect(result).toContain(
      'export type { OrderFulfillmentSagaState } from "./state.js"',
    );
    expect(result).toContain(
      'export { initialOrderFulfillmentSagaState } from "./state.js"',
    );
  });

  it("generates state.ts with interface and initial state", () => {
    const result = sagaStateTemplate(ctx);
    expect(result).toContain("export interface OrderFulfillmentSagaState");
    expect(result).toContain("status: string | null");
    expect(result).toContain(
      "export const initialOrderFulfillmentSagaState: OrderFulfillmentSagaState",
    );
  });

  it("generates handlers/index.ts re-exports", () => {
    const result = sagaHandlersIndexTemplate();
    expect(result).toContain(
      'export { onStartEvent } from "./on-start-event.js"',
    );
  });

  it("generates individual handler file", () => {
    const result = sagaHandlerTemplate(ctx);
    expect(result).toContain("export function onStartEvent");
    expect(result).toContain("OrderFulfillmentSagaState");
    expect(result).toContain('status: "started"');
  });

  it("generates saga.ts with defineSaga", () => {
    const result = sagaTemplate(ctx);
    expect(result).toContain('import { defineSaga } from "@noddde/core"');
    expect(result).toContain("type OrderFulfillmentSagaDef = {");
    expect(result).toContain("export const OrderFulfillmentSaga = defineSaga");
    expect(result).toContain("initialOrderFulfillmentSagaState");
    expect(result).toContain(
      'import { onStartEvent } from "./handlers/index.js"',
    );
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [
      sagaIndexTemplate(ctx),
      sagaHandlersIndexTemplate(),
      sagaHandlerTemplate(ctx),
      sagaTemplate(ctx),
    ];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
