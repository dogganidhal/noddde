import { describe, it, expectTypeOf } from "vitest";
import type { OutboxStore, OutboxEntry, Event } from "@noddde/core";

describe("OutboxStore Interface", () => {
  it("should have save accepting OutboxEntry array", () => {
    expectTypeOf<OutboxStore["save"]>().toBeFunction();
    expectTypeOf<OutboxStore["save"]>()
      .parameter(0)
      .toMatchTypeOf<OutboxEntry[]>();
    expectTypeOf<OutboxStore["save"]>().returns.toMatchTypeOf<Promise<void>>();
  });

  it("should have loadUnpublished returning Promise of OutboxEntry array", () => {
    expectTypeOf<OutboxStore["loadUnpublished"]>().toBeFunction();
    expectTypeOf<OutboxStore["loadUnpublished"]>().returns.toMatchTypeOf<
      Promise<OutboxEntry[]>
    >();
  });

  it("should have markPublished accepting string array", () => {
    expectTypeOf<OutboxStore["markPublished"]>().toBeFunction();
    expectTypeOf<OutboxStore["markPublished"]>()
      .parameter(0)
      .toMatchTypeOf<string[]>();
    expectTypeOf<OutboxStore["markPublished"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });

  it("should have markPublishedByEventIds accepting string array", () => {
    expectTypeOf<OutboxStore["markPublishedByEventIds"]>().toBeFunction();
    expectTypeOf<OutboxStore["markPublishedByEventIds"]>()
      .parameter(0)
      .toMatchTypeOf<string[]>();
    expectTypeOf<
      OutboxStore["markPublishedByEventIds"]
    >().returns.toMatchTypeOf<Promise<void>>();
  });

  it("should have deletePublished accepting optional Date", () => {
    expectTypeOf<OutboxStore["deletePublished"]>().toBeFunction();
    expectTypeOf<OutboxStore["deletePublished"]>().returns.toMatchTypeOf<
      Promise<void>
    >();
  });
});

describe("OutboxEntry Interface", () => {
  it("should have required fields with correct types", () => {
    expectTypeOf<OutboxEntry["id"]>().toBeString();
    expectTypeOf<OutboxEntry["event"]>().toMatchTypeOf<Event>();
    expectTypeOf<OutboxEntry["createdAt"]>().toBeString();
    expectTypeOf<OutboxEntry["publishedAt"]>().toMatchTypeOf<string | null>();
  });

  it("should have optional aggregateName and aggregateId", () => {
    expectTypeOf<OutboxEntry["aggregateName"]>().toMatchTypeOf<
      string | undefined
    >();
    expectTypeOf<OutboxEntry["aggregateId"]>().toMatchTypeOf<
      string | undefined
    >();
  });
});
