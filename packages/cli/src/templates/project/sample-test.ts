import type { TemplateContext } from "../../utils/context.js";

/** Generates a sample integration test using @noddde/testing. */
export function sampleTestTemplate(ctx: TemplateContext): string {
  return `import { describe, expect, it } from "vitest";
import { testAggregate, testDomain } from "@noddde/testing";
import { ${ctx.name} } from "../domain/write-model/aggregates/${ctx.kebabName}/index.js";
import { ${ctx.name}Projection } from "../domain/read-model/projections/${ctx.kebabName}/index.js";

// ═══════════════════════════════════════════════════════════════════
// UNIT TEST — testAggregate
// ═══════════════════════════════════════════════════════════════════

describe("${ctx.name} aggregate", () => {
  it("should handle Create${ctx.name} command", async () => {
    const result = await testAggregate(${ctx.name})
      .when({
        name: "Create${ctx.name}",
        targetAggregateId: "test-id",
      })
      .withPorts({})
      .execute();

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.name).toBe("${ctx.name}Created");
    expect(result.events[0]!.payload).toEqual({ id: "test-id" });
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLICE TEST — testDomain
// ═══════════════════════════════════════════════════════════════════

describe("${ctx.name} domain", () => {
  it("should dispatch a command and publish events", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { ${ctx.name} },
      projections: { ${ctx.name}: ${ctx.name}Projection },
      ports: {},
    });

    await domain.dispatchCommand({
      name: "Create${ctx.name}",
      targetAggregateId: "test-id",
    });

    expect(spy.publishedEvents).toHaveLength(1);
    expect(spy.publishedEvents[0]!.name).toBe("${ctx.name}Created");
  });
});
`;
}
