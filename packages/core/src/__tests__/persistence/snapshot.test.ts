import { describe, it, expect } from "vitest";
import { everyNEvents } from "@noddde/core";

describe("everyNEvents", () => {
  it("should return false when eventsSinceSnapshot is below n", () => {
    const strategy = everyNEvents(10);

    expect(
      strategy({ version: 5, lastSnapshotVersion: 0, eventsSinceSnapshot: 5 }),
    ).toBe(false);
    expect(
      strategy({ version: 9, lastSnapshotVersion: 0, eventsSinceSnapshot: 9 }),
    ).toBe(false);
    expect(
      strategy({
        version: 15,
        lastSnapshotVersion: 10,
        eventsSinceSnapshot: 5,
      }),
    ).toBe(false);
  });

  it("should return true when eventsSinceSnapshot >= n", () => {
    const strategy = everyNEvents(10);

    expect(
      strategy({
        version: 10,
        lastSnapshotVersion: 0,
        eventsSinceSnapshot: 10,
      }),
    ).toBe(true);
    expect(
      strategy({
        version: 15,
        lastSnapshotVersion: 0,
        eventsSinceSnapshot: 15,
      }),
    ).toBe(true);
    expect(
      strategy({
        version: 20,
        lastSnapshotVersion: 10,
        eventsSinceSnapshot: 10,
      }),
    ).toBe(true);
  });

  it("should always return true with n=1", () => {
    const strategy = everyNEvents(1);

    expect(
      strategy({ version: 1, lastSnapshotVersion: 0, eventsSinceSnapshot: 1 }),
    ).toBe(true);
    expect(
      strategy({
        version: 100,
        lastSnapshotVersion: 99,
        eventsSinceSnapshot: 1,
      }),
    ).toBe(true);
  });
});
