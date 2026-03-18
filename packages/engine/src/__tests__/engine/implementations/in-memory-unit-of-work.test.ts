import { describe, it, expect } from "vitest";
import {
  InMemoryUnitOfWork,
  createInMemoryUnitOfWork,
} from "@noddde/engine";

describe("InMemoryUnitOfWork", () => {
  it("should execute enlisted operations in order on commit", async () => {
    const uow = new InMemoryUnitOfWork();
    const log: string[] = [];

    uow.enlist(async () => {
      log.push("first");
    });
    uow.enlist(async () => {
      log.push("second");
    });
    uow.enlist(async () => {
      log.push("third");
    });

    await uow.commit();

    expect(log).toEqual(["first", "second", "third"]);
  });

  it("should return deferred events on commit in order", async () => {
    const uow = new InMemoryUnitOfWork();

    uow.deferPublish({ name: "A", payload: { x: 1 } });
    uow.deferPublish(
      { name: "B", payload: { x: 2 } },
      { name: "C", payload: { x: 3 } },
    );

    const events = await uow.commit();

    expect(events).toEqual([
      { name: "A", payload: { x: 1 } },
      { name: "B", payload: { x: 2 } },
      { name: "C", payload: { x: 3 } },
    ]);
  });

  it("should return empty array when no events deferred", async () => {
    const uow = new InMemoryUnitOfWork();
    const events = await uow.commit();

    expect(events).toEqual([]);
  });

  it("should not execute operations after rollback", async () => {
    const uow = new InMemoryUnitOfWork();
    let executed = false;

    uow.enlist(async () => {
      executed = true;
    });
    uow.deferPublish({ name: "E", payload: {} });

    await uow.rollback();

    expect(executed).toBe(false);
  });

  it("should throw on double commit", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.commit();

    await expect(uow.commit()).rejects.toThrow(
      "UnitOfWork already completed",
    );
  });

  it("should throw on rollback after commit", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.commit();

    await expect(uow.rollback()).rejects.toThrow(
      "UnitOfWork already completed",
    );
  });

  it("should throw on enlist after commit", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.commit();

    expect(() => uow.enlist(async () => {})).toThrow(
      "UnitOfWork already completed",
    );
  });

  it("should throw on deferPublish after rollback", async () => {
    const uow = new InMemoryUnitOfWork();
    await uow.rollback();

    expect(() =>
      uow.deferPublish({ name: "E", payload: {} }),
    ).toThrow("UnitOfWork already completed");
  });

  it("should propagate error from a failing operation and seal the UoW", async () => {
    const uow = new InMemoryUnitOfWork();
    const log: string[] = [];

    uow.enlist(async () => {
      log.push("first");
    });
    uow.enlist(async () => {
      throw new Error("persistence failure");
    });
    uow.enlist(async () => {
      log.push("third");
    });
    uow.deferPublish({ name: "E", payload: {} });

    await expect(uow.commit()).rejects.toThrow("persistence failure");

    // First operation executed, second threw, third was skipped
    expect(log).toEqual(["first"]);

    // UoW is sealed after failed commit
    expect(() => uow.enlist(async () => {})).toThrow(
      "UnitOfWork already completed",
    );
  });
});

describe("createInMemoryUnitOfWork", () => {
  it("should return independent UnitOfWork instances", async () => {
    const uow1 = createInMemoryUnitOfWork();
    const uow2 = createInMemoryUnitOfWork();

    uow1.deferPublish({ name: "A", payload: {} });

    const events1 = await uow1.commit();
    const events2 = await uow2.commit();

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(0);
  });
});
