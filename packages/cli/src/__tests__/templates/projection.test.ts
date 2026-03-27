import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import {
  domainProjectionIndexTemplate,
  domainProjectionTemplate,
} from "../../templates/domain/projection.js";
import {
  queriesIndexTemplate,
  queryPayloadTemplate,
} from "../../templates/domain/projection-queries.js";
import {
  queryHandlersIndexTemplate,
  queryHandlerTemplate,
} from "../../templates/domain/projection-query-handlers.js";
import {
  viewReducersIndexTemplate,
  viewReducerTemplate,
} from "../../templates/domain/projection-view-reducers.js";

const ctx = buildContext("OrderSummary");

describe("projection templates", () => {
  it("generates barrel index.ts", () => {
    const result = domainProjectionIndexTemplate(ctx);
    expect(result).toContain("OrderSummaryProjection");
    expect(result).toContain("OrderSummaryView");
    expect(result).toContain("OrderSummaryQuery");
  });

  it("generates projection with on map and imported handlers", () => {
    const result = domainProjectionTemplate(ctx);
    expect(result).toContain("defineProjection");
    expect(result).toContain("OrderSummaryProjectionDef");
    expect(result).toContain("on:");
    expect(result).toContain("handleGetOrderSummary");
    expect(result).toContain("onOrderSummaryCreated");
    expect(result).not.toContain("reducers:");
    expect(result).not.toContain("identity:");
  });

  it("generates queries barrel with View + DefineQueries", () => {
    const result = queriesIndexTemplate(ctx);
    expect(result).toContain("interface OrderSummaryView");
    expect(result).toContain("DefineQueries");
    expect(result).toContain("GetOrderSummary:");
    expect(result).toContain("GetOrderSummaryPayload");
  });

  it("generates query payload interface", () => {
    const result = queryPayloadTemplate(ctx);
    expect(result).toContain("interface GetOrderSummaryPayload");
    expect(result).toContain("id: string");
  });

  it("generates standalone query handler", () => {
    const result = queryHandlerTemplate(ctx);
    expect(result).toContain("export async function handleGetOrderSummary");
    expect(result).toContain("ViewStore");
    expect(result).toContain("OrderSummaryView");
  });

  it("generates view reducers barrel", () => {
    const result = viewReducersIndexTemplate(ctx);
    expect(result).toContain("onOrderSummaryCreated");
  });

  it("generates standalone view reducer", () => {
    const result = viewReducerTemplate(ctx);
    expect(result).toContain("export function onOrderSummaryCreated");
    expect(result).toContain("OrderSummaryView");
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [
      domainProjectionIndexTemplate(ctx),
      domainProjectionTemplate(ctx),
      queriesIndexTemplate(ctx),
      queryHandlersIndexTemplate(ctx),
      queryHandlerTemplate(ctx),
      viewReducersIndexTemplate(ctx),
      viewReducerTemplate(ctx),
    ];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
