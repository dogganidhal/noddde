import { describe, it, expectTypeOf } from "vitest";
import type { EventMetadata, ID } from "@noddde/core";

describe("EventMetadata", () => {
  it("should accept an object with only required fields", () => {
    const metadata: EventMetadata = {
      eventId: "0190a6e0-0000-7000-8000-000000000001",
      timestamp: "2024-01-01T00:00:00.000Z",
      correlationId: "corr-1",
      causationId: "cmd-1",
    };
    expectTypeOf(metadata).toMatchTypeOf<EventMetadata>();
  });

  it("should have string types for required fields", () => {
    expectTypeOf<EventMetadata["eventId"]>().toBeString();
    expectTypeOf<EventMetadata["timestamp"]>().toBeString();
    expectTypeOf<EventMetadata["correlationId"]>().toBeString();
    expectTypeOf<EventMetadata["causationId"]>().toBeString();
  });
});

describe("EventMetadata optional fields", () => {
  it("should accept an object with all fields", () => {
    const metadata: EventMetadata = {
      eventId: "0190a6e0-0000-7000-8000-000000000001",
      timestamp: "2024-01-01T00:00:00.000Z",
      correlationId: "corr-1",
      causationId: "cmd-1",
      userId: "user-42",
      version: 1,
      aggregateName: "BankAccount",
      aggregateId: "acc-1",
      sequenceNumber: 5,
    };
    expectTypeOf(metadata).toMatchTypeOf<EventMetadata>();
  });

  it("should have correct types for optional fields", () => {
    expectTypeOf<EventMetadata["userId"]>().toEqualTypeOf<ID | undefined>();
    expectTypeOf<EventMetadata["version"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<EventMetadata["aggregateName"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<EventMetadata["aggregateId"]>().toEqualTypeOf<
      ID | undefined
    >();
    expectTypeOf<EventMetadata["sequenceNumber"]>().toEqualTypeOf<
      number | undefined
    >();
  });
});

describe("EventMetadata trace context fields", () => {
  it("should accept traceparent and tracestate as optional string fields", () => {
    const metadata: EventMetadata = {
      eventId: "0190a6e0-0000-7000-8000-000000000001",
      timestamp: "2024-01-01T00:00:00.000Z",
      correlationId: "corr-1",
      causationId: "cmd-1",
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      tracestate: "congo=t61rcWkgMzE",
    };
    expectTypeOf(metadata).toMatchTypeOf<EventMetadata>();
  });

  it("should have optional string types for trace context fields", () => {
    expectTypeOf<EventMetadata["traceparent"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<EventMetadata["tracestate"]>().toEqualTypeOf<
      string | undefined
    >();
  });
});

describe("EventMetadata required fields", () => {
  it("should not allow omitting eventId", () => {
    expectTypeOf<{
      timestamp: string;
      correlationId: string;
      causationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });

  it("should not allow omitting timestamp", () => {
    expectTypeOf<{
      eventId: string;
      correlationId: string;
      causationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });

  it("should not allow omitting correlationId", () => {
    expectTypeOf<{
      eventId: string;
      timestamp: string;
      causationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });

  it("should not allow omitting causationId", () => {
    expectTypeOf<{
      eventId: string;
      timestamp: string;
      correlationId: string;
    }>().not.toMatchTypeOf<EventMetadata>();
  });
});
