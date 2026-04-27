import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { loadDomain } from "../../diagram/load-domain.js";
import { introspectDomain } from "../../diagram/introspect.js";
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

describe("introspectDomain — auction sample (write + read, no sagas)", () => {
  let definition: DomainDefinition;

  beforeAll(async () => {
    ({ definition } = await loadDomain(auctionEntry));
  });

  it("produces a command node + edge for each key in aggregate.decide", () => {
    const { nodes, edges } = introspectDomain(definition);

    const commandNodes = nodes.filter((n) => n.kind === "command");
    const auction = (definition.writeModel.aggregates as Record<string, any>)
      .Auction;
    const decideKeys = Object.keys(auction.decide).sort();

    expect(commandNodes.map((n) => n.label).sort()).toEqual(decideKeys);

    for (const cmd of decideKeys) {
      expect(
        edges.find(
          (e) => e.from === `command:${cmd}` && e.to === `aggregate:Auction`,
        ),
      ).toBeDefined();
    }
  });

  it("produces an event node + edge for each key in aggregate.evolve", () => {
    const { nodes, edges } = introspectDomain(definition);

    const eventNodes = nodes.filter((n) => n.kind === "event");
    const auction = (definition.writeModel.aggregates as Record<string, any>)
      .Auction;
    const evolveKeys = Object.keys(auction.evolve).sort();

    expect(eventNodes.map((n) => n.label).sort()).toEqual(evolveKeys);

    for (const evt of evolveKeys) {
      expect(
        edges.find(
          (e) => e.from === `aggregate:Auction` && e.to === `event:${evt}`,
        ),
      ).toBeDefined();
    }
  });

  it("produces an event→projection edge for each key in projection.on", () => {
    const { edges } = introspectDomain(definition);
    const summary = (definition.readModel.projections as Record<string, any>)
      .AuctionSummary;

    for (const evt of Object.keys(summary.on)) {
      expect(
        edges.find(
          (e) =>
            e.from === `event:${evt}` && e.to === `projection:AuctionSummary`,
        ),
      ).toBeDefined();
    }
  });

  it("produces a query→projection edge for each key in projection.queryHandlers", () => {
    const { edges } = introspectDomain(definition);
    const summary = (definition.readModel.projections as Record<string, any>)
      .AuctionSummary;

    for (const q of Object.keys(summary.queryHandlers)) {
      expect(
        edges.find(
          (e) =>
            e.from === `query:${q}` && e.to === `projection:AuctionSummary`,
        ),
      ).toBeDefined();
    }
  });

  it("does not produce saga nodes when processModel is absent", () => {
    const { nodes } = introspectDomain(definition);
    expect(nodes.find((n) => n.kind === "saga")).toBeUndefined();
  });
});

describe("introspectDomain — hotel-booking sample (full process model)", () => {
  let definition: DomainDefinition;

  beforeAll(async () => {
    ({ definition } = await loadDomain(hotelEntry));
  });

  it("produces event→saga edges for both startedBy and on keys (deduped)", () => {
    const { edges } = introspectDomain(definition);

    const fulfillment = (definition.processModel?.sagas as Record<string, any>)
      .BookingFulfillment;
    const triggers = new Set<string>([
      ...fulfillment.startedBy,
      ...Object.keys(fulfillment.on),
    ]);

    for (const evt of triggers) {
      expect(
        edges.find(
          (e) =>
            e.from === `event:${evt}` && e.to === `saga:BookingFulfillment`,
        ),
      ).toBeDefined();
    }
  });

  it("creates exactly one node per saga", () => {
    const { nodes } = introspectDomain(definition);
    const sagaNodes = nodes.filter((n) => n.kind === "saga");
    const sagaKeys = Object.keys(definition.processModel?.sagas ?? {});
    expect(sagaNodes.map((n) => n.label).sort()).toEqual(sagaKeys.sort());
  });

  it("deduplicates event nodes that multiple components touch", () => {
    const { nodes } = introspectDomain(definition);
    const eventLabels = nodes
      .filter((n) => n.kind === "event")
      .map((n) => n.label);
    expect(new Set(eventLabels).size).toBe(eventLabels.length);
  });
});
