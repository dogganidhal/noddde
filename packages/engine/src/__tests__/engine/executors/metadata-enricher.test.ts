import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { MetadataEnricher } from "../../../executors/metadata-enricher";
import type { MetadataContext } from "../../../domain";

describe("MetadataEnricher", () => {
  it("should auto-generate eventId, timestamp, correlationId, and use causationFallback", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [{ name: "ThingCreated", payload: { id: "t1" } }];

    const enriched = enricher.enrich(events, "Thing", "t1", 0, "CreateThing");

    expect(enriched).toHaveLength(1);
    const meta = enriched[0]!.metadata!;
    expect(meta.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(meta.causationId).toBe("CreateThing");
    expect(meta.userId).toBeUndefined();
    expect(meta.aggregateName).toBe("Thing");
    expect(meta.aggregateId).toBe("t1");
    expect(meta.sequenceNumber).toBe(1);
  });

  it("should use provider values when no override context is set", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const provider = () => ({
      correlationId: "provider-corr",
      causationId: "provider-cause",
      userId: "user-42",
    });
    const enricher = new MetadataEnricher(storage, provider);

    const events = [{ name: "ItemAdded", payload: { qty: 1 } }];
    const enriched = enricher.enrich(events, "Cart", "c1", 5, "AddItem");

    const meta = enriched[0]!.metadata!;
    expect(meta.correlationId).toBe("provider-corr");
    expect(meta.causationId).toBe("provider-cause");
    expect(meta.userId).toBe("user-42");
  });

  it("should override provider values with context values", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const provider = () => ({
      correlationId: "provider-corr",
      causationId: "provider-cause",
      userId: "provider-user",
    });
    const enricher = new MetadataEnricher(storage, provider);

    const events = [{ name: "ItemAdded", payload: { qty: 1 } }];

    storage.run(
      { correlationId: "override-corr", userId: "override-user" },
      () => {
        const enriched = enricher.enrich(events, "Cart", "c1", 0, "AddItem");
        const meta = enriched[0]!.metadata!;
        expect(meta.correlationId).toBe("override-corr");
        expect(meta.userId).toBe("override-user");
        // causationId falls through to provider since not in override
        expect(meta.causationId).toBe("provider-cause");
      },
    );
  });

  it("should assign sequenceNumber = version + index + 1 for each event", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
      { name: "C", payload: {} },
    ];

    const enriched = enricher.enrich(events, "Agg", "a1", 10, "DoStuff");

    expect(enriched[0]!.metadata!.sequenceNumber).toBe(11);
    expect(enriched[1]!.metadata!.sequenceNumber).toBe(12);
    expect(enriched[2]!.metadata!.sequenceNumber).toBe(13);
  });

  it("should return new event objects without mutating originals", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const original = { name: "Created", payload: { id: "x" } };
    const events = [original];

    const enriched = enricher.enrich(events, "Agg", "x", 0, "Create");

    expect(enriched[0]).not.toBe(original);
    expect((original as any).metadata).toBeUndefined();
    expect(enriched[0]!.metadata).toBeDefined();
    // Original payload preserved in enriched copy
    expect(enriched[0]!.payload).toEqual({ id: "x" });
    expect(enriched[0]!.name).toBe("Created");
  });

  it("should return an empty array when given no events", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const enriched = enricher.enrich([], "Agg", "a1", 0, "Cmd");

    expect(enriched).toEqual([]);
  });

  it("should generate distinct eventIds for each event in a batch", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
    ];

    const enriched = enricher.enrich(events, "Agg", "a1", 0, "Cmd");

    expect(enriched[0]!.metadata!.eventId).not.toBe(
      enriched[1]!.metadata!.eventId,
    );
  });

  it("should use the same correlationId for all events in a batch", () => {
    const storage = new AsyncLocalStorage<MetadataContext>();
    const enricher = new MetadataEnricher(storage);

    const events = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
      { name: "C", payload: {} },
    ];

    const enriched = enricher.enrich(events, "Agg", "a1", 0, "Cmd");

    const corrId = enriched[0]!.metadata!.correlationId;
    expect(enriched[1]!.metadata!.correlationId).toBe(corrId);
    expect(enriched[2]!.metadata!.correlationId).toBe(corrId);
  });
});
