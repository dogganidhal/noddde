import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { sagaIndexTemplate } from "../../templates/saga/index.js";
import { sagaTemplate } from "../../templates/saga/saga.js";
import { sagaStateTemplate } from "../../templates/domain/saga-state.js";
import {
  transitionHandlersIndexTemplate,
  transitionHandlerTemplate,
} from "../../templates/domain/saga-transition-handlers.js";

const ctx = buildContext("OrderFulfillment");

describe("saga templates", () => {
  it("generates barrel index.ts", () => {
    const result = sagaIndexTemplate(ctx);
    expect(result).toContain(
      'export { OrderFulfillmentSaga } from "./saga.js"',
    );
    expect(result).toContain('from "./state.js"');
    expect(result).toContain("OrderFulfillmentSagaState");
    expect(result).toContain("initialOrderFulfillmentSagaState");
  });

  it("generates state.ts with interface and initial state", () => {
    const result = sagaStateTemplate(ctx);
    expect(result).toContain("interface OrderFulfillmentSagaState");
    expect(result).toContain("status: string | null");
    expect(result).toContain(
      "initialOrderFulfillmentSagaState: OrderFulfillmentSagaState",
    );
  });

  it("generates saga.ts importing state and transition handlers", () => {
    const result = sagaTemplate(ctx);
    expect(result).toContain('from "./state.js"');
    expect(result).toContain('from "./transition-handlers/index.js"');
    expect(result).toContain("onStartEvent");
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

  it("generates transition-handlers barrel", () => {
    const result = transitionHandlersIndexTemplate();
    expect(result).toContain("onStartEvent");
    expect(result).toContain("on-start-event.js");
  });

  it("generates standalone transition handler", () => {
    const result = transitionHandlerTemplate(ctx);
    expect(result).toContain("export function onStartEvent");
    expect(result).toContain("OrderFulfillmentSagaState");
    expect(result).toContain('status: "started"');
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [
      sagaIndexTemplate(ctx),
      sagaTemplate(ctx),
      transitionHandlersIndexTemplate(),
      transitionHandlerTemplate(ctx),
    ];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
