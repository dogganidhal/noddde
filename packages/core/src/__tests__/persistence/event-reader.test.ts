import { describe, it, expect, expectTypeOf } from "vitest";
import type { EventReader, EventReadOptions, Event, ID } from "@noddde/core";

describe("EventReader interface", () => {
  it("should accept a conforming object as EventReader", () => {
    const reader: EventReader = {
      read: () =>
        (async function* () {
          yield { name: "X", payload: {} } as Event;
        })(),
    };
    expectTypeOf(reader.read).toBeFunction();
    expectTypeOf<ReturnType<typeof reader.read>>().toMatchTypeOf<
      AsyncIterable<Event>
    >();
  });
});

describe("EventReader per-aggregate ordering", () => {
  function createReaderFromArray(events: Event[]): EventReader {
    return {
      read: () =>
        (async function* () {
          for (const e of events) yield e;
        })(),
    };
  }

  it("should yield events in the order they were stored", async () => {
    const events: Event[] = [
      {
        name: "A",
        payload: { i: 0 },
        metadata: { aggregateName: "X", aggregateId: "1" } as any,
      },
      {
        name: "A",
        payload: { i: 1 },
        metadata: { aggregateName: "X", aggregateId: "1" } as any,
      },
      {
        name: "A",
        payload: { i: 2 },
        metadata: { aggregateName: "X", aggregateId: "1" } as any,
      },
    ];
    const reader = createReaderFromArray(events);

    const seen: number[] = [];
    for await (const e of reader.read()) {
      seen.push((e.payload as { i: number }).i);
    }
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe("EventReader empty log", () => {
  it("should produce an iterable that immediately terminates", async () => {
    const reader: EventReader = {
      read: () =>
        (async function* () {
          // yields nothing
        })(),
    };
    let count = 0;
    // eslint-disable-next-line no-unused-vars
    for await (const _ of reader.read()) count++;
    expect(count).toBe(0);
  });
});

describe("EventReader.read return type", () => {
  it("should return AsyncIterable<Event>", () => {
    type ReadReturn = ReturnType<EventReader["read"]>;
    expectTypeOf<ReadReturn>().toEqualTypeOf<AsyncIterable<Event>>();
  });
});

describe("EventReadOptions", () => {
  it("should allow an aggregateName filter", () => {
    const opts: EventReadOptions = { aggregateName: "Order" };
    expectTypeOf(opts.aggregateName).toEqualTypeOf<string | undefined>();
  });

  it("should allow an after cursor", () => {
    const opts: EventReadOptions = {
      after: {
        aggregateName: "Order",
        aggregateId: "1" as ID,
        version: 5,
      },
    };
    expectTypeOf(opts.after).toMatchTypeOf<
      { aggregateName: string; aggregateId: ID; version: number } | undefined
    >();
  });

  it("should allow an empty options object", () => {
    const opts: EventReadOptions = {};
    expectTypeOf(opts).toMatchTypeOf<EventReadOptions>();
  });
});

describe("EventReader.read no-arg equivalence", () => {
  it("should produce the same sequence as read({})", async () => {
    const events: Event[] = [
      { name: "A", payload: {} },
      { name: "B", payload: {} },
    ];
    let callCount = 0;
    const reader: EventReader = {
      read: () => {
        callCount++;
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    };

    const seqA: string[] = [];
    for await (const e of reader.read()) seqA.push(e.name);

    const seqB: string[] = [];
    for await (const e of reader.read({})) seqB.push(e.name);

    expect(seqA).toEqual(seqB);
    expect(callCount).toBe(2);
  });
});

describe("EventReader concurrent iteration", () => {
  it("should allow two iterators to progress independently", async () => {
    const events: Event[] = [
      { name: "A", payload: { i: 0 } },
      { name: "A", payload: { i: 1 } },
      { name: "A", payload: { i: 2 } },
    ];
    const reader: EventReader = {
      read: () =>
        (async function* () {
          for (const e of events) yield e;
        })(),
    };

    const iter1 = reader.read()[Symbol.asyncIterator]();
    const iter2 = reader.read()[Symbol.asyncIterator]();

    const a = await iter1.next();
    const b = await iter2.next();
    expect((a.value as Event).payload).toEqual({ i: 0 });
    expect((b.value as Event).payload).toEqual({ i: 0 });

    const a2 = await iter1.next();
    expect((a2.value as Event).payload).toEqual({ i: 1 });
    // iter2 is still at index 1 from its own perspective
    const b2 = await iter2.next();
    expect((b2.value as Event).payload).toEqual({ i: 1 });
  });
});
