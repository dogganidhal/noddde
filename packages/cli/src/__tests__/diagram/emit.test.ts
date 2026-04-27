import { describe, it, expect } from "vitest";
import { emitMermaid } from "../../diagram/emit-mermaid.js";
import { emitDot } from "../../diagram/emit-dot.js";
import { emitJson } from "../../diagram/emit-json.js";
import type { DomainGraph } from "../../diagram/types.js";

const sample: DomainGraph = {
  nodes: [
    {
      id: "command:CreateAuction",
      label: "CreateAuction",
      kind: "command",
      model: "write",
    },
    {
      id: "aggregate:Auction",
      label: "Auction",
      kind: "aggregate",
      model: "write",
    },
    {
      id: "event:AuctionCreated",
      label: "AuctionCreated",
      kind: "event",
      model: "write",
    },
    { id: "saga:Foo", label: "Foo", kind: "saga", model: "process" },
    {
      id: "command:DoFoo",
      label: "DoFoo",
      kind: "command",
      model: "external",
    },
  ],
  edges: [
    {
      from: "command:CreateAuction",
      to: "aggregate:Auction",
      source: "runtime",
    },
    {
      from: "aggregate:Auction",
      to: "event:AuctionCreated",
      source: "runtime",
    },
    {
      from: "event:AuctionCreated",
      to: "saga:Foo",
      source: "runtime",
    },
    { from: "saga:Foo", to: "command:DoFoo", source: "static" },
  ],
  warnings: [],
};

describe("emitMermaid", () => {
  it("emits flowchart LR with subgraphs and pill/box shapes", () => {
    const out = emitMermaid(sample);
    expect(out).toMatch(/^flowchart LR/);
    expect(out).toMatch(/subgraph .*Write Model/);
    expect(out).toMatch(/subgraph .*Process Model/);
    expect(out).toMatch(/subgraph .*External/);
    expect(out).toMatch(/\(\["CreateAuction"\]\)/);
    expect(out).toMatch(/\[\["Auction"\]\]/);
  });

  it("uses solid arrows for runtime edges and dashed for static", () => {
    const out = emitMermaid(sample);
    // Mermaid sanitizes ':' to '_' in node ids.
    expect(out).toMatch(/command_CreateAuction\s+-->\s+aggregate_Auction/);
    expect(out).toMatch(/saga_Foo\s+-\.->\s+command_DoFoo/);
  });

  it("does not emit ':' in node identifiers (Mermaid syntax constraint)", () => {
    const out = emitMermaid(sample);
    // Strip the labels (which legitimately contain ':' in their style classDefs)
    // and check there are no colons in node-id positions.
    const idLines = out
      .split("\n")
      .filter(
        (l) => l.includes("-->") || l.includes("-.->") || /^\s*class\s/.test(l),
      );
    for (const line of idLines) {
      expect(line).not.toMatch(/[a-z]+:[A-Z]/);
    }
  });
});

describe("emitDot", () => {
  it("emits a digraph with cluster subgraphs and edge styles", () => {
    const out = emitDot(sample);
    expect(out).toMatch(/digraph G \{/);
    expect(out).toMatch(/rankdir=LR;/);
    expect(out).toMatch(/subgraph cluster_write \{/);
    expect(out).toMatch(/subgraph cluster_process \{/);
    expect(out).toMatch(/"command:CreateAuction" -> "aggregate:Auction";/);
    expect(out).toMatch(/"saga:Foo" -> "command:DoFoo" \[style="dashed"\];/);
  });
});

describe("emitJson", () => {
  it("round-trips the graph", () => {
    const out = emitJson(sample);
    expect(JSON.parse(out)).toEqual(sample);
  });
});
