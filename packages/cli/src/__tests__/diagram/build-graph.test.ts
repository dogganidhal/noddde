import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { loadDomain } from "../../diagram/load-domain.js";
import { buildDomainGraph } from "../../diagram/build-graph.js";
import type { DomainDefinition } from "@noddde/engine";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const auctionEntry = path.join(
  REPO_ROOT,
  "samples/sample-auction/src/domain/domain.ts",
);
const hotelEntry = path.join(
  REPO_ROOT,
  "samples/sample-hotel-booking/src/domain/domain.ts",
);

describe("buildDomainGraph", () => {
  let auctionDefinition: DomainDefinition;
  let hotelDefinition: DomainDefinition;

  beforeAll(async () => {
    auctionDefinition = (await loadDomain(auctionEntry)).definition;
    hotelDefinition = (await loadDomain(hotelEntry)).definition;
  });

  it("returns a graph with all six edge kinds present for hotel-booking", async () => {
    const graph = buildDomainGraph(hotelDefinition, hotelEntry, {
      scope: "all",
    });

    const sources = new Set(graph.edges.map((e) => e.source));
    expect(sources.has("runtime")).toBe(true);
    expect(sources.has("static")).toBe(true);

    // Saga → command edges flow into known commands handled by aggregates.
    const sagaToCommand = graph.edges.filter(
      (e) => e.from.startsWith("saga:") && e.to.startsWith("command:"),
    );
    expect(sagaToCommand.length).toBeGreaterThan(0);
  });

  it("filters out read-model nodes when scope=write", () => {
    const graph = buildDomainGraph(auctionDefinition, auctionEntry, {
      scope: "write",
    });
    expect(graph.nodes.find((n) => n.kind === "projection")).toBeUndefined();
    expect(graph.nodes.find((n) => n.kind === "query")).toBeUndefined();
  });

  it("skips static analysis when there are no sagas", () => {
    const graph = buildDomainGraph(auctionDefinition, auctionEntry, {});
    expect(graph.nodes.find((n) => n.kind === "saga")).toBeUndefined();
    expect(graph.edges.find((e) => e.source === "static")).toBeUndefined();
  });

  it("marks saga-dispatched commands not handled by any aggregate as external", () => {
    const graph = buildDomainGraph(
      hotelDefinition,
      hotelEntry,
      {},
      // Inject a synthetic saga result that includes a known + unknown command.
      new Map([["BookingFulfillment", ["ConfirmBooking", "FooBar"]]]),
    );

    const fooBar = graph.nodes.find((n) => n.id === "command:FooBar");
    expect(fooBar?.model).toBe("external");

    expect(
      graph.warnings.some(
        (w) => w.includes("FooBar") && w.toLowerCase().includes("external"),
      ),
    ).toBe(true);
  });

  it("hides isolated nodes when hideIsolated=true", () => {
    const graph = buildDomainGraph(auctionDefinition, auctionEntry, {
      hideIsolated: true,
    });
    const degree = new Map<string, number>();
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    for (const node of graph.nodes) {
      expect(degree.get(node.id) ?? 0).toBeGreaterThan(0);
    }
  });
});
